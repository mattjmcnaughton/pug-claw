import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Cron } from "croner";
import { Defaults, Paths } from "../constants.ts";
import type { Driver } from "../drivers/types.ts";
import type { Logger } from "../logger.ts";
import type { MemoryBackend } from "../memory/types.ts";
import type { ResolvedConfig } from "../resources.ts";
import type { ResolvedAgent } from "../skills.ts";
import { SchedulerAuditLog } from "./audit-log.ts";
import { getResolvedSchedules } from "./config.ts";
import { SchedulerLock } from "./lock.ts";
import type { SchedulerOutputSink } from "./output.ts";
import { SchedulerRunner } from "./runner.ts";
import { SchedulerStore } from "./store.ts";
import {
  ScheduleTriggerSources,
  type ResolvedSchedule,
  type ScheduleSummary,
} from "./types.ts";

interface ScheduleState {
  schedule: ResolvedSchedule;
  cron: Cron;
  nextRunAt: Date | null;
}

interface SchedulerRuntimeContext {
  drivers: Record<string, Driver>;
  config: ResolvedConfig;
  pluginDirs: Map<string, string>;
  resolveAgent: (agentDir: string) => ResolvedAgent;
  logger: Logger;
  outputSink: SchedulerOutputSink;
  memoryBackend?: MemoryBackend | undefined;
}

export type RunScheduleResult =
  | { ok: true; runId: string }
  | { ok: false; reason: "inactive" | "not_found" | "already_running" };

export class SchedulerRuntime {
  private config: ResolvedConfig;
  private pluginDirs: Map<string, string>;
  private resolveAgent: (agentDir: string) => ResolvedAgent;
  private readonly store: SchedulerStore;
  private readonly auditLog: SchedulerAuditLog;
  private readonly runner: SchedulerRunner;
  private readonly lock: SchedulerLock;
  private readonly schedules = new Map<string, ScheduleState>();
  private interval: ReturnType<typeof setInterval> | undefined;
  private active = false;

  constructor(private ctx: SchedulerRuntimeContext) {
    this.config = ctx.config;
    this.pluginDirs = ctx.pluginDirs;
    this.resolveAgent = ctx.resolveAgent;

    mkdirSync(this.config.internalDir, { recursive: true });
    mkdirSync(this.config.logsDir, { recursive: true });

    const dbPath = resolve(this.config.internalDir, Paths.RUNTIME_DB_FILE);
    this.store = new SchedulerStore(dbPath, ctx.logger);
    this.auditLog = new SchedulerAuditLog(this.config.logsDir, ctx.logger);

    const lockDir = resolve(
      this.config.internalDir,
      Paths.LOCKS_DIR,
      Paths.SCHEDULER_LOCK_DIR,
    );
    const ownerFilePath = resolve(lockDir, Paths.SCHEDULER_LOCK_OWNER_FILE);
    this.lock = new SchedulerLock(
      lockDir,
      ownerFilePath,
      ctx.logger,
      (event) => {
        this.auditLog.append(event);
      },
    );

    this.runner = new SchedulerRunner({
      drivers: this.ctx.drivers,
      config: this.config,
      pluginDirs: this.pluginDirs,
      resolveAgent: this.resolveAgent,
      logger: this.ctx.logger,
      store: this.store,
      auditLog: this.auditLog,
      outputSink: this.ctx.outputSink,
      memoryBackend: this.ctx.memoryBackend,
    });
    this.refreshSchedules();
  }

  initialize(): void {
    this.store.init();
    this.store.markRunningRunsInterrupted(new Date().toISOString());

    const lockResult = this.lock.acquire();
    this.active = lockResult.acquired;

    if (!this.active) {
      this.ctx.logger.warn(
        {
          scheduler_owner_pid: lockResult.owner?.pid,
          scheduler_owner_hostname: lockResult.owner?.hostname,
        },
        "scheduler_lock_not_acquired",
      );
      return;
    }

    this.ctx.logger.info({}, "scheduler_started");
    this.startPolling();
  }

  isActive(): boolean {
    return this.active;
  }

  listSchedules(): ScheduleSummary[] {
    const latestRuns = this.store.getLatestRunsBySchedule();

    return [...this.schedules.values()].map((state) => ({
      schedule: state.schedule,
      nextRunAt: state.schedule.enabled ? state.nextRunAt : null,
      currentlyRunning: this.runner.isRunning(state.schedule.name),
      lastRun: latestRuns.get(state.schedule.name),
    }));
  }

  runSchedule(name: string): RunScheduleResult {
    if (!this.active) {
      return { ok: false, reason: "inactive" };
    }

    const state = this.schedules.get(name);
    if (!state) {
      return { ok: false, reason: "not_found" };
    }

    const result = this.runner.startRun(
      state.schedule,
      ScheduleTriggerSources.MANUAL,
    );
    if (!result.started) {
      return { ok: false, reason: "already_running" };
    }

    return {
      ok: true,
      runId: result.runId ?? "",
    };
  }

  reload(
    config: ResolvedConfig,
    pluginDirs: Map<string, string>,
    resolveAgent: (agentDir: string) => ResolvedAgent,
  ): void {
    this.config = config;
    this.pluginDirs = pluginDirs;
    this.resolveAgent = resolveAgent;
    this.runner.updateContext({
      drivers: this.ctx.drivers,
      config: this.config,
      pluginDirs: this.pluginDirs,
      resolveAgent: this.resolveAgent,
      logger: this.ctx.logger,
      store: this.store,
      auditLog: this.auditLog,
      outputSink: this.ctx.outputSink,
      memoryBackend: this.ctx.memoryBackend,
    });
    this.refreshSchedules();
    this.ctx.logger.info(
      { schedule_count: this.schedules.size },
      "scheduler_reloaded",
    );
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    this.lock.release();
    this.store.close();
  }

  private startPolling(): void {
    this.tick();
    this.interval = setInterval(() => {
      this.tick();
    }, Defaults.SCHEDULER_POLL_INTERVAL_MS);
    this.interval.unref?.();
  }

  private tick(): void {
    if (!this.active) {
      return;
    }

    const now = new Date();
    const timezone = this.config.scheduler?.timezone;
    if (!timezone) {
      return;
    }

    for (const state of this.schedules.values()) {
      if (!state.schedule.enabled || !state.nextRunAt) {
        continue;
      }

      if (state.nextRunAt.getTime() > now.getTime()) {
        continue;
      }

      if (this.runner.isRunning(state.schedule.name)) {
        this.runner.recordOverlapSkip(
          state.schedule,
          ScheduleTriggerSources.CRON,
          timezone,
        );
      } else {
        this.runner.startRun(state.schedule, ScheduleTriggerSources.CRON);
      }

      state.nextRunAt = state.cron.nextRun(now);
    }
  }

  private refreshSchedules(): void {
    this.schedules.clear();
    const timezone = this.config.scheduler?.timezone;
    if (!timezone) {
      return;
    }

    for (const schedule of getResolvedSchedules(this.config)) {
      const cron = new Cron(schedule.cron, {
        paused: true,
        timezone,
        mode: "5-part",
      });
      this.schedules.set(schedule.name, {
        schedule,
        cron,
        nextRunAt: schedule.enabled ? cron.nextRun() : null,
      });
    }
  }
}
