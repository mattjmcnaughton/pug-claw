import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test, afterEach } from "bun:test";
import { configureLogger, getLogDateString } from "../../src/logger.ts";

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-logger-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("getLogDateString", () => {
  test("returns YYYY-MM-DD format", () => {
    const result = getLogDateString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("configureLogger", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  test("creates log directory and file for tui mode", () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    const logsDir = resolve(tmpDir, "logs");
    configureLogger("tui", logsDir);

    const logDir = resolve(logsDir, "system");
    expect(existsSync(logDir)).toBe(true);
  });

  test("creates log directory and file for discord mode", () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    const logsDir = resolve(tmpDir, "logs");
    configureLogger("discord", logsDir);

    const logDir = resolve(logsDir, "system");
    expect(existsSync(logDir)).toBe(true);
  });
});
