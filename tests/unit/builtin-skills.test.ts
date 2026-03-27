import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseAgentSystemMd } from "../../src/agents.ts";
import { discoverSkills, parseSkillFrontmatter } from "../../src/skills.ts";

const BUILTINS = resolve(import.meta.dir, "../../builtins");
const BUILTINS_SKILLS = resolve(BUILTINS, "skills");
const BUILTINS_AGENTS = resolve(BUILTINS, "agents");

const EXPECTED_SKILLS = [
  "read-pug-claw-config",
  "readwrite-pug-claw-config",
  "read-discord",
  "readwrite-discord",
  "create-agent",
  "create-skill",
  "read-pug-claw-codebase",
  "second-brain",
];

const EXPECTED_MANAGER_SKILLS = EXPECTED_SKILLS.filter(
  (s) => s !== "second-brain",
);

describe("built-in skills", () => {
  test("discovers all expected skills from builtins/skills/", () => {
    const dirs = readdirSync(BUILTINS_SKILLS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual(EXPECTED_SKILLS.sort());
  });

  test("each skill has valid frontmatter (name + description)", () => {
    for (const skillName of EXPECTED_SKILLS) {
      const skillMd = resolve(BUILTINS_SKILLS, skillName, "SKILL.md");
      expect(existsSync(skillMd)).toBe(true);
      const result = parseSkillFrontmatter(skillMd);
      expect(result).not.toBeNull();
      expect(result?.name).toBeTruthy();
      expect(result?.description).toBeTruthy();
    }
  });

  test("directory name matches frontmatter name for each skill", () => {
    for (const skillName of EXPECTED_SKILLS) {
      const skillMd = resolve(BUILTINS_SKILLS, skillName, "SKILL.md");
      const result = parseSkillFrontmatter(skillMd);
      expect(result?.name).toBe(skillName);
    }
  });

  test("all skills have metadata.managed-by: pug-claw", () => {
    for (const skillName of EXPECTED_SKILLS) {
      const skillMd = resolve(BUILTINS_SKILLS, skillName, "SKILL.md");
      const text = readFileSync(skillMd, "utf-8");
      expect(text).toContain("managed-by: pug-claw");
    }
  });

  test("no skill body exceeds 500 lines", () => {
    for (const skillName of EXPECTED_SKILLS) {
      const skillMd = resolve(BUILTINS_SKILLS, skillName, "SKILL.md");
      const text = readFileSync(skillMd, "utf-8");
      const lines = text.split("\n").length;
      expect(lines).toBeLessThanOrEqual(500);
    }
  });
});

describe("built-in agents", () => {
  test("default agent has valid SYSTEM.md", () => {
    const systemMd = resolve(BUILTINS_AGENTS, "default/SYSTEM.md");
    expect(existsSync(systemMd)).toBe(true);
    const text = readFileSync(systemMd, "utf-8");
    expect(text.length).toBeGreaterThan(0);
  });

  test("pug-claw-manager agent has valid SYSTEM.md with frontmatter", () => {
    const agentDir = resolve(BUILTINS_AGENTS, "pug-claw-manager");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.name).toBe("pug-claw-manager");
    expect(parsed.meta.description).toBeTruthy();
    expect(parsed.systemPrompt.length).toBeGreaterThan(0);
  });

  test("pug-claw-manager allowed-skills lists all manager skill names", () => {
    const agentDir = resolve(BUILTINS_AGENTS, "pug-claw-manager");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.allowedSkills).toBeDefined();
    expect(parsed.meta.allowedSkills?.sort()).toEqual(
      EXPECTED_MANAGER_SKILLS.sort(),
    );
  });

  test("pug-claw-manager has metadata.managed-by: pug-claw", () => {
    const agentDir = resolve(BUILTINS_AGENTS, "pug-claw-manager");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.metadata?.["managed-by"]).toBe("pug-claw");
  });

  test("pug-claw-manager has driver: claude in frontmatter", () => {
    const agentDir = resolve(BUILTINS_AGENTS, "pug-claw-manager");
    const parsed = parseAgentSystemMd(agentDir);
    expect(parsed.meta.driver).toBe("claude");
  });

  test("pug-claw-manager discovers all allowed global skills when called correctly (regression)", () => {
    const agentDir = resolve(BUILTINS_AGENTS, "pug-claw-manager");
    const parsed = parseAgentSystemMd(agentDir);
    const skills = discoverSkills(
      agentDir,
      BUILTINS_SKILLS,
      parsed.meta.allowedSkills,
    );
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(EXPECTED_MANAGER_SKILLS.sort());
  });

  test("pug-claw-manager discovers no skills without globalSkillsDir (regression)", () => {
    const agentDir = resolve(BUILTINS_AGENTS, "pug-claw-manager");
    const skills = discoverSkills(agentDir);
    expect(skills).toEqual([]);
  });
});
