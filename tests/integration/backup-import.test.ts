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
import { exportBackup } from "../../src/backup/export.ts";
import { importBackup } from "../../src/backup/import.ts";
import { BACKUP_ARCHIVE_ROOT } from "../../src/backup/types.ts";
import { resolveConfig } from "../../src/resources.ts";

const FIXTURE_HOME = resolve(import.meta.dir, "../fixtures/mock-pug-claw-home");

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-backup-import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

function createArchive(rootDir: string, outputPath: string): void {
  const proc = Bun.spawnSync([
    "tar",
    "-czf",
    outputPath,
    "-C",
    rootDir,
    BACKUP_ARCHIVE_ROOT,
  ]);
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString());
  }
}

describe("backup import", () => {
  test("importBackup dry-run validates the archive without writing files", async () => {
    const sourceHome = copyFixtureHome();
    const outputDir = makeTmpDir();
    const targetHome = makeTmpDir();
    const archivePath = resolve(outputDir, "backup.tar.gz");

    try {
      createRuntimeDb(sourceHome);
      writeFileSync(
        resolve(sourceHome, "config.json"),
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

      const config = await resolveConfig({ home: sourceHome });
      await exportBackup(config, { outputPath: archivePath });

      const result = await importBackup({
        archivePath,
        homeDir: targetHome,
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.sections.data).toBe(true);
      expect(result.sections.code).toBe(true);
      expect(result.sections.logs).toBe(true);
      expect(existsSync(resolve(targetHome, "config.json"))).toBe(false);
      expect(
        existsSync(resolve(targetHome, "internal", "pug-claw.sqlite")),
      ).toBe(false);
    } finally {
      rmSync(sourceHome, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(targetHome, { recursive: true, force: true });
    }
  });

  test("importBackup restores a round-trip backup into a fresh home", async () => {
    const sourceHome = copyFixtureHome();
    const outputDir = makeTmpDir();
    const targetHome = makeTmpDir();
    const archivePath = resolve(outputDir, "round-trip-backup.tar.gz");

    try {
      createRuntimeDb(sourceHome);
      writeFileSync(
        resolve(sourceHome, "config.json"),
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

      const config = await resolveConfig({ home: sourceHome });
      await exportBackup(config, { outputPath: archivePath });

      const result = await importBackup({
        archivePath,
        homeDir: targetHome,
        force: true,
      });

      expect(result.dryRun).toBe(false);
      expect(
        readFileSync(resolve(targetHome, "data", "user-data.txt"), "utf-8"),
      ).toBe("fixture user data\n");
      expect(
        readFileSync(resolve(targetHome, "code", "app", "index.ts"), "utf-8"),
      ).toContain("fixture = true");
      expect(
        readFileSync(
          resolve(targetHome, "logs", "system", "system.log"),
          "utf-8",
        ),
      ).toContain("fixture log line");
      expect(existsSync(resolve(targetHome, ".env"))).toBe(false);

      const restoredDb = new Database(
        resolve(targetHome, "internal", "pug-claw.sqlite"),
        { readonly: true },
      );
      try {
        const row = restoredDb
          .query("SELECT COUNT(*) AS count FROM notes")
          .get() as { count: number };
        expect(row.count).toBe(1);
      } finally {
        restoredDb.close();
      }
    } finally {
      rmSync(sourceHome, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(targetHome, { recursive: true, force: true });
    }
  });

  test("importBackup refuses unsupported format versions", async () => {
    const archiveRootParent = makeTmpDir();
    const outputDir = makeTmpDir();
    const targetHome = makeTmpDir();
    const archivePath = resolve(outputDir, "invalid-format.tar.gz");

    try {
      const archiveRoot = resolve(archiveRootParent, BACKUP_ARCHIVE_ROOT);
      mkdirSync(resolve(archiveRoot, "home"), { recursive: true });
      writeFileSync(
        resolve(archiveRoot, "manifest.json"),
        `${JSON.stringify(
          {
            format_version: "99",
            pug_claw_version: "0.1.0",
            created_at: "2026-03-22T00:00:00.000Z",
            hostname: "fixture-host",
            sections: {
              home: { included: true },
              internal: { included: true },
              data: { included: false },
              code: { included: false },
              logs: { included: false },
            },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        resolve(archiveRoot, "home", "config.json"),
        `${JSON.stringify(
          {
            default_agent: "fixture-agent",
            default_driver: "claude",
          },
          null,
          2,
        )}\n`,
      );
      createArchive(archiveRootParent, archivePath);

      await expect(
        importBackup({ archivePath, homeDir: targetHome, dryRun: true }),
      ).rejects.toThrow('Unsupported backup format version "99"');
    } finally {
      rmSync(archiveRootParent, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(targetHome, { recursive: true, force: true });
    }
  });

  test("importBackup refuses to overwrite existing targets without force", async () => {
    const sourceHome = copyFixtureHome();
    const outputDir = makeTmpDir();
    const targetHome = makeTmpDir();
    const archivePath = resolve(outputDir, "overwrite-check.tar.gz");

    try {
      createRuntimeDb(sourceHome);
      const config = await resolveConfig({ home: sourceHome });
      await exportBackup(config, { outputPath: archivePath });
      writeFileSync(resolve(targetHome, "config.json"), "already here\n");

      await expect(
        importBackup({ archivePath, homeDir: targetHome }),
      ).rejects.toThrow("Import would overwrite existing files");
    } finally {
      rmSync(sourceHome, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(targetHome, { recursive: true, force: true });
    }
  });
});
