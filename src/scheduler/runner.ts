import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Driver } from "../drivers/types.ts";
import type { Logger } from "../logger.ts";
import { expandTilde, toError, type ResolvedConfig } from "../resources.ts";
import { resolveDriverName, resolveModelName } from "../resolve.ts";
import type { ResolvedAgent } from "../skills.ts";
import type { SchedulerAuditLog } from "./audit-log.ts";
import type { SchedulerStore } from "./store.ts";
import type { SchedulerOutputSink } from "./output.ts";
import type {
  ResolvedSchedule,
  ScheduleDeliveryStatus,
  ScheduleExecutionStatus,
  ScheduleRunRecord,
  ScheduleRunStatus,
  ScheduleTriggerSource,
} from "./types.ts";

export interface SchedulerRunnerContext {
  drivers: Record<string, Driver>;
  config: ResolvedConfig;
  pluginDirs: Map<string, string>;
  resolveAgent: (agentDir: string) => ResolvedAgent;
  logger: Logger;
  store: SchedulerStore;
  auditLog: SchedulerAuditLog;
  outputSink: SchedulerOutputSink;
}

export interface StartScheduleRunResult {
  started: boolean;
  runId?: string;
  reason?: "already_running";
}

function makeRunId(): string {
  return `sched_${randomUUID()}`;
}

function buildFailureMessage(scheduleName: string, runId: string): string {
  return `Schedule "${scheduleName}" failed. run_id: ${runId}`;
}

function makeNowIso(): string {
  return new Date().toISOString();
}

export class SchedulerRunner {
  private runningSchedules = new Set<string>();

  constructor(private ctx: SchedulerRunnerContext) {}

  updateContext(ctx: SchedulerRunnerContext): void {
    this.ctx = ctx;
  }

  isRunning(scheduleName: string): boolean {
    return this.runningSchedules.has(scheduleName);
  }

  startRun(
    schedule: ResolvedSchedule,
    triggerSource: ScheduleTriggerSource,
  ): StartScheduleRunResult {
    if (this.runningSchedules.has(schedule.name)) {
      return {
        started: false,
        reason: "already_running",
      };
    }

    const runId = makeRunId();
    this.runningSchedules.add(schedule.name);
    void this.executeRun(runId, schedule, triggerSource)
      .catch((err) => {
        this.ctx.logger.error(
          {
            err: toError(err),
            run_id: runId,
            schedule_name: schedule.name,
          },
          "schedule_run_unhandled_error",
        );
      })
      .finally(() => {
        this.runningSchedules.delete(schedule.name);
      });

    return {
      started: true,
      runId,
    };
  }

  recordOverlapSkip(
    schedule: ResolvedSchedule,
    triggerSource: ScheduleTriggerSource,
    timezone: string,
  ): string {
    const runId = makeRunId();
    const nowIso = makeNowIso();
    const record: ScheduleRunRecord = {
      runId,
      scheduleName: schedule.name,
      triggerSource,
      status: "skipped",
      agent: schedule.agent,
      driver: schedule.driver,
      model: schedule.model,
      cronExpression: schedule.cron,
      timezone,
      outputType: schedule.output?.type,
      outputTarget: schedule.output?.channelId,
      deliveryStatus: schedule.output ? "pending" : "not_applicable",
      startedAt: nowIso,
      finishedAt: nowIso,
      errorMessage: "Skipped because the previous run was still in progress.",
    };

    this.ctx.store.insertRun(record);
    this.ctx.auditLog.append({
      ts: nowIso,
      event: "schedule_run_skipped_overlap",
      run_id: runId,
      schedule_name: schedule.name,
      trigger_source: triggerSource,
      agent: schedule.agent,
      driver: schedule.driver,
      model: schedule.model,
      cron_expression: schedule.cron,
      timezone,
      output: schedule.output
        ? {
            type: schedule.output.type,
            channel_id: schedule.output.channelId,
          }
        : null,
      status: "skipped",
      message: "Skipped due to overlapping run.",
    });
    return runId;
  }

  private async executeRun(
    runId: string,
    schedule: ResolvedSchedule,
    triggerSource: ScheduleTriggerSource,
  ): Promise<void> {
    const timezone = this.ctx.config.scheduler?.timezone;
    if (!timezone) {
      throw new Error("scheduler.timezone is required for scheduled runs");
    }

    const startedAt = makeNowIso();
    const agentDir = resolve(this.ctx.config.agentsDir, schedule.agent);
    const resolvedAgent = this.ctx.resolveAgent(agentDir);
    const driverName = resolveDriverName({
      runtimeOverride: schedule.driver,
      agentFrontmatter: resolvedAgent.driver,
      globalDefault: this.ctx.config.defaultDriver,
    });
    const driver = this.ctx.drivers[driverName];
    if (!driver) {
      throw new Error(`Unknown driver: ${driverName}`);
    }

    const modelName = resolveModelName({
      runtimeOverride: schedule.model,
      agentFrontmatter: resolvedAgent.model,
      driverDefault: driver.defaultModel,
    });

    const outputTarget = schedule.output?.channelId;
    const outputType = schedule.output?.type;

    const initialRecord: ScheduleRunRecord = {
      runId,
      scheduleName: schedule.name,
      triggerSource,
      status: "running",
      agent: schedule.agent,
      driver: driverName,
      model: modelName,
      cronExpression: schedule.cron,
      timezone,
      outputType,
      outputTarget,
      executionStatus: "running",
      deliveryStatus: schedule.output ? "pending" : "not_applicable",
      startedAt,
    };
    this.ctx.store.insertRun(initialRecord);

    this.ctx.auditLog.append({
      ts: startedAt,
      event: "schedule_run_started",
      run_id: runId,
      schedule_name: schedule.name,
      trigger_source: triggerSource,
      agent: schedule.agent,
      driver: driverName,
      model: modelName,
      cron_expression: schedule.cron,
      timezone,
      output: schedule.output
        ? {
            type: schedule.output.type,
            channel_id: schedule.output.channelId,
          }
        : null,
      status: "running",
      message: "Schedule run started.",
    });

    let sessionId: string | undefined;
    let responseText = "";
    let executionStatus: ScheduleExecutionStatus = "running";
    let deliveryStatus: ScheduleDeliveryStatus = schedule.output
      ? "pending"
      : "not_applicable";
    let overallStatus: ScheduleRunStatus = "running";
    let errorMessage: string | undefined;

    try {
      const driverCwd = this.ctx.config.drivers[driverName]?.cwd;
      const cwd = driverCwd
        ? resolve(expandTilde(driverCwd))
        : this.ctx.config.homeDir;

      sessionId = await driver.createSession({
        systemPrompt: resolvedAgent.systemPrompt,
        model: modelName,
        skills: resolvedAgent.skills,
        pluginDir: this.ctx.pluginDirs.get(schedule.agent),
        cwd,
      });

      const response = await driver.query(
        sessionId,
        schedule.prompt,
        (event) => {
          if (event.type === "tool_use") {
            this.ctx.auditLog.append({
              ts: makeNowIso(),
              event: "schedule_run_output",
              run_id: runId,
              schedule_name: schedule.name,
              trigger_source: triggerSource,
              agent: schedule.agent,
              driver: driverName,
              model: modelName,
              cron_expression: schedule.cron,
              timezone,
              output: schedule.output
                ? {
                    type: schedule.output.type,
                    channel_id: schedule.output.channelId,
                  }
                : null,
              message: `Tool used: ${event.tool}`,
            });
          }
        },
      );
      responseText = response.text.trim() ? response.text : "(no response)";
      executionStatus = "succeeded";

      this.ctx.auditLog.append({
        ts: makeNowIso(),
        event: "schedule_run_output",
        run_id: runId,
        schedule_name: schedule.name,
        trigger_source: triggerSource,
        agent: schedule.agent,
        driver: driverName,
        model: modelName,
        cron_expression: schedule.cron,
        timezone,
        output: schedule.output
          ? {
              type: schedule.output.type,
              channel_id: schedule.output.channelId,
            }
          : null,
        response_text: responseText,
        message: "Schedule run produced output.",
      });
    } catch (err) {
      const error = toError(err);
      executionStatus = "failed";
      errorMessage = error.message;
      this.ctx.logger.error(
        { err: error, run_id: runId, schedule_name: schedule.name },
        "schedule_run_execution_error",
      );
      this.ctx.auditLog.append({
        ts: makeNowIso(),
        event: "schedule_run_failed",
        run_id: runId,
        schedule_name: schedule.name,
        trigger_source: triggerSource,
        agent: schedule.agent,
        driver: driverName,
        model: modelName,
        cron_expression: schedule.cron,
        timezone,
        output: schedule.output
          ? {
              type: schedule.output.type,
              channel_id: schedule.output.channelId,
            }
          : null,
        status: "failed",
        error: error.message,
        message: "Schedule run failed during execution.",
      });
    } finally {
      if (sessionId) {
        try {
          await driver.destroySession(sessionId);
        } catch (err) {
          const error = toError(err);
          this.ctx.logger.error(
            { err: error, run_id: runId, schedule_name: schedule.name },
            "schedule_run_destroy_session_error",
          );
          if (executionStatus === "succeeded") {
            executionStatus = "failed";
            errorMessage = error.message;
            this.ctx.auditLog.append({
              ts: makeNowIso(),
              event: "schedule_run_failed",
              run_id: runId,
              schedule_name: schedule.name,
              trigger_source: triggerSource,
              agent: schedule.agent,
              driver: driverName,
              model: modelName,
              cron_expression: schedule.cron,
              timezone,
              output: schedule.output
                ? {
                    type: schedule.output.type,
                    channel_id: schedule.output.channelId,
                  }
                : null,
              status: "failed",
              error: error.message,
              message: "Schedule run failed while destroying session.",
            });
          }
        }
      }
    }

    if (schedule.output) {
      const messageToSend =
        executionStatus === "succeeded"
          ? responseText
          : buildFailureMessage(schedule.name, runId);

      this.ctx.auditLog.append({
        ts: makeNowIso(),
        event: "schedule_run_delivery_started",
        run_id: runId,
        schedule_name: schedule.name,
        trigger_source: triggerSource,
        agent: schedule.agent,
        driver: driverName,
        model: modelName,
        cron_expression: schedule.cron,
        timezone,
        output: {
          type: schedule.output.type,
          channel_id: schedule.output.channelId,
        },
        delivery_status: "pending",
        channel_id: schedule.output.channelId,
        message: "Schedule run delivery started.",
      });

      try {
        await this.ctx.outputSink.sendDiscordMessage(
          schedule.output.channelId,
          messageToSend,
        );
        deliveryStatus = "succeeded";
        this.ctx.auditLog.append({
          ts: makeNowIso(),
          event: "schedule_run_delivery_succeeded",
          run_id: runId,
          schedule_name: schedule.name,
          trigger_source: triggerSource,
          agent: schedule.agent,
          driver: driverName,
          model: modelName,
          cron_expression: schedule.cron,
          timezone,
          output: {
            type: schedule.output.type,
            channel_id: schedule.output.channelId,
          },
          delivery_status: "succeeded",
          channel_id: schedule.output.channelId,
          message: "Schedule run delivery succeeded.",
        });
      } catch (err) {
        const error = toError(err);
        deliveryStatus = "failed";
        if (executionStatus === "succeeded") {
          errorMessage = error.message;
        }
        this.ctx.logger.error(
          { err: error, run_id: runId, schedule_name: schedule.name },
          "schedule_run_delivery_error",
        );
        this.ctx.auditLog.append({
          ts: makeNowIso(),
          event: "schedule_run_delivery_failed",
          run_id: runId,
          schedule_name: schedule.name,
          trigger_source: triggerSource,
          agent: schedule.agent,
          driver: driverName,
          model: modelName,
          cron_expression: schedule.cron,
          timezone,
          output: {
            type: schedule.output.type,
            channel_id: schedule.output.channelId,
          },
          delivery_status: "failed",
          channel_id: schedule.output.channelId,
          error: error.message,
          message: "Schedule run delivery failed.",
        });
      }
    }

    overallStatus =
      executionStatus === "succeeded" && deliveryStatus !== "failed"
        ? "succeeded"
        : "failed";

    const finishedAt = makeNowIso();
    this.ctx.store.updateRun(runId, {
      status: overallStatus,
      executionStatus,
      deliveryStatus,
      finishedAt,
      errorMessage,
    });

    this.ctx.auditLog.append({
      ts: finishedAt,
      event:
        overallStatus === "succeeded"
          ? "schedule_run_completed"
          : "schedule_run_failed",
      run_id: runId,
      schedule_name: schedule.name,
      trigger_source: triggerSource,
      agent: schedule.agent,
      driver: driverName,
      model: modelName,
      cron_expression: schedule.cron,
      timezone,
      output: schedule.output
        ? {
            type: schedule.output.type,
            channel_id: schedule.output.channelId,
          }
        : null,
      status: overallStatus,
      delivery_status: deliveryStatus,
      error: errorMessage,
      message:
        overallStatus === "succeeded"
          ? "Schedule run completed successfully."
          : "Schedule run finished with failure.",
    });
  }
}
