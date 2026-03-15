import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveAgentDir, listAvailableAgents } from "../../src/agents.ts";

const FIXTURES = resolve(import.meta.dir, "../fixtures");
const AGENTS_DIR = resolve(FIXTURES, "pug-claw-home/agents");

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("resolveAgentDir", () => {
  test("finds agent by name and returns path", () => {
    const dir = resolveAgentDir(AGENTS_DIR, "test-agent");
    expect(dir).toBe(resolve(AGENTS_DIR, "test-agent"));
  });

  test("returns null for nonexistent agent", () => {
    const dir = resolveAgentDir(AGENTS_DIR, "nonexistent");
    expect(dir).toBeNull();
  });

  test("returns null for dir without SYSTEM.md", () => {
    const tmpAgentsDir = makeTmpDir();
    const noSystemDir = resolve(tmpAgentsDir, "no-system");
    mkdirSync(noSystemDir, { recursive: true });
    try {
      const dir = resolveAgentDir(tmpAgentsDir, "no-system");
      expect(dir).toBeNull();
    } finally {
      rmSync(tmpAgentsDir, { recursive: true, force: true });
    }
  });
});

describe("listAvailableAgents", () => {
  test("returns sorted agent names", () => {
    const agents = listAvailableAgents(AGENTS_DIR);
    expect(agents).toContain("test-agent");
    // Should be sorted
    for (let i = 1; i < agents.length; i++) {
      const current = agents[i] ?? "";
      const previous = agents[i - 1] ?? "";
      expect(current >= previous).toBe(true);
    }
  });

  test("returns empty for nonexistent directory", () => {
    const agents = listAvailableAgents("/tmp/nonexistent-agents-dir");
    expect(agents).toEqual([]);
  });

  test("ignores dirs without SYSTEM.md", () => {
    const tmpAgentsDir = makeTmpDir();
    // Create one valid agent and one without SYSTEM.md
    const validDir = resolve(tmpAgentsDir, "valid-agent");
    const invalidDir = resolve(tmpAgentsDir, "no-system-agent");
    mkdirSync(validDir, { recursive: true });
    writeFileSync(resolve(validDir, "SYSTEM.md"), "You are valid.");
    mkdirSync(invalidDir, { recursive: true });
    try {
      const agents = listAvailableAgents(tmpAgentsDir);
      expect(agents).toContain("valid-agent");
      expect(agents).not.toContain("no-system-agent");
    } finally {
      rmSync(tmpAgentsDir, { recursive: true, force: true });
    }
  });
});
