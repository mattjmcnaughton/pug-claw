import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { ResolvedConfig } from "../../src/resources.ts";
import {
  SchedulerRunner,
  type SchedulerRunnerContext,
  type SchedulerRunnerRuntime,
} from "../../src/scheduler/runner.ts";
import type { SchedulerAuditEvent, ResolvedSchedule } from "../../src/scheduler/types.ts";

function createBaseConfig(): ResolvedConfig {
  return {
    homeDir: "/tmp/pug-claw-home",
    agentsDir: "/tmp/pug-claw-home/agents",
    skillsDir: "/tmp/pug-claw-home/skills",
    internalDir: "/tmp/pug-claw-home/internal",
    dataDir: "/tmp/pug-claw-home/data",
    codeDir: "/tmp/pug-claw-home/code",
    logsDir: "/tmp/pug-claw-home/logs",
    backupIncludeDirs: [],
    memory: {
      enabled: false,
      injectionBudgetTokens: 2000,
      embeddings: {
        enabled: false,
        model: "Xenova/all-MiniLM-L6-v2",
      },
      seed: {
        global: [],
      },
    },
    defaultAgent: "writer",
    defaultDriver: "claude",
    drivers: {},
    channels: {},
    schedules: {},
    secrets: {
      get: () => undefined,
      require: () => {
        throw new Error("unused");
      },
    },
  };
}

function createSchedule(): ResolvedSchedule {
  return {
    name: "daily-summary",
    enabled: true,
    cron: "0 9 * * *",
    agent: "writer",
    prompt: "Summarize yesterday's progress.",
    output: {
      type: "discord_channel",
      channelId: "12345",
    },
  };
}

function createRunnerFixture(runtime: SchedulerRunnerRuntime): {
  runner: SchedulerRunner;
  insertedRuns: Array<Record<string, unknown>>;
  auditEvents: SchedulerAuditEvent[];
  errors: string[];
} {
  const insertedRuns: Array<Record<string, unknown>> = [];
  const auditEvents: SchedulerAuditEvent[] = [];
  const errors: string[] = [];

  const logger = {
    error: (_obj: unknown, message: string) => {
      errors.push(message);
    },
  } as unknown as Logger;

  const context: SchedulerRunnerContext = {
    drivers: {},
    config: createBaseConfig(),
    pluginDirs: new Map(),
    resolveAgent: () => {
      throw new Error("unused");
    },
    logger,
    store: {
      insertRun: (record: Record<string, unknown>) => {
        insertedRuns.push(record);
      },
      updateRun: () => {},
    } as unknown as SchedulerRunnerContext["store"],
    auditLog: {
      append: (event: SchedulerAuditEvent) => {
        auditEvents.push(event);
      },
    } as unknown as SchedulerRunnerContext["auditLog"],
    outputSink: {
      sendDiscordMessage: async () => {},
    },
  };

  return {
    runner: new SchedulerRunner(context, runtime),
    insertedRuns,
    auditEvents,
    errors,
  };
}

describe("SchedulerRunner deterministic seams", () => {
  test("recordOverlapSkip uses injected run id and timestamp", () => {
    const fixture = createRunnerFixture({
      makeRunId: () => "sched_fixed_overlap",
      makeNowIso: () => "2026-01-02T03:04:05.000Z",
    });
    const schedule = createSchedule();

    const runId = fixture.runner.recordOverlapSkip(schedule, "cron", "UTC");

    expect(runId).toBe("sched_fixed_overlap");
    expect(fixture.insertedRuns).toHaveLength(1);
    expect(fixture.insertedRuns[0]?.runId).toBe("sched_fixed_overlap");
    expect(fixture.insertedRuns[0]?.startedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(fixture.insertedRuns[0]?.finishedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(fixture.auditEvents).toHaveLength(1);
    expect(fixture.auditEvents[0]?.ts).toBe("2026-01-02T03:04:05.000Z");
  });

  test("startRun returns deterministic run id and clears running state after failure", async () => {
    const fixture = createRunnerFixture({
      makeRunId: () => "sched_fixed_start",
      makeNowIso: () => "2026-01-03T04:05:06.000Z",
    });
    const schedule = createSchedule();

    const result = fixture.runner.startRun(schedule, "manual");

    expect(result).toEqual({
      started: true,
      runId: "sched_fixed_start",
    });
    expect(fixture.runner.isRunning(schedule.name)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.runner.isRunning(schedule.name)).toBe(false);
    expect(fixture.errors).toContain("schedule_run_unhandled_error");
  });
});
