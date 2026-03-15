import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { buildFullSystemPrompt, discoverSkills } from "../../src/skills.ts";

const FIXTURES = resolve(import.meta.dir, "../fixtures");
const TEST_AGENT = resolve(FIXTURES, "agents/test-agent");
const PUG_CLAW_HOME = resolve(FIXTURES, "pug-claw-home");
const PUG_CLAW_AGENT = resolve(PUG_CLAW_HOME, "agents/test-agent");
const GLOBAL_SKILLS_DIR = resolve(PUG_CLAW_HOME, "skills");

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("discoverSkills", () => {
  test("finds skills with valid SKILL.md frontmatter", () => {
    const skills = discoverSkills(TEST_AGENT);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("greet");
    expect(skills[0].description).toBe("Greet the user by name");
  });

  test("returns empty array for agent with no skills dir", () => {
    const skills = discoverSkills(resolve(FIXTURES, "agents/nonexistent"));
    expect(skills).toEqual([]);
  });

  test("merges global and agent-specific skills", () => {
    const skills = discoverSkills(PUG_CLAW_AGENT, GLOBAL_SKILLS_DIR);
    const names = skills.map((s) => s.name);
    expect(names).toContain("agent-skill");
    expect(names).toContain("global-skill");
  });

  test("agent-specific skill wins on name collision", () => {
    // Create a temp global skills dir with a skill that conflicts with the agent skill
    const tmpGlobalSkills = makeTmpDir();
    const conflictDir = resolve(tmpGlobalSkills, "agent-skill");
    mkdirSync(conflictDir, { recursive: true });
    writeFileSync(
      resolve(conflictDir, "SKILL.md"),
      "---\nname: agent-skill\ndescription: Global version\n---\n# Conflict\n",
    );
    try {
      const skills = discoverSkills(PUG_CLAW_AGENT, tmpGlobalSkills);
      const agentSkill = skills.find((s) => s.name === "agent-skill");
      expect(agentSkill).toBeDefined();
      expect(agentSkill?.description).toBe("An agent-specific skill");
    } finally {
      rmSync(tmpGlobalSkills, { recursive: true, force: true });
    }
  });

  test("works with globalSkillsDir but no global skills", () => {
    const skills = discoverSkills(TEST_AGENT, "/tmp/nonexistent-skills-dir");
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("greet");
  });
});

describe("buildFullSystemPrompt", () => {
  test("includes system prompt and skill catalog", () => {
    const prompt = buildFullSystemPrompt(TEST_AGENT);
    expect(prompt).toContain("You are a test agent.");
    expect(prompt).toContain("<available-skills>");
    expect(prompt).toContain('name="greet"');
  });

  test("includes global skills when globalSkillsDir provided", () => {
    const prompt = buildFullSystemPrompt(PUG_CLAW_AGENT, GLOBAL_SKILLS_DIR);
    expect(prompt).toContain('name="agent-skill"');
    expect(prompt).toContain('name="global-skill"');
  });
});
