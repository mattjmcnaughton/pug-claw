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
import { Paths } from "../../src/constants.ts";
import { migrateHomeLayout } from "../../scripts/one-off/2026-03-21-migrate-home-layout.ts";

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-home-migration-script-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeHomeConfig(homeDir: string): void {
  mkdirSync(resolve(homeDir, Paths.AGENTS_DIR, "default"), { recursive: true });
  writeFileSync(
    resolve(homeDir, Paths.AGENTS_DIR, "default", Paths.SYSTEM_MD),
    "default system prompt",
  );
  writeFileSync(
    resolve(homeDir, Paths.CONFIG_FILE),
    `${JSON.stringify(
      {
        default_agent: "default",
        default_driver: "claude",
      },
      null,
      2,
    )}\n`,
  );
}

describe("home layout migration script", () => {
  test("dry run reports planned moves without changing the filesystem", async () => {
    const homeDir = makeTmpDir();

    try {
      writeHomeConfig(homeDir);
      mkdirSync(resolve(homeDir, Paths.DATA_DIR, Paths.LOCKS_DIR), {
        recursive: true,
      });
      mkdirSync(resolve(homeDir, Paths.PLUGINS_DIR), { recursive: true });
      writeFileSync(
        resolve(homeDir, Paths.DATA_DIR, Paths.RUNTIME_DB_FILE),
        "legacy-db",
      );

      const result = await migrateHomeLayout({
        homeDir,
        dryRun: true,
      });

      expect(result.performed).toBe(false);
      expect(result.moves).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: resolve(homeDir, Paths.DATA_DIR, Paths.RUNTIME_DB_FILE),
            to: resolve(homeDir, Paths.INTERNAL_DIR, Paths.RUNTIME_DB_FILE),
            action: "move",
          }),
        ]),
      );
      expect(
        existsSync(resolve(homeDir, Paths.DATA_DIR, Paths.RUNTIME_DB_FILE)),
      ).toBe(true);
      expect(
        existsSync(resolve(homeDir, Paths.INTERNAL_DIR, Paths.RUNTIME_DB_FILE)),
      ).toBe(false);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("migration moves runtime files into internal and preserves user data", async () => {
    const homeDir = makeTmpDir();

    try {
      writeHomeConfig(homeDir);
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

      const result = await migrateHomeLayout({
        homeDir,
      });

      expect(result.performed).toBe(true);
      expect(
        readFileSync(
          resolve(homeDir, Paths.INTERNAL_DIR, Paths.RUNTIME_DB_FILE),
          "utf-8",
        ),
      ).toBe("legacy-db");
      expect(
        readFileSync(
          resolve(homeDir, Paths.INTERNAL_DIR, `${Paths.RUNTIME_DB_FILE}-wal`),
          "utf-8",
        ),
      ).toBe("legacy-wal");
      expect(
        readFileSync(
          resolve(homeDir, Paths.INTERNAL_DIR, Paths.LOCKS_DIR, "lock.txt"),
          "utf-8",
        ),
      ).toBe("legacy-lock");
      expect(
        readFileSync(
          resolve(
            homeDir,
            Paths.INTERNAL_DIR,
            Paths.PLUGINS_DIR,
            "demo-plugin",
            "plugin.json",
          ),
          "utf-8",
        ),
      ).toBe("legacy-plugin");
      expect(
        readFileSync(
          resolve(homeDir, Paths.DATA_DIR, "user-notes.txt"),
          "utf-8",
        ),
      ).toBe("keep me in data");
      expect(existsSync(resolve(homeDir, Paths.PLUGINS_DIR))).toBe(false);
      expect(existsSync(resolve(homeDir, Paths.CODE_DIR))).toBe(true);
      expect(
        existsSync(resolve(homeDir, Paths.LOGS_DIR, Paths.SYSTEM_LOG_DIR)),
      ).toBe(true);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("migration refuses conflicts unless force is enabled", async () => {
    const homeDir = makeTmpDir();

    try {
      writeHomeConfig(homeDir);
      mkdirSync(resolve(homeDir, Paths.DATA_DIR), { recursive: true });
      mkdirSync(resolve(homeDir, Paths.INTERNAL_DIR), { recursive: true });
      writeFileSync(
        resolve(homeDir, Paths.DATA_DIR, Paths.RUNTIME_DB_FILE),
        "legacy-db",
      );
      writeFileSync(
        resolve(homeDir, Paths.INTERNAL_DIR, Paths.RUNTIME_DB_FILE),
        "new-db",
      );

      await expect(
        migrateHomeLayout({
          homeDir,
        }),
      ).rejects.toThrow("Refusing to overwrite existing destination");

      const result = await migrateHomeLayout({
        homeDir,
        force: true,
      });
      expect(result.performed).toBe(true);
      expect(
        readFileSync(
          resolve(homeDir, Paths.INTERNAL_DIR, Paths.RUNTIME_DB_FILE),
          "utf-8",
        ),
      ).toBe("legacy-db");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
