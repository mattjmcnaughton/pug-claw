import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../../src/resources.ts";

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-scheduler-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
      saved[key] = process.env[key];
    }

    try {
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await fn();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  };
}

function writeHomeConfig(homeDir: string, config: unknown): void {
  mkdirSync(resolve(homeDir, "agents", "writer"), { recursive: true });
  writeFileSync(resolve(homeDir, "agents", "writer", "SYSTEM.md"), "writer");
  writeFileSync(
    resolve(homeDir, "config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

describe("scheduler config validation", () => {
  test(
    "resolveConfig honors PUG_CLAW_LOGS_DIR",
    withEnv({ PUG_CLAW_LOGS_DIR: "custom-logs" }, async () => {
      const homeDir = makeTmpDir();
      try {
        writeHomeConfig(homeDir, {
          default_agent: "writer",
          default_driver: "claude",
        });

        const config = await resolveConfig({ home: homeDir });
        expect(config.logsDir).toBe(resolve(homeDir, "custom-logs"));
      } finally {
        rmSync(homeDir, { recursive: true, force: true });
      }
    }),
  );

  test("rejects invalid scheduler timezone", async () => {
    const homeDir = makeTmpDir();
    try {
      writeHomeConfig(homeDir, {
        default_agent: "writer",
        default_driver: "claude",
        scheduler: {
          timezone: "Not/A_Timezone",
        },
        schedules: {
          "daily-summary": {
            cron: "0 9 * * *",
            agent: "writer",
            prompt: "hello",
          },
        },
      });

      await expect(resolveConfig({ home: homeDir })).rejects.toThrow(
        'Invalid scheduler timezone "Not/A_Timezone"',
      );
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("rejects schedules with unknown agents", async () => {
    const homeDir = makeTmpDir();
    try {
      mkdirSync(resolve(homeDir, "agents"), { recursive: true });
      writeFileSync(
        resolve(homeDir, "config.json"),
        `${JSON.stringify(
          {
            default_agent: "writer",
            default_driver: "claude",
            scheduler: {
              timezone: "UTC",
            },
            schedules: {
              "daily-summary": {
                cron: "0 9 * * *",
                agent: "missing-agent",
                prompt: "hello",
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      await expect(resolveConfig({ home: homeDir })).rejects.toThrow(
        'Schedule "daily-summary" references unknown agent "missing-agent"',
      );
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("rejects channels with unknown drivers", async () => {
    const homeDir = makeTmpDir();
    try {
      writeHomeConfig(homeDir, {
        default_agent: "writer",
        default_driver: "claude",
        channels: {
          "channel-1": {
            driver: "unknown-driver",
          },
        },
      });

      await expect(resolveConfig({ home: homeDir })).rejects.toThrow(
        'Channel "channel-1" references unknown driver "unknown-driver"',
      );
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("rejects schedules with invalid cron expressions", async () => {
    const homeDir = makeTmpDir();
    try {
      writeHomeConfig(homeDir, {
        default_agent: "writer",
        default_driver: "claude",
        scheduler: {
          timezone: "UTC",
        },
        schedules: {
          "daily-summary": {
            cron: "bad cron",
            agent: "writer",
            prompt: "hello",
          },
        },
      });

      await expect(resolveConfig({ home: homeDir })).rejects.toThrow(
        'Invalid cron expression "bad cron"',
      );
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
