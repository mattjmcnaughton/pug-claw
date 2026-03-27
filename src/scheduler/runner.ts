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
  memoryBackend?: MemoryBackend | undefined;
}

export interface SchedulerRunnerRuntime {
  makeRunId: () => string;
  makeNowIso: () => string;
}

export interface StartScheduleRunResult {
  started: boolean;
  runId?: string;
  reason?: "already_running";
}

interface PreparedRunContext {
  runId: string;
  schedule: ResolvedSchedule;
  triggerSource: ScheduleTriggerSource;
  timezone: string;
  driver: Driver;
  driverName: string;
  modelName: string;
  resolvedAgent: ResolvedAgent;
  deliveryStatus: ScheduleDeliveryStatus;
}

interface ExecutionOutcome {
  responseText: string;
  emptyResponse: boolean;
  executionStatus: ScheduleExecutionStatus;
  errorMessage?: string | undefined;
}

interface DeliveryOutcome {
  deliveryStatus: ScheduleDeliveryStatus;
  errorMessage?: string | undefined;
}

const SchedulerRunnerMessages = {
  OVERLAP_SKIP_ERROR: "Skipped because the previous run was still in progress.",
  OVERLAP_SKIP_AUDIT: "Skipped due to overlapping run.",
  EMPTY_RESPONSE: "(no response)",
  RUN_COMPLETED_SUCCESS: "Schedule run completed successfully.",
  RUN_COMPLETED_FAILURE: "Schedule run finished with failure.",
} as const;

function formatUnknownDriverMessage(driverName: string): string {
  return `Unknown driver: ${driverName}`;
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

  constructor(
    private ctx: SchedulerRunnerContext,
    private runtime: SchedulerRunnerRuntime = {
      makeRunId,
      makeNowIso,
    },
  ) {}

  private getRunId(): string {
    return this.runtime.makeRunId();
  }

  private nowIso(): string {
    return this.runtime.makeNowIso();
  }

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
    if (
      !resolvedAgent.memory ||
      !this.ctx.memoryBackend ||
      !this.ctx.config.memory.enabled
    ) {
      return undefined;
    }

    const memoryBlock = await buildMemoryBlockForAgent(
      this.ctx.memoryBackend,
      schedule.agent,
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

    const runId = this.getRunId();
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
    const runId = this.getRunId();
    const nowIso = this.nowIso();
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
      errorMessage: SchedulerRunnerMessages.OVERLAP_SKIP_ERROR,
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
      message: SchedulerRunnerMessages.OVERLAP_SKIP_AUDIT,
    });
    return runId;
  }

  private buildAuditOutput(schedule: ResolvedSchedule): {
    type: NonNullable<ResolvedSchedule["output"]>["type"];
    channel_id: string;
  } | null {
    if (!schedule.output) {
      return null;
    }

    return {
      type: schedule.output.type,
      channel_id: schedule.output.channelId,
    };
  }

  private prepareRunContext(
    runId: string,
    schedule: ResolvedSchedule,
    triggerSource: ScheduleTriggerSource,
  ): PreparedRunContext {
    const timezone = this.ctx.config.timezone;

    const agentDir = resolve(this.ctx.config.agentsDir, schedule.agent);
    const resolvedAgent = this.ctx.resolveAgent(agentDir);
    const driverName = resolveDriverName({
      runtimeOverride: schedule.driver,
      agentFrontmatter: resolvedAgent.driver,
      globalDefault: this.ctx.config.defaultDriver,
    });
    const driver = this.ctx.drivers[driverName];
    if (!driver) {
      throw new Error(formatUnknownDriverMessage(driverName));
    }

    const modelName = resolveModelName({
      runtimeOverride: schedule.model,
      agentFrontmatter: resolvedAgent.model,
      driverDefault: driver.defaultModel,
    });

    const startedAt = this.nowIso();
    const deliveryStatus = getInitialDeliveryStatus(schedule);
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
      outputType: schedule.output?.type,
      outputTarget: schedule.output?.channelId,
      executionStatus: ScheduleExecutionStatuses.RUNNING,
      deliveryStatus,
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
      output: this.buildAuditOutput(schedule),
      status: ScheduleRunStatuses.RUNNING,
      message: "Schedule run started.",
    });

    return {
      runId,
      schedule,
      triggerSource,
      timezone,
      driver,
      driverName,
      modelName,
      resolvedAgent,
      deliveryStatus,
    };
  }

  private async executeAgentRun(
    ctx: PreparedRunContext,
  ): Promise<ExecutionOutcome> {
    let sessionId: string | undefined;
    let responseText = "";
    let emptyResponse = false;
    let executionStatus: ScheduleExecutionStatus =
      ScheduleExecutionStatuses.RUNNING;
    let errorMessage: string | undefined;

    try {
      const driverCwd = this.ctx.config.drivers[ctx.driverName]?.cwd;
      const cwd = driverCwd
        ? resolve(expandTilde(driverCwd))
        : this.ctx.config.homeDir;
      const memoryToolContext = this.getMemoryToolContext(
        ctx.schedule,
        ctx.resolvedAgent,
      );
      const memoryBlock = await this.buildMemoryBlock(
        ctx.schedule,
        ctx.resolvedAgent,
      );
      const systemPrompt = memoryToolContext
        ? `${ctx.resolvedAgent.systemPrompt}\n\n${buildMemoryToolInstructions()}`
        : ctx.resolvedAgent.systemPrompt;

      sessionId = await ctx.driver.createSession({
        systemPrompt,
        model: ctx.modelName,
        skills: ctx.resolvedAgent.skills,
        memoryBlock,
        memoryToolContext,
        pluginDir: this.ctx.pluginDirs.get(ctx.schedule.agent),
        cwd,
        timezone: this.ctx.config.timezone,
      });

      const response = await ctx.driver.query(
        sessionId,
        ctx.schedule.prompt,
        (event) => {
          if (event.type === "tool_use") {
            this.ctx.auditLog.append({
              ts: this.nowIso(),
              event: SchedulerAuditEvents.SCHEDULE_RUN_OUTPUT,
              run_id: ctx.runId,
              schedule_name: ctx.schedule.name,
              trigger_source: ctx.triggerSource,
              agent: ctx.schedule.agent,
              driver: ctx.driverName,
              model: ctx.modelName,
              cron_expression: ctx.schedule.cron,
              timezone: ctx.timezone,
              output: this.buildAuditOutput(ctx.schedule),
              message: `Tool used: ${event.tool}`,
            });
          }
        },
      );
      emptyResponse = !response.text.trim();
      responseText = emptyResponse
        ? SchedulerRunnerMessages.EMPTY_RESPONSE
        : response.text;
      executionStatus = ScheduleExecutionStatuses.SUCCEEDED;

      this.ctx.auditLog.append({
        ts: this.nowIso(),
        event: SchedulerAuditEvents.SCHEDULE_RUN_OUTPUT,
        run_id: ctx.runId,
        schedule_name: ctx.schedule.name,
        trigger_source: ctx.triggerSource,
        agent: ctx.schedule.agent,
        driver: ctx.driverName,
        model: ctx.modelName,
        cron_expression: ctx.schedule.cron,
        timezone: ctx.timezone,
        output: this.buildAuditOutput(ctx.schedule),
        response_text: responseText,
        message: "Schedule run produced output.",
      });
    } catch (err) {
      const error = toError(err);
      executionStatus = ScheduleExecutionStatuses.FAILED;
      errorMessage = error.message;
      this.ctx.logger.error(
        { err: error, run_id: ctx.runId, schedule_name: ctx.schedule.name },
        "schedule_run_execution_error",
      );
      this.ctx.auditLog.append({
        ts: this.nowIso(),
        event: SchedulerAuditEvents.SCHEDULE_RUN_FAILED,
        run_id: ctx.runId,
        schedule_name: ctx.schedule.name,
        trigger_source: ctx.triggerSource,
        agent: ctx.schedule.agent,
        driver: ctx.driverName,
        model: ctx.modelName,
        cron_expression: ctx.schedule.cron,
        timezone: ctx.timezone,
        output: this.buildAuditOutput(ctx.schedule),
        status: ScheduleRunStatuses.FAILED,
        error: error.message,
        message: "Schedule run failed during execution.",
      });
    } finally {
      if (sessionId) {
        try {
          await ctx.driver.destroySession(sessionId);
        } catch (err) {
          const error = toError(err);
          this.ctx.logger.error(
            { err: error, run_id: ctx.runId, schedule_name: ctx.schedule.name },
            "schedule_run_destroy_session_error",
          );
          if (executionStatus === ScheduleExecutionStatuses.SUCCEEDED) {
            executionStatus = ScheduleExecutionStatuses.FAILED;
            errorMessage = error.message;
            this.ctx.auditLog.append({
              ts: this.nowIso(),
              event: SchedulerAuditEvents.SCHEDULE_RUN_FAILED,
              run_id: ctx.runId,
              schedule_name: ctx.schedule.name,
              trigger_source: ctx.triggerSource,
              agent: ctx.schedule.agent,
              driver: ctx.driverName,
              model: ctx.modelName,
              cron_expression: ctx.schedule.cron,
              timezone: ctx.timezone,
              output: this.buildAuditOutput(ctx.schedule),
              status: ScheduleRunStatuses.FAILED,
              error: error.message,
              message: "Schedule run failed while destroying session.",
            });
          }
        }
      }
    }

    return {
      responseText,
      emptyResponse,
      executionStatus,
      errorMessage,
    };
  }

  private async deliverRunOutput(
    ctx: PreparedRunContext,
    execution: ExecutionOutcome,
  ): Promise<DeliveryOutcome> {
    let deliveryStatus = ctx.deliveryStatus;
    let errorMessage = execution.errorMessage;

    if (!ctx.schedule.output) {
      return { deliveryStatus, errorMessage };
    }

    if (
      execution.emptyResponse &&
      execution.executionStatus === ScheduleExecutionStatuses.SUCCEEDED
    ) {
      deliveryStatus = ScheduleDeliveryStatuses.NOT_APPLICABLE;
      this.ctx.auditLog.append({
        ts: this.nowIso(),
        event: SchedulerAuditEvents.SCHEDULE_RUN_DELIVERY_SUCCEEDED,
        run_id: ctx.runId,
        schedule_name: ctx.schedule.name,
        trigger_source: ctx.triggerSource,
        agent: ctx.schedule.agent,
        driver: ctx.driverName,
        model: ctx.modelName,
        cron_expression: ctx.schedule.cron,
        timezone: ctx.timezone,
        output: {
          type: ctx.schedule.output.type,
          channel_id: ctx.schedule.output.channelId,
        },
        delivery_status: ScheduleDeliveryStatuses.NOT_APPLICABLE,
        channel_id: ctx.schedule.output.channelId,
        message: "Delivery skipped: agent returned empty response.",
      });
      return { deliveryStatus, errorMessage };
    }

    const messageToSend =
      execution.executionStatus === ScheduleExecutionStatuses.SUCCEEDED
        ? execution.responseText
        : buildFailureMessage(ctx.schedule.name, ctx.runId);

    this.ctx.auditLog.append({
      ts: this.nowIso(),
      event: SchedulerAuditEvents.SCHEDULE_RUN_DELIVERY_STARTED,
      run_id: ctx.runId,
      schedule_name: ctx.schedule.name,
      trigger_source: ctx.triggerSource,
      agent: ctx.schedule.agent,
      driver: ctx.driverName,
      model: ctx.modelName,
      cron_expression: ctx.schedule.cron,
      timezone: ctx.timezone,
      output: {
        type: ctx.schedule.output.type,
        channel_id: ctx.schedule.output.channelId,
      },
      delivery_status: ScheduleDeliveryStatuses.PENDING,
      channel_id: ctx.schedule.output.channelId,
      message: "Schedule run delivery started.",
    });

    try {
      await this.ctx.outputSink.sendDiscordMessage(
        ctx.schedule.output.channelId,
        messageToSend,
      );
      deliveryStatus = ScheduleDeliveryStatuses.SUCCEEDED;
      this.ctx.auditLog.append({
        ts: this.nowIso(),
        event: SchedulerAuditEvents.SCHEDULE_RUN_DELIVERY_SUCCEEDED,
        run_id: ctx.runId,
        schedule_name: ctx.schedule.name,
        trigger_source: ctx.triggerSource,
        agent: ctx.schedule.agent,
        driver: ctx.driverName,
        model: ctx.modelName,
        cron_expression: ctx.schedule.cron,
        timezone: ctx.timezone,
        output: {
          type: ctx.schedule.output.type,
          channel_id: ctx.schedule.output.channelId,
        },
        delivery_status: ScheduleDeliveryStatuses.SUCCEEDED,
        channel_id: ctx.schedule.output.channelId,
        message: "Schedule run delivery succeeded.",
      });
    } catch (err) {
      const error = toError(err);
      deliveryStatus = ScheduleDeliveryStatuses.FAILED;
      if (execution.executionStatus === ScheduleExecutionStatuses.SUCCEEDED) {
        errorMessage = error.message;
      }
      this.ctx.logger.error(
        { err: error, run_id: ctx.runId, schedule_name: ctx.schedule.name },
        "schedule_run_delivery_error",
      );
      this.ctx.auditLog.append({
        ts: this.nowIso(),
        event: SchedulerAuditEvents.SCHEDULE_RUN_DELIVERY_FAILED,
        run_id: ctx.runId,
        schedule_name: ctx.schedule.name,
        trigger_source: ctx.triggerSource,
        agent: ctx.schedule.agent,
        driver: ctx.driverName,
        model: ctx.modelName,
        cron_expression: ctx.schedule.cron,
        timezone: ctx.timezone,
        output: {
          type: ctx.schedule.output.type,
          channel_id: ctx.schedule.output.channelId,
        },
        delivery_status: ScheduleDeliveryStatuses.FAILED,
        channel_id: ctx.schedule.output.channelId,
        error: error.message,
        message: "Schedule run delivery failed.",
      });
    }

    return { deliveryStatus, errorMessage };
  }

  private finalizeRun(
    ctx: PreparedRunContext,
    executionStatus: ScheduleExecutionStatus,
    deliveryStatus: ScheduleDeliveryStatus,
    errorMessage?: string,
  ): void {
    const overallStatus =
      executionStatus === ScheduleExecutionStatuses.SUCCEEDED &&
      deliveryStatus !== ScheduleDeliveryStatuses.FAILED
        ? ScheduleRunStatuses.SUCCEEDED
        : ScheduleRunStatuses.FAILED;

    const finishedAt = this.nowIso();
    this.ctx.store.updateRun(ctx.runId, {
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
      run_id: ctx.runId,
      schedule_name: ctx.schedule.name,
      trigger_source: ctx.triggerSource,
      agent: ctx.schedule.agent,
      driver: ctx.driverName,
      model: ctx.modelName,
      cron_expression: ctx.schedule.cron,
      timezone: ctx.timezone,
      output: this.buildAuditOutput(ctx.schedule),
      status: overallStatus,
      delivery_status: deliveryStatus,
      error: errorMessage,
      message:
        overallStatus === ScheduleRunStatuses.SUCCEEDED
          ? SchedulerRunnerMessages.RUN_COMPLETED_SUCCESS
          : SchedulerRunnerMessages.RUN_COMPLETED_FAILURE,
    });
  }

  private async executeRun(
    runId: string,
    schedule: ResolvedSchedule,
    triggerSource: ScheduleTriggerSource,
  ): Promise<void> {
    const prepared = this.prepareRunContext(runId, schedule, triggerSource);
    const execution = await this.executeAgentRun(prepared);
    const delivery = await this.deliverRunOutput(prepared, execution);
    this.finalizeRun(
      prepared,
      execution.executionStatus,
      delivery.deliveryStatus,
      delivery.errorMessage,
    );
  }
}
