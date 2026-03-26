import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { Driver, DriverResponse } from "../../src/drivers/types.ts";
import type { ResolvedConfig } from "../../src/resources.ts";
import {
  SchedulerRunner,
  type SchedulerRunnerContext,
  type SchedulerRunnerRuntime,
} from "../../src/scheduler/runner.ts";
import type {
  SchedulerAuditEvent,
  ResolvedSchedule,
} from "../../src/scheduler/types.ts";

function createBaseConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
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
    ...overrides,
  };
}

function createSchedule(
  overrides?: Partial<ResolvedSchedule>,
): ResolvedSchedule {
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
    ...overrides,
  };
}

function createMockDriver(overrides?: Partial<Driver>): Driver {
  return {
    name: "claude",
    availableModels: { "claude-sonnet": "Claude Sonnet" },
    defaultModel: "claude-sonnet",
    createSession: async () => "session-1",
    query: async (): Promise<DriverResponse> => ({
      text: "Agent response text.",
      sessionId: "session-1",
    }),
    destroySession: async () => {},
    ...overrides,
  };
}

interface RunnerFixture {
  runner: SchedulerRunner;
  insertedRuns: Array<Record<string, unknown>>;
  updatedRuns: Array<{ runId: string; updates: Record<string, unknown> }>;
  auditEvents: SchedulerAuditEvent[];
  errors: string[];
  sentMessages: Array<{ channelId: string; text: string }>;
}

function createRunnerFixture(
  runtime: SchedulerRunnerRuntime,
  contextOverrides?: Partial<SchedulerRunnerContext>,
): RunnerFixture {
  const insertedRuns: Array<Record<string, unknown>> = [];
  const updatedRuns: Array<{
    runId: string;
    updates: Record<string, unknown>;
  }> = [];
  const auditEvents: SchedulerAuditEvent[] = [];
  const errors: string[] = [];
  const sentMessages: Array<{ channelId: string; text: string }> = [];

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
      updateRun: (runId: string, updates: Record<string, unknown>) => {
        updatedRuns.push({ runId, updates });
      },
    } as unknown as SchedulerRunnerContext["store"],
    auditLog: {
      append: (event: SchedulerAuditEvent) => {
        auditEvents.push(event);
      },
    } as unknown as SchedulerRunnerContext["auditLog"],
    outputSink: {
      sendDiscordMessage: async (channelId: string, text: string) => {
        sentMessages.push({ channelId, text });
      },
    },
    ...contextOverrides,
  };

  return {
    runner: new SchedulerRunner(context, runtime),
    insertedRuns,
    updatedRuns,
    auditEvents,
    errors,
    sentMessages,
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
    expect(fixture.insertedRuns[0]?.finishedAt).toBe(
      "2026-01-02T03:04:05.000Z",
    );
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

describe("SchedulerRunner full lifecycle", () => {
  const runtime: SchedulerRunnerRuntime = {
    makeRunId: () => "sched_lifecycle",
    makeNowIso: () => "2026-02-01T10:00:00.000Z",
  };

  function createLifecycleFixture(
    driverOverrides?: Partial<Driver>,
    contextOverrides?: Partial<SchedulerRunnerContext>,
  ): RunnerFixture {
    const driver = createMockDriver(driverOverrides);
    return createRunnerFixture(runtime, {
      drivers: { claude: driver },
      config: createBaseConfig({
        scheduler: { timezone: "UTC" },
      }),
      resolveAgent: () => ({
        systemPrompt: "You are a writer.",
        skills: [],
        memory: false,
      }),
      ...contextOverrides,
    });
  }

  test("successful execution delivers to Discord and finalizes as succeeded", async () => {
    const fixture = createLifecycleFixture();
    const schedule = createSchedule();

    fixture.runner.startRun(schedule, "cron");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.runner.isRunning(schedule.name)).toBe(false);
    expect(fixture.errors).toHaveLength(0);

    // Verify store was updated with success
    expect(fixture.updatedRuns).toHaveLength(1);
    expect(fixture.updatedRuns[0]?.updates).toMatchObject({
      status: "succeeded",
      executionStatus: "succeeded",
      deliveryStatus: "succeeded",
    });
    expect(fixture.updatedRuns[0]?.updates.errorMessage).toBeUndefined();

    // Verify Discord delivery
    expect(fixture.sentMessages).toHaveLength(1);
    expect(fixture.sentMessages[0]?.channelId).toBe("12345");
    expect(fixture.sentMessages[0]?.text).toBe("Agent response text.");
  });

  test("execution failure still delivers failure message and finalizes as failed", async () => {
    const fixture = createLifecycleFixture({
      query: async () => {
        throw new Error("Driver crashed");
      },
    });
    const schedule = createSchedule();

    fixture.runner.startRun(schedule, "manual");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.errors).toContain("schedule_run_execution_error");

    // Still delivers a failure message to Discord
    expect(fixture.sentMessages).toHaveLength(1);
    expect(fixture.sentMessages[0]?.text).toContain("failed");
    expect(fixture.sentMessages[0]?.text).toContain("sched_lifecycle");

    // Finalized as failed
    expect(fixture.updatedRuns).toHaveLength(1);
    expect(fixture.updatedRuns[0]?.updates).toMatchObject({
      status: "failed",
      executionStatus: "failed",
      deliveryStatus: "succeeded",
    });
    expect(fixture.updatedRuns[0]?.updates.errorMessage).toBe("Driver crashed");
  });

  test("delivery failure with successful execution sets overall status to failed", async () => {
    const fixture = createLifecycleFixture(undefined, {
      outputSink: {
        sendDiscordMessage: async () => {
          throw new Error("Discord unavailable");
        },
      },
    });
    const schedule = createSchedule();

    fixture.runner.startRun(schedule, "cron");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.errors).toContain("schedule_run_delivery_error");

    expect(fixture.updatedRuns).toHaveLength(1);
    expect(fixture.updatedRuns[0]?.updates).toMatchObject({
      status: "failed",
      executionStatus: "succeeded",
      deliveryStatus: "failed",
    });
    // Delivery error overrides errorMessage when execution succeeded
    expect(fixture.updatedRuns[0]?.updates.errorMessage).toBe(
      "Discord unavailable",
    );
  });

  test("missing timezone throws and surfaces as unhandled error", async () => {
    const fixture = createRunnerFixture(runtime, {
      drivers: { claude: createMockDriver() },
      config: createBaseConfig(), // no scheduler.timezone
      resolveAgent: () => ({
        systemPrompt: "You are a writer.",
        skills: [],
        memory: false,
      }),
    });
    const schedule = createSchedule();

    fixture.runner.startRun(schedule, "cron");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.errors).toContain("schedule_run_unhandled_error");
  });

  test("unknown driver throws and surfaces as unhandled error", async () => {
    const fixture = createRunnerFixture(runtime, {
      drivers: {}, // no drivers registered
      config: createBaseConfig({
        scheduler: { timezone: "UTC" },
      }),
      resolveAgent: () => ({
        systemPrompt: "You are a writer.",
        skills: [],
        memory: false,
      }),
    });
    const schedule = createSchedule();

    fixture.runner.startRun(schedule, "cron");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.errors).toContain("schedule_run_unhandled_error");
  });

  test("session destroy failure after successful execution marks execution as failed", async () => {
    const fixture = createLifecycleFixture({
      destroySession: async () => {
        throw new Error("Session cleanup failed");
      },
    });
    const schedule = createSchedule();

    fixture.runner.startRun(schedule, "cron");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.errors).toContain("schedule_run_destroy_session_error");

    expect(fixture.updatedRuns).toHaveLength(1);
    expect(fixture.updatedRuns[0]?.updates).toMatchObject({
      status: "failed",
      executionStatus: "failed",
    });
    expect(fixture.updatedRuns[0]?.updates.errorMessage).toBe(
      "Session cleanup failed",
    );
  });

  test("empty response skips delivery and finalizes as succeeded", async () => {
    const fixture = createLifecycleFixture({
      query: async (): Promise<DriverResponse> => ({
        text: "   ",
        sessionId: "session-1",
      }),
    });
    const schedule = createSchedule();

    fixture.runner.startRun(schedule, "cron");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.errors).toHaveLength(0);

    // No Discord message sent for empty response
    expect(fixture.sentMessages).toHaveLength(0);

    expect(fixture.updatedRuns).toHaveLength(1);
    expect(fixture.updatedRuns[0]?.updates).toMatchObject({
      status: "succeeded",
      executionStatus: "succeeded",
      deliveryStatus: "not_applicable",
    });
  });

  test("schedule without output skips delivery entirely", async () => {
    const fixture = createLifecycleFixture();
    const schedule = createSchedule({ output: undefined });

    fixture.runner.startRun(schedule, "cron");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.errors).toHaveLength(0);
    expect(fixture.sentMessages).toHaveLength(0);

    expect(fixture.updatedRuns).toHaveLength(1);
    expect(fixture.updatedRuns[0]?.updates).toMatchObject({
      status: "succeeded",
      executionStatus: "succeeded",
      deliveryStatus: "not_applicable",
    });
  });
});
