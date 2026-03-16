import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildFullSystemPrompt,
  discoverSkills,
  parseSkillFrontmatter,
} from "../../src/skills.ts";

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

  test("merges global and agent-specific skills when allowed", () => {
    const skills = discoverSkills(PUG_CLAW_AGENT, GLOBAL_SKILLS_DIR, [
      "global-skill",
    ]);
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
      const skills = discoverSkills(PUG_CLAW_AGENT, tmpGlobalSkills, [
        "agent-skill",
      ]);
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

describe("parseSkillFrontmatter", () => {
  test("parses valid frontmatter with name and description", () => {
    const skillMd = resolve(
      FIXTURES,
      "agents/test-agent/skills/greet/SKILL.md",
    );
    const result = parseSkillFrontmatter(skillMd);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("greet");
    expect(result?.description).toBe("Greet the user by name");
  });

  test("returns null for missing frontmatter (no --- delimiters)", () => {
    const skillMd = resolve(FIXTURES, "skills/no-frontmatter/SKILL.md");
    const result = parseSkillFrontmatter(skillMd);
    expect(result).toBeNull();
  });

  test("returns null for empty frontmatter (--- with nothing between)", () => {
    const skillMd = resolve(FIXTURES, "skills/empty-frontmatter/SKILL.md");
    const result = parseSkillFrontmatter(skillMd);
    expect(result).toBeNull();
  });

  test("returns null for invalid YAML (malformed syntax)", () => {
    const skillMd = resolve(FIXTURES, "skills/malformed-yaml/SKILL.md");
    const result = parseSkillFrontmatter(skillMd);
    expect(result).toBeNull();
  });

  test("returns null for missing name field", () => {
    const skillMd = resolve(FIXTURES, "skills/missing-name/SKILL.md");
    const result = parseSkillFrontmatter(skillMd);
    expect(result).toBeNull();
  });

  test("returns null for missing description field", () => {
    const skillMd = resolve(FIXTURES, "skills/missing-description/SKILL.md");
    const result = parseSkillFrontmatter(skillMd);
    expect(result).toBeNull();
  });

  test("returns null when name is not a string", () => {
    const tmpDir = makeTmpDir();
    const skillMd = resolve(tmpDir, "SKILL.md");
    writeFileSync(
      skillMd,
      "---\nname: 123\ndescription: A skill\n---\n# Test\n",
    );
    try {
      const result = parseSkillFrontmatter(skillMd);
      expect(result).toBeNull();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns null when description is not a string", () => {
    const tmpDir = makeTmpDir();
    const skillMd = resolve(tmpDir, "SKILL.md");
    writeFileSync(skillMd, "---\nname: test\ndescription: true\n---\n# Test\n");
    try {
      const result = parseSkillFrontmatter(skillMd);
      expect(result).toBeNull();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("ignores extra frontmatter fields (metadata, license, etc.)", () => {
    const skillMd = resolve(FIXTURES, "skills/with-metadata/SKILL.md");
    const result = parseSkillFrontmatter(skillMd);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("with-metadata");
    expect(result?.description).toBe("A skill with metadata");
  });

  test("returns correct path as absolute", () => {
    const skillMd = resolve(
      FIXTURES,
      "agents/test-agent/skills/greet/SKILL.md",
    );
    const result = parseSkillFrontmatter(skillMd);
    expect(result?.path).toBe(resolve(skillMd));
  });
});

describe("discoverSkills with allowedGlobalSkills", () => {
  test("returns only allowed global skills when allow-list provided", () => {
    const skills = discoverSkills(PUG_CLAW_AGENT, GLOBAL_SKILLS_DIR, [
      "global-skill",
    ]);
    const names = skills.map((s) => s.name);
    expect(names).toContain("global-skill");
    expect(names).toContain("agent-skill");
  });

  test("returns no global skills when allow-list is empty array", () => {
    const skills = discoverSkills(PUG_CLAW_AGENT, GLOBAL_SKILLS_DIR, []);
    const names = skills.map((s) => s.name);
    expect(names).toContain("agent-skill");
    expect(names).not.toContain("global-skill");
  });

  test("returns all agent-specific skills regardless of allow-list", () => {
    const skills = discoverSkills(PUG_CLAW_AGENT, GLOBAL_SKILLS_DIR, []);
    const names = skills.map((s) => s.name);
    expect(names).toContain("agent-skill");
  });

  test("agent-specific skill still wins over allowed global skill on name collision", () => {
    const tmpGlobalSkills = makeTmpDir();
    const conflictDir = resolve(tmpGlobalSkills, "agent-skill");
    mkdirSync(conflictDir, { recursive: true });
    writeFileSync(
      resolve(conflictDir, "SKILL.md"),
      "---\nname: agent-skill\ndescription: Global version\n---\n# Conflict\n",
    );
    try {
      const skills = discoverSkills(PUG_CLAW_AGENT, tmpGlobalSkills, [
        "agent-skill",
      ]);
      const agentSkill = skills.find((s) => s.name === "agent-skill");
      expect(agentSkill).toBeDefined();
      expect(agentSkill?.description).toBe("An agent-specific skill");
    } finally {
      rmSync(tmpGlobalSkills, { recursive: true, force: true });
    }
  });

  test("returns no global skills when allowedGlobalSkills is undefined (backward compat)", () => {
    const skills = discoverSkills(PUG_CLAW_AGENT, GLOBAL_SKILLS_DIR, undefined);
    const names = skills.map((s) => s.name);
    expect(names).toContain("agent-skill");
    expect(names).not.toContain("global-skill");
  });
});

describe("buildFullSystemPrompt", () => {
  test("includes system prompt and skill catalog", () => {
    const prompt = buildFullSystemPrompt(TEST_AGENT);
    expect(prompt).toContain("You are a test agent.");
    expect(prompt).toContain("<available-skills>");
    expect(prompt).toContain('name="greet"');
  });

  test("strips frontmatter from system prompt (body only)", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-with-frontmatter");
    const prompt = buildFullSystemPrompt(agentDir);
    expect(prompt).toContain("You are a test agent with frontmatter.");
    expect(prompt).not.toContain("allowed-skills");
  });

  test("agent without frontmatter gets no global skills (safe default)", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-no-frontmatter");
    const prompt = buildFullSystemPrompt(agentDir, GLOBAL_SKILLS_DIR);
    expect(prompt).toContain("You are a test agent without frontmatter.");
    expect(prompt).not.toContain("<available-skills>");
  });

  test("agent with empty allowed-skills gets no global skills", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-empty-allowed");
    const prompt = buildFullSystemPrompt(agentDir, GLOBAL_SKILLS_DIR);
    expect(prompt).not.toContain('name="global-skill"');
  });

  test("agent with allowed-skills gets only listed global skills", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-partial-allowed");
    const prompt = buildFullSystemPrompt(agentDir, GLOBAL_SKILLS_DIR);
    expect(prompt).toContain('name="global-skill"');
  });

  test("filters global skills by agent's allowed-skills list", () => {
    const agentDir = resolve(FIXTURES, "agents/agent-with-frontmatter");
    const prompt = buildFullSystemPrompt(agentDir, GLOBAL_SKILLS_DIR);
    expect(prompt).toContain('name="global-skill"');
  });
});
