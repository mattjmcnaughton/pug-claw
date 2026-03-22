import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import type { Logger } from "../../src/logger.ts";
import type { SchedulerOutputSink } from "../../src/scheduler/output.ts";
import { SchedulerRuntime } from "../../src/scheduler/runtime.ts";
import type { ResolvedConfig } from "../../src/resources.ts";
import { FakeDriver } from "../fakes/fake-driver.ts";

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-scheduler-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for predicate");
    }
    await Bun.sleep(25);
  }
}

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  debug: () => {},
} as unknown as Logger;

class FakeOutputSink implements SchedulerOutputSink {
  sent: Array<{ channelId: string; text: string }> = [];

  async sendDiscordMessage(channelId: string, text: string): Promise<void> {
    this.sent.push({ channelId, text });
  }
}

function makeConfig(homeDir: string): ResolvedConfig {
  const agentsDir = resolve(homeDir, "agents");
  const internalDir = resolve(homeDir, "internal");
  const dataDir = resolve(homeDir, "data");
  const codeDir = resolve(homeDir, "code");
  const logsDir = resolve(homeDir, "logs");
  mkdirSync(resolve(agentsDir, "writer"), { recursive: true });
  writeFileSync(resolve(agentsDir, "writer", "SYSTEM.md"), "writer system");

  return {
    homeDir,
    agentsDir,
    skillsDir: resolve(homeDir, "skills"),
    internalDir,
    dataDir,
    codeDir,
    logsDir,
    defaultAgent: "writer",
    defaultDriver: "fake",
    drivers: {},
    channels: {},
    scheduler: {
      timezone: "UTC",
    },
    schedules: {
      "daily-summary": {
        enabled: true,
        cron: "0 9 * * *",
        agent: "writer",
        prompt: "Say hello",
        output: {
          type: "discord_channel",
          channelId: "channel-123",
        },
      },
    },
    secrets: {
      get: () => undefined,
      require: (key: string) => key,
    },
  };
}

describe("SchedulerRuntime", () => {
  test("manual run records metadata, audit log, and delivery", async () => {
    const homeDir = makeTmpDir();
    const outputSink = new FakeOutputSink();
    const driver = new FakeDriver({ defaultModel: "fake-model" });
    driver.setDefaultResponse("scheduled hello");

    const config = makeConfig(homeDir);
    const runtime = new SchedulerRuntime({
      drivers: { fake: driver },
      config,
      pluginDirs: new Map(),
      resolveAgent: () => ({
        systemPrompt: "system",
        skills: [],
      }),
      logger: noopLogger,
      outputSink,
    });

    try {
      runtime.initialize();
      const result = runtime.runSchedule("daily-summary");
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("Expected manual run to start");
      }

      await waitFor(() => {
        const summary = runtime.listSchedules()[0];
        return summary?.lastRun?.status === "succeeded";
      });

      const summary = runtime.listSchedules()[0];
      expect(summary?.lastRun?.runId).toBe(result.runId);
      expect(summary?.lastRun?.deliveryStatus).toBe("succeeded");
      expect(outputSink.sent).toEqual([
        {
          channelId: "channel-123",
          text: "scheduled hello",
        },
      ]);

      const auditLogPath = resolve(
        config.logsDir,
        "schedules",
        `${new Date().toISOString().slice(0, 10)}.jsonl`,
      );
      expect(existsSync(auditLogPath)).toBe(true);
      const auditText = readFileSync(auditLogPath, "utf-8");
      expect(auditText).toContain(result.runId);
      expect(auditText).toContain("scheduled hello");
    } finally {
      runtime.stop();
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
