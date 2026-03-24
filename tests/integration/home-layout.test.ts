import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { ensureHomeDirectories } from "../../src/commands/init.ts";
import { Paths } from "../../src/constants.ts";
import { ensureResolvedHomeLayout } from "../../src/layout.ts";
import type { ResolvedConfig } from "../../src/resources.ts";

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-home-layout-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConfig(homeDir: string): ResolvedConfig {
  return {
    homeDir,
    agentsDir: resolve(homeDir, "custom-agents"),
    skillsDir: resolve(homeDir, "custom-skills"),
    internalDir: resolve(homeDir, "runtime"),
    dataDir: resolve(homeDir, "workspace-data"),
    codeDir: resolve(homeDir, "workspace-code"),
    logsDir: resolve(homeDir, "var/logs"),
    backupIncludeDirs: [],
    memory: {
      enabled: true,
      injectionBudgetTokens: 2000,
      embeddings: {
        enabled: false,
        model: "Xenova/all-MiniLM-L6-v2",
      },
      seed: {
        global: [],
      },
    },
    defaultAgent: "default",
    defaultDriver: "claude",
    drivers: {},
    channels: {},
    schedules: {},
    secrets: {
      get: () => undefined,
      require: (key: string) => key,
    },
  };
}

describe("home layout", () => {
  test("ensureHomeDirectories creates the refactored default directory structure", () => {
    const homeDir = makeTmpDir();

    try {
      ensureHomeDirectories(homeDir);

      expect(existsSync(resolve(homeDir, Paths.AGENTS_DIR))).toBe(true);
      expect(existsSync(resolve(homeDir, Paths.SKILLS_DIR))).toBe(true);
      expect(existsSync(resolve(homeDir, Paths.INTERNAL_DIR))).toBe(true);
      expect(
        existsSync(resolve(homeDir, Paths.INTERNAL_DIR, Paths.PLUGINS_DIR)),
      ).toBe(true);
      expect(existsSync(resolve(homeDir, Paths.DATA_DIR))).toBe(true);
      expect(existsSync(resolve(homeDir, Paths.CODE_DIR))).toBe(true);
      expect(
        existsSync(resolve(homeDir, Paths.LOGS_DIR, Paths.SYSTEM_LOG_DIR)),
      ).toBe(true);
      expect(
        existsSync(resolve(homeDir, Paths.LOGS_DIR, Paths.SCHEDULES_LOG_DIR)),
      ).toBe(true);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("ensureResolvedHomeLayout creates the resolved directory structure", () => {
    const homeDir = makeTmpDir();
    const config = makeConfig(homeDir);

    try {
      ensureResolvedHomeLayout(config);

      expect(existsSync(config.agentsDir)).toBe(true);
      expect(existsSync(config.skillsDir)).toBe(true);
      expect(existsSync(config.internalDir)).toBe(true);
      expect(existsSync(resolve(config.internalDir, Paths.PLUGINS_DIR))).toBe(
        true,
      );
      expect(existsSync(config.dataDir)).toBe(true);
      expect(existsSync(config.codeDir)).toBe(true);
      expect(existsSync(resolve(config.logsDir, Paths.SYSTEM_LOG_DIR))).toBe(
        true,
      );
      expect(existsSync(resolve(config.logsDir, Paths.SCHEDULES_LOG_DIR))).toBe(
        true,
      );
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
