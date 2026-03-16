import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { generateAgentPlugins } from "../../src/plugins.ts";

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkillMd(dir: string, name: string, description: string): string {
  const skillDir = resolve(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    resolve(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`,
  );
  return skillDir;
}

function writeAgentSystemMd(
  agentsDir: string,
  agentName: string,
  allowedSkills?: string[],
): string {
  const agentDir = resolve(agentsDir, agentName);
  mkdirSync(agentDir, { recursive: true });
  const frontmatter = allowedSkills
    ? `---\nname: ${agentName}\nallowed-skills:\n${allowedSkills.map((s) => `  - ${s}`).join("\n")}\n---\n`
    : "";
  writeFileSync(
    resolve(agentDir, "SYSTEM.md"),
    `${frontmatter}You are ${agentName}.`,
  );
  return agentDir;
}

describe("generateAgentPlugins", () => {
  test("creates symlinks for allowed global skills", () => {
    const tmpDir = makeTmpDir();
    const agentsDir = resolve(tmpDir, "agents");
    const skillsDir = resolve(tmpDir, "skills");
    const pluginsDir = resolve(tmpDir, "plugins");

    writeSkillMd(skillsDir, "my-skill", "A test skill");
    writeAgentSystemMd(agentsDir, "test-agent", ["my-skill"]);

    try {
      const result = generateAgentPlugins(agentsDir, skillsDir, pluginsDir);

      expect(result.has("test-agent")).toBe(true);
      const agentPluginDir = result.get("test-agent") as string;
      const linkPath = resolve(agentPluginDir, "skills/my-skill");
      expect(existsSync(linkPath)).toBe(true);
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(linkPath)).toBe(resolve(skillsDir, "my-skill"));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("skips agents without allowed-skills", () => {
    const tmpDir = makeTmpDir();
    const agentsDir = resolve(tmpDir, "agents");
    const skillsDir = resolve(tmpDir, "skills");
    const pluginsDir = resolve(tmpDir, "plugins");

    writeSkillMd(skillsDir, "my-skill", "A test skill");
    writeAgentSystemMd(agentsDir, "no-skills-agent");

    try {
      const result = generateAgentPlugins(agentsDir, skillsDir, pluginsDir);
      expect(result.has("no-skills-agent")).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("wipes stale plugins on each call", () => {
    const tmpDir = makeTmpDir();
    const agentsDir = resolve(tmpDir, "agents");
    const skillsDir = resolve(tmpDir, "skills");
    const pluginsDir = resolve(tmpDir, "plugins");

    writeSkillMd(skillsDir, "my-skill", "A test skill");
    writeAgentSystemMd(agentsDir, "test-agent", ["my-skill"]);

    try {
      // First call
      generateAgentPlugins(agentsDir, skillsDir, pluginsDir);

      // Create a stale file
      writeFileSync(resolve(pluginsDir, "stale.txt"), "old");

      // Second call should wipe it
      generateAgentPlugins(agentsDir, skillsDir, pluginsDir);
      expect(existsSync(resolve(pluginsDir, "stale.txt"))).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("handles agent-local skills (in agent/skills/ dir)", () => {
    const tmpDir = makeTmpDir();
    const agentsDir = resolve(tmpDir, "agents");
    const skillsDir = resolve(tmpDir, "skills");
    const pluginsDir = resolve(tmpDir, "plugins");

    const agentDir = writeAgentSystemMd(agentsDir, "local-agent", []);
    // Agent-local skill lives in agent's own skills/ dir
    writeSkillMd(resolve(agentDir, "skills"), "local-skill", "A local skill");

    try {
      const result = generateAgentPlugins(agentsDir, skillsDir, pluginsDir);
      expect(result.has("local-agent")).toBe(true);
      const linkPath = resolve(
        result.get("local-agent") as string,
        "skills/local-skill",
      );
      expect(existsSync(linkPath)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns empty map when agents dir does not exist", () => {
    const tmpDir = makeTmpDir();
    const pluginsDir = resolve(tmpDir, "plugins");
    try {
      const result = generateAgentPlugins(
        "/tmp/nonexistent-agents-xyz",
        "/tmp/nonexistent-skills-xyz",
        pluginsDir,
      );
      expect(result.size).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("generates plugins for multiple agents", () => {
    const tmpDir = makeTmpDir();
    const agentsDir = resolve(tmpDir, "agents");
    const skillsDir = resolve(tmpDir, "skills");
    const pluginsDir = resolve(tmpDir, "plugins");

    writeSkillMd(skillsDir, "skill-a", "Skill A");
    writeSkillMd(skillsDir, "skill-b", "Skill B");
    writeAgentSystemMd(agentsDir, "agent-one", ["skill-a"]);
    writeAgentSystemMd(agentsDir, "agent-two", ["skill-a", "skill-b"]);

    try {
      const result = generateAgentPlugins(agentsDir, skillsDir, pluginsDir);
      expect(result.size).toBe(2);
      expect(result.has("agent-one")).toBe(true);
      expect(result.has("agent-two")).toBe(true);

      // agent-one only has skill-a
      const oneSkills = resolve(result.get("agent-one") as string, "skills");
      expect(existsSync(resolve(oneSkills, "skill-a"))).toBe(true);
      expect(existsSync(resolve(oneSkills, "skill-b"))).toBe(false);

      // agent-two has both
      const twoSkills = resolve(result.get("agent-two") as string, "skills");
      expect(existsSync(resolve(twoSkills, "skill-a"))).toBe(true);
      expect(existsSync(resolve(twoSkills, "skill-b"))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
