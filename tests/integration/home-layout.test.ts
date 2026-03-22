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
import { ensureHomeDirectories } from "../../src/commands/init.ts";
import { Paths } from "../../src/constants.ts";
import type { Logger } from "../../src/logger.ts";
import { migrateLegacyHomeLayout } from "../../src/migration.ts";
import type { ResolvedConfig } from "../../src/resources.ts";

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-home-layout-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  debug: () => {},
} as unknown as Logger;

function makeConfig(homeDir: string): ResolvedConfig {
  return {
    homeDir,
    agentsDir: resolve(homeDir, Paths.AGENTS_DIR),
    skillsDir: resolve(homeDir, Paths.SKILLS_DIR),
    internalDir: resolve(homeDir, Paths.INTERNAL_DIR),
    dataDir: resolve(homeDir, Paths.DATA_DIR),
    codeDir: resolve(homeDir, Paths.CODE_DIR),
    logsDir: resolve(homeDir, Paths.LOGS_DIR),
    backupIncludeDirs: [],
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
  test("ensureHomeDirectories creates the refactored directory structure", () => {
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

  test("migrateLegacyHomeLayout moves runtime files into internal and is idempotent", () => {
    const homeDir = makeTmpDir();
    const config = makeConfig(homeDir);

    try {
      mkdirSync(resolve(homeDir, Paths.DATA_DIR, Paths.LOCKS_DIR), {
        recursive: true,
      });
      mkdirSync(resolve(homeDir, Paths.PLUGINS_DIR, "demo-plugin"), {
        recursive: true,
      });
      writeFileSync(
        resolve(homeDir, Paths.DATA_DIR, Paths.RUNTIME_DB_FILE),
        "legacy-db",
      );
      writeFileSync(
        resolve(homeDir, Paths.DATA_DIR, `${Paths.RUNTIME_DB_FILE}-wal`),
        "legacy-wal",
      );
      writeFileSync(
        resolve(homeDir, Paths.DATA_DIR, Paths.LOCKS_DIR, "lock.txt"),
        "legacy-lock",
      );
      writeFileSync(
        resolve(homeDir, Paths.PLUGINS_DIR, "demo-plugin", "plugin.json"),
        "legacy-plugin",
      );
      writeFileSync(
        resolve(homeDir, Paths.DATA_DIR, "user-notes.txt"),
        "keep me in data",
      );

      migrateLegacyHomeLayout(config, noopLogger);
      migrateLegacyHomeLayout(config, noopLogger);

      expect(
        existsSync(resolve(config.internalDir, Paths.RUNTIME_DB_FILE)),
      ).toBe(true);
      expect(
        readFileSync(
          resolve(config.internalDir, Paths.RUNTIME_DB_FILE),
          "utf-8",
        ),
      ).toBe("legacy-db");
      expect(
        existsSync(resolve(config.internalDir, `${Paths.RUNTIME_DB_FILE}-wal`)),
      ).toBe(true);
      expect(
        existsSync(resolve(config.internalDir, Paths.LOCKS_DIR, "lock.txt")),
      ).toBe(true);
      expect(
        existsSync(
          resolve(
            config.internalDir,
            Paths.PLUGINS_DIR,
            "demo-plugin",
            "plugin.json",
          ),
        ),
      ).toBe(true);

      expect(existsSync(resolve(config.dataDir, Paths.RUNTIME_DB_FILE))).toBe(
        false,
      );
      expect(existsSync(resolve(homeDir, Paths.PLUGINS_DIR))).toBe(false);
      expect(
        readFileSync(resolve(config.dataDir, "user-notes.txt"), "utf-8"),
      ).toBe("keep me in data");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
