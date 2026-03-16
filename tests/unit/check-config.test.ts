import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const FIXTURES = resolve(import.meta.dir, "../fixtures");

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-check-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runCheckConfig(args: string[] = []): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const result = Bun.spawnSync(
    [
      "bun",
      resolve(import.meta.dir, "../../src/main.ts"),
      "check-config",
      ...args,
    ],
    { env: { ...process.env, PUG_CLAW_HOME: undefined } },
  );
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("check-config command", () => {
  test("valid config reports success", () => {
    const configPath = resolve(FIXTURES, "pug-claw-home/config.json");
    const result = runCheckConfig([configPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Config OK");
    expect(result.stdout).toContain("test-agent");
  });

  test("missing file reports error", () => {
    const result = runCheckConfig(["/tmp/nonexistent-check-config-test.json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("File not found");
  });

  test("invalid JSON reports parse error", () => {
    const tmpDir = makeTmpDir();
    const badFile = resolve(tmpDir, "bad.json");
    writeFileSync(badFile, "{ not valid json }}}");
    try {
      const result = runCheckConfig([badFile]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid JSON");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("invalid schema reports Zod errors", () => {
    const tmpDir = makeTmpDir();
    const badFile = resolve(tmpDir, "schema.json");
    writeFileSync(badFile, JSON.stringify({ paths: { agents_dir: 123 } }));
    try {
      const result = runCheckConfig([badFile]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Config validation failed");
      expect(result.stderr).toContain("paths.agents_dir");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
