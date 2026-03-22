import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { dryRunBackup } from "../../src/backup/export.ts";
import { resolveConfig } from "../../src/resources.ts";

const FIXTURE_HOME = resolve(import.meta.dir, "../fixtures/mock-pug-claw-home");

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-backup-dryrun-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function copyFixtureHome(): string {
  const tempHome = makeTmpDir();
  cpSync(FIXTURE_HOME, tempHome, { recursive: true });
  return tempHome;
}

describe("backup dry run", () => {
  test("dryRunBackup reports included sections and estimated sizes", async () => {
    const homeDir = copyFixtureHome();

    try {
      const dbPath = resolve(homeDir, "internal", "pug-claw.sqlite");
      mkdirSync(resolve(homeDir, "internal"), { recursive: true });
      const db = new Database(dbPath, { create: true });
      db.exec(
        "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT);",
      );
      db.exec("INSERT INTO notes (body) VALUES ('dry run note');");
      db.close();

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
              include_dirs: ["data_dir", "logs_dir"],
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
      const result = dryRunBackup(config);

      expect(result.sections).toEqual([
        expect.objectContaining({ name: "home", included: true }),
        expect.objectContaining({ name: "internal", included: true }),
        expect.objectContaining({ name: "data", included: true }),
        expect.objectContaining({ name: "code", included: false }),
        expect.objectContaining({ name: "logs", included: true }),
      ]);
      expect(result.totalSizeBytes).toBeGreaterThan(0);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
