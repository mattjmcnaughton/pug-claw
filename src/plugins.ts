import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseAgentSystemMd } from "./agents.ts";
import { Paths } from "./constants.ts";
import { logger } from "./logger.ts";
import { discoverSkills } from "./skills.ts";

export function generateAgentPlugins(
  agentsDir: string,
  skillsDir: string,
  pluginsDir: string,
): Map<string, string> {
  // Wipe stale plugins
  if (existsSync(pluginsDir)) {
    rmSync(pluginsDir, { recursive: true, force: true });
  }
  mkdirSync(pluginsDir, { recursive: true });

  const result = new Map<string, string>();

  if (!existsSync(agentsDir)) return result;

  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const agentName = entry.name;
    const agentDir = resolve(agentsDir, agentName);
    const systemMd = resolve(agentDir, Paths.SYSTEM_MD);
    if (!existsSync(systemMd)) continue;

    const parsed = parseAgentSystemMd(agentDir);
    const skills = discoverSkills(
      agentDir,
      skillsDir,
      parsed.meta.allowedSkills,
    );

    if (skills.length === 0) continue;

    const agentPluginDir = resolve(pluginsDir, agentName);

    // Claude Code SDK requires .claude-plugin/plugin.json to recognize a plugin
    const manifestDir = resolve(agentPluginDir, ".claude-plugin");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      resolve(manifestDir, "plugin.json"),
      JSON.stringify({
        name: agentName,
        description: `Skills for the ${agentName} agent`,
        version: "1.0.0",
      }),
    );

    const skillsSymlinkDir = resolve(agentPluginDir, "skills");
    mkdirSync(skillsSymlinkDir, { recursive: true });

    for (const skill of skills) {
      const skillDir = resolve(skill.path, "..");
      const linkPath = resolve(skillsSymlinkDir, skill.name);
      symlinkSync(skillDir, linkPath);
    }

    result.set(agentName, agentPluginDir);
    logger.info(
      { agent: agentName, skills: skills.length, path: agentPluginDir },
      "agent_plugins_generated",
    );
  }

  return result;
}
