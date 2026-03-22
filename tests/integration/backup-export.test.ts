import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  BACKUP_ARCHIVE_ROOT,
  MANIFEST_FILE_NAME,
} from "../../src/backup/types.ts";
import { exportBackup } from "../../src/backup/export.ts";
import { resolveConfig } from "../../src/resources.ts";

const FIXTURE_HOME = resolve(import.meta.dir, "../fixtures/mock-pug-claw-home");

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-backup-export-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function copyFixtureHome(): string {
  const tempHome = makeTmpDir();
  cpSync(FIXTURE_HOME, tempHome, { recursive: true });
  return tempHome;
}

function createRuntimeDb(homeDir: string): void {
  const dbPath = resolve(homeDir, "internal", "pug-claw.sqlite");
  mkdirSync(resolve(homeDir, "internal"), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT);",
  );
  db.exec("INSERT INTO notes (body) VALUES ('fixture backup note');");
  db.close();
}

function extractArchive(archivePath: string): string {
  const extractDir = makeTmpDir();
  const proc = Bun.spawnSync(["tar", "-xzf", archivePath, "-C", extractDir]);
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString());
  }
  return extractDir;
}

describe("backup export", () => {
  test("exportBackup creates the expected archive structure and excludes secrets", async () => {
    const homeDir = copyFixtureHome();
    const outputDir = makeTmpDir();
    const archivePath = resolve(outputDir, "backup.tar.gz");

    try {
      createRuntimeDb(homeDir);
      const config = await resolveConfig({ home: homeDir });
      const result = await exportBackup(config, { outputPath: archivePath });
      const extractedDir = extractArchive(archivePath);

      try {
        expect(result.outputPath).toBe(archivePath);
        expect(result.sections.data).toBe(false);
        expect(result.sections.code).toBe(false);
        expect(result.sections.logs).toBe(false);

        const backupRoot = resolve(extractedDir, BACKUP_ARCHIVE_ROOT);
        expect(existsSync(resolve(backupRoot, MANIFEST_FILE_NAME))).toBe(true);
        expect(existsSync(resolve(backupRoot, "home", "config.json"))).toBe(
          true,
        );
        expect(
          existsSync(resolve(backupRoot, "home", "config.last-good.json")),
        ).toBe(true);
        expect(
          existsSync(
            resolve(backupRoot, "home", "agents", "fixture-agent", "SYSTEM.md"),
          ),
        ).toBe(true);
        expect(
          existsSync(resolve(backupRoot, "internal", "pug-claw.sqlite")),
        ).toBe(true);
        expect(existsSync(resolve(backupRoot, "home", ".env"))).toBe(false);
        expect(existsSync(resolve(backupRoot, "data"))).toBe(false);
        expect(existsSync(resolve(backupRoot, "code"))).toBe(false);
        expect(existsSync(resolve(backupRoot, "logs"))).toBe(false);
      } finally {
        rmSync(extractedDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  test("exportBackup includes optional directories from config defaults", async () => {
    const homeDir = copyFixtureHome();
    const outputDir = makeTmpDir();
    const archivePath = resolve(outputDir, "backup-with-optional-dirs.tar.gz");

    try {
      createRuntimeDb(homeDir);
      writeFileSync(
        resolve(homeDir, "config.json"),
        `${JSON.stringify(
          {
            paths: {
              agents_dir: "agents",
              skills_dir: "skills",
              internal_dir: "internal",
              data_dir: "data",
              code_dir: "code",
              logs_dir: "logs",
            },
            secrets: {
              provider: "env",
            },
            backup: {
              include_dirs: ["data_dir", "code_dir", "logs_dir"],
            },
            default_agent: "fixture-agent",
            default_driver: "claude",
            drivers: {
              claude: {},
              pi: {},
            },
            channels: {},
          },
          null,
          2,
        )}\n`,
      );

      const config = await resolveConfig({ home: homeDir });
      const result = await exportBackup(config, { outputPath: archivePath });
      const extractedDir = extractArchive(archivePath);

      try {
        expect(result.sections.data).toBe(true);
        expect(result.sections.code).toBe(true);
        expect(result.sections.logs).toBe(true);

        const backupRoot = resolve(extractedDir, BACKUP_ARCHIVE_ROOT);
        expect(
          readFileSync(resolve(backupRoot, "data", "user-data.txt"), "utf-8"),
        ).toBe("fixture user data\n");
        expect(
          readFileSync(resolve(backupRoot, "code", "app", "index.ts"), "utf-8"),
        ).toContain("fixture = true");
        expect(
          readFileSync(
            resolve(backupRoot, "logs", "system", "system.log"),
            "utf-8",
          ),
        ).toContain("fixture log line");
        expect(existsSync(resolve(backupRoot, "home", ".env"))).toBe(false);
      } finally {
        rmSync(extractedDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
