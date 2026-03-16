import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  resolveAgentDir,
  listAvailableAgents,
  parseAgentSystemMd,
} from "../../src/agents.ts";

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

describe("parseAgentSystemMd", () => {
  test("parses SYSTEM.md with full frontmatter", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-with-frontmatter");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.name).toBe("test-agent-with-frontmatter");
    expect(parsed.meta.description).toBe("A test agent with full frontmatter");
    expect(parsed.meta.driver).toBe("claude");
    expect(parsed.meta.model).toBe("claude-opus-4-6");
    expect(parsed.meta.allowedSkills).toEqual([
      "global-skill",
      "another-skill",
    ]);
    expect(parsed.meta.metadata).toEqual({ "managed-by": "pug-claw" });
  });

  test("returns body only (frontmatter stripped) as systemPrompt", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-with-frontmatter");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.systemPrompt).toContain(
      "You are a test agent with frontmatter.",
    );
    expect(parsed.systemPrompt).not.toContain("---");
    expect(parsed.systemPrompt).not.toContain("allowed-skills");
  });

  test("handles SYSTEM.md without frontmatter", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-no-frontmatter");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta).toEqual({});
    expect(parsed.systemPrompt).toContain(
      "You are a test agent without frontmatter.",
    );
  });

  test("handles empty allowed-skills array", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-empty-allowed");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.allowedSkills).toEqual([]);
  });

  test("handles allowed-skills with single entry", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-partial-allowed");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.allowedSkills).toEqual(["global-skill"]);
  });

  test("handles metadata field with managed-by key", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-with-frontmatter");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.metadata?.["managed-by"]).toBe("pug-claw");
  });

  test("returns undefined for allowedSkills when field not present", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-no-frontmatter");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.allowedSkills).toBeUndefined();
  });

  test("ignores unknown frontmatter fields gracefully", () => {
    const tmpDir = makeTmpDir();
    writeFileSync(
      resolve(tmpDir, "SYSTEM.md"),
      "---\nname: test\nunknown-field: value\ncustom: 123\n---\n\nPrompt here.\n",
    );
    try {
      const parsed = parseAgentSystemMd(tmpDir);
      expect(parsed.meta.name).toBe("test");
      expect(parsed.systemPrompt).toContain("Prompt here.");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("handles SYSTEM.md with frontmatter but no body content", () => {
    const tmpDir = makeTmpDir();
    writeFileSync(
      resolve(tmpDir, "SYSTEM.md"),
      "---\nname: empty-body\ndescription: No body\n---\n",
    );
    try {
      const parsed = parseAgentSystemMd(tmpDir);
      expect(parsed.meta.name).toBe("empty-body");
      expect(parsed.systemPrompt).toBe("");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("parses driver from frontmatter", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-driver-only");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.driver).toBe("pi");
  });

  test("parses model from frontmatter", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-with-frontmatter");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.model).toBe("claude-opus-4-6");
  });

  test("driver is undefined when not in frontmatter", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-no-frontmatter");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.driver).toBeUndefined();
  });

  test("model is undefined when not in frontmatter", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-driver-only");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.model).toBeUndefined();
  });

  test("parses both driver and model together", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-with-frontmatter");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.driver).toBe("claude");
    expect(parsed.meta.model).toBe("claude-opus-4-6");
  });

  test("ignores non-string driver values", () => {
    const tmpDir = makeTmpDir();
    writeFileSync(
      resolve(tmpDir, "SYSTEM.md"),
      "---\nname: test\ndriver: 123\n---\n\nPrompt.\n",
    );
    try {
      const parsed = parseAgentSystemMd(tmpDir);
      expect(parsed.meta.driver).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("ignores non-string model values", () => {
    const tmpDir = makeTmpDir();
    writeFileSync(
      resolve(tmpDir, "SYSTEM.md"),
      "---\nname: test\nmodel: true\n---\n\nPrompt.\n",
    );
    try {
      const parsed = parseAgentSystemMd(tmpDir);
      expect(parsed.meta.model).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
