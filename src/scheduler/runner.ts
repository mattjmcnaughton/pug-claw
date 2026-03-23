import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Driver } from "../drivers/types.ts";
import type { Logger } from "../logger.ts";
import { buildMemoryBlockForAgent } from "../memory/injection.ts";
import {
  buildMemoryToolInstructions,
  type MemoryToolContext,
} from "../memory/tools.ts";
import type { MemoryBackend } from "../memory/types.ts";
import { expandTilde, toError, type ResolvedConfig } from "../resources.ts";
import { resolveDriverName, resolveModelName } from "../resolve.ts";
import type { ResolvedAgent } from "../skills.ts";
import type { SchedulerAuditLog } from "./audit-log.ts";
import type { SchedulerOutputSink } from "./output.ts";
import type { SchedulerStore } from "./store.ts";
import {
  SchedulerAuditEvents,
  ScheduleDeliveryStatuses,
  type ScheduleDeliveryStatus,
  ScheduleExecutionStatuses,
  type ScheduleExecutionStatus,
  type ResolvedSchedule,
  type ScheduleRunRecord,
  ScheduleRunStatuses,
  type ScheduleRunStatus,
  type ScheduleTriggerSource,
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
  memoryBackend?: MemoryBackend;
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

function getInitialDeliveryStatus(
  schedule: ResolvedSchedule,
): ScheduleDeliveryStatus {
  return schedule.output
    ? ScheduleDeliveryStatuses.PENDING
    : ScheduleDeliveryStatuses.NOT_APPLICABLE;
}

export class SchedulerRunner {
  private runningSchedules = new Set<string>();

  constructor(private ctx: SchedulerRunnerContext) {}

  private getMemoryToolContext(
    schedule: ResolvedSchedule,
    resolvedAgent: ResolvedAgent,
  ): MemoryToolContext | undefined {
    if (!this.ctx.memoryBackend || !this.ctx.config.memory.enabled) {
      return undefined;
    }
    if (!resolvedAgent.memory) {
      return undefined;
    }

    return {
      memoryBackend: this.ctx.memoryBackend,
      actor: {
        type: "agent",
        agentName: schedule.agent,
        createdBy: `agent:${schedule.agent}`,
        source: "agent",
      },
    };
  }

  private async buildMemoryBlock(
    schedule: ResolvedSchedule,
    resolvedAgent: ResolvedAgent,
  ): Promise<string | undefined> {
    const memoryToolContext = this.getMemoryToolContext(schedule, resolvedAgent);
    if (!memoryToolContext) {
      return undefined;
    }

    const memoryBlock = await buildMemoryBlockForAgent(
      memoryToolContext.memoryBackend,
      memoryToolContext.actor.agentName ?? schedule.agent,
      this.ctx.config.memory.injectionBudgetTokens,
    );

    return memoryBlock || undefined;
  }

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
      status: ScheduleRunStatuses.SKIPPED,
      agent: schedule.agent,
      driver: schedule.driver,
      model: schedule.model,
      cronExpression: schedule.cron,
      timezone,
      outputType: schedule.output?.type,
      outputTarget: schedule.output?.channelId,
      deliveryStatus: getInitialDeliveryStatus(schedule),
      startedAt: nowIso,
      finishedAt: nowIso,
      errorMessage: "Skipped because the previous run was still in progress.",
    };

    this.ctx.store.insertRun(record);
    this.ctx.auditLog.append({
      ts: nowIso,
      event: SchedulerAuditEvents.SCHEDULE_RUN_SKIPPED_OVERLAP,
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
      status: ScheduleRunStatuses.SKIPPED,
      message: "Skipped due to overlapping run.",
    });
    return runId;
  }

  // TODO: split executeRun into smaller methods (execute, deliver, finalize)
  // so each phase can be unit-tested independently.
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
      status: ScheduleRunStatuses.RUNNING,
      agent: schedule.agent,
      driver: driverName,
      model: modelName,
      cronExpression: schedule.cron,
      timezone,
      outputType,
      outputTarget,
      executionStatus: ScheduleExecutionStatuses.RUNNING,
      deliveryStatus: getInitialDeliveryStatus(schedule),
      startedAt,
    };
    this.ctx.store.insertRun(initialRecord);

    this.ctx.auditLog.append({
      ts: startedAt,
      event: SchedulerAuditEvents.SCHEDULE_RUN_STARTED,
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
      status: ScheduleRunStatuses.RUNNING,
      message: "Schedule run started.",
    });

    let sessionId: string | undefined;
    let responseText = "";
    let emptyResponse = false;
    let executionStatus: ScheduleExecutionStatus =
      ScheduleExecutionStatuses.RUNNING;
    let deliveryStatus: ScheduleDeliveryStatus =
      getInitialDeliveryStatus(schedule);
    let overallStatus: ScheduleRunStatus = ScheduleRunStatuses.RUNNING;
    let errorMessage: string | undefined;

    try {
      const driverCwd = this.ctx.config.drivers[driverName]?.cwd;
      const cwd = driverCwd
        ? resolve(expandTilde(driverCwd))
        : this.ctx.config.homeDir;
      const memoryToolContext = this.getMemoryToolContext(schedule, resolvedAgent);
      const memoryBlock = await this.buildMemoryBlock(schedule, resolvedAgent);
      const systemPrompt = memoryToolContext
        ? `${resolvedAgent.systemPrompt}\n\n${buildMemoryToolInstructions()}`
        : resolvedAgent.systemPrompt;

      sessionId = await driver.createSession({
        systemPrompt,
        model: modelName,
        skills: resolvedAgent.skills,
        memoryBlock,
        memoryToolContext,
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
              event: SchedulerAuditEvents.SCHEDULE_RUN_OUTPUT,
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
      emptyResponse = !response.text.trim();
      responseText = emptyResponse ? "(no response)" : response.text;
      executionStatus = ScheduleExecutionStatuses.SUCCEEDED;

      this.ctx.auditLog.append({
        ts: makeNowIso(),
        event: SchedulerAuditEvents.SCHEDULE_RUN_OUTPUT,
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
      executionStatus = ScheduleExecutionStatuses.FAILED;
      errorMessage = error.message;
      this.ctx.logger.error(
        { err: error, run_id: runId, schedule_name: schedule.name },
        "schedule_run_execution_error",
      );
      this.ctx.auditLog.append({
        ts: makeNowIso(),
        event: SchedulerAuditEvents.SCHEDULE_RUN_FAILED,
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
        status: ScheduleRunStatuses.FAILED,
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
          if (executionStatus === ScheduleExecutionStatuses.SUCCEEDED) {
            executionStatus = ScheduleExecutionStatuses.FAILED;
            errorMessage = error.message;
            this.ctx.auditLog.append({
              ts: makeNowIso(),
              event: SchedulerAuditEvents.SCHEDULE_RUN_FAILED,
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
              status: ScheduleRunStatuses.FAILED,
              error: error.message,
              message: "Schedule run failed while destroying session.",
            });
          }
        }
      }
    }

    if (schedule.output) {
      if (
        emptyResponse &&
        executionStatus === ScheduleExecutionStatuses.SUCCEEDED
      ) {
        deliveryStatus = ScheduleDeliveryStatuses.NOT_APPLICABLE;
        this.ctx.auditLog.append({
          ts: makeNowIso(),
          event: SchedulerAuditEvents.SCHEDULE_RUN_DELIVERY_SUCCEEDED,
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
          delivery_status: ScheduleDeliveryStatuses.NOT_APPLICABLE,
          channel_id: schedule.output.channelId,
          message: "Delivery skipped: agent returned empty response.",
        });
      } else {
        const messageToSend =
          executionStatus === ScheduleExecutionStatuses.SUCCEEDED
            ? responseText
            : buildFailureMessage(schedule.name, runId);

        this.ctx.auditLog.append({
          ts: makeNowIso(),
          event: SchedulerAuditEvents.SCHEDULE_RUN_DELIVERY_STARTED,
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
          delivery_status: ScheduleDeliveryStatuses.PENDING,
          channel_id: schedule.output.channelId,
          message: "Schedule run delivery started.",
        });

        try {
          await this.ctx.outputSink.sendDiscordMessage(
            schedule.output.channelId,
            messageToSend,
          );
          deliveryStatus = ScheduleDeliveryStatuses.SUCCEEDED;
          this.ctx.auditLog.append({
            ts: makeNowIso(),
            event: SchedulerAuditEvents.SCHEDULE_RUN_DELIVERY_SUCCEEDED,
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
            delivery_status: ScheduleDeliveryStatuses.SUCCEEDED,
            channel_id: schedule.output.channelId,
            message: "Schedule run delivery succeeded.",
          });
        } catch (err) {
          const error = toError(err);
          deliveryStatus = ScheduleDeliveryStatuses.FAILED;
          if (executionStatus === ScheduleExecutionStatuses.SUCCEEDED) {
            errorMessage = error.message;
          }
          this.ctx.logger.error(
            { err: error, run_id: runId, schedule_name: schedule.name },
            "schedule_run_delivery_error",
          );
          this.ctx.auditLog.append({
            ts: makeNowIso(),
            event: SchedulerAuditEvents.SCHEDULE_RUN_DELIVERY_FAILED,
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
            delivery_status: ScheduleDeliveryStatuses.FAILED,
            channel_id: schedule.output.channelId,
            error: error.message,
            message: "Schedule run delivery failed.",
          });
        }
      }
    }

    overallStatus =
      executionStatus === ScheduleExecutionStatuses.SUCCEEDED &&
      deliveryStatus !== ScheduleDeliveryStatuses.FAILED
        ? ScheduleRunStatuses.SUCCEEDED
        : ScheduleRunStatuses.FAILED;

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
        overallStatus === ScheduleRunStatuses.SUCCEEDED
          ? SchedulerAuditEvents.SCHEDULE_RUN_COMPLETED
          : SchedulerAuditEvents.SCHEDULE_RUN_FAILED,
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
        overallStatus === ScheduleRunStatuses.SUCCEEDED
          ? "Schedule run completed successfully."
          : "Schedule run finished with failure.",
    });
  }
}
