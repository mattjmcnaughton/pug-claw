import { EnvVars } from "./constants.ts";
import type { SkillSummary } from "./skills.ts";
import { buildSkillCatalog } from "./skills.ts";

export interface BuildFinalSystemPromptOptions {
  skills?: SkillSummary[] | undefined;
  memoryBlock?: string | undefined;
  pluginHint?: boolean | undefined;
  skillMode?: "default" | "strict" | undefined;
}

function appendSkillCatalog(
  systemPrompt: string,
  skills: SkillSummary[],
): string {
  const catalog = buildSkillCatalog(skills);
  if (!catalog) return systemPrompt;
  return (
    systemPrompt +
    "\n\n# Available Skills\n\n" +
    "The following skills are available. When a user's request matches a skill, " +
    "use the Read tool to read the full SKILL.md file at the given path for detailed instructions.\n\n" +
    catalog
  );
}

function buildEnvironmentBlock(): string {
  return (
    "\n\n# Environment\n\n" +
    "The following environment variables are set and available in Bash commands and skill scripts:\n\n" +
    `- \`${EnvVars.HOME}\` — pug-claw home directory (config, agents, skills, data)\n` +
    `- \`${EnvVars.DATA_DIR}\` — data directory for persistent storage (databases, files)\n` +
    `- \`${EnvVars.AGENTS_DIR}\` — agents directory\n` +
    `- \`${EnvVars.SKILLS_DIR}\` — global skills directory\n`
  );
}

export function buildFinalSystemPrompt(
  basePrompt: string,
  options: BuildFinalSystemPromptOptions = {},
): string {
  const skills = options.skills ?? [];
  let systemPrompt = basePrompt;

  if (options.pluginHint && skills.length > 0) {
    systemPrompt +=
      "\n\nYou have plugin skills loaded in this session. " +
      "When a task matches a skill's description, read the skill's SKILL.md for detailed instructions and use it.";
  } else if (skills.length > 0) {
    systemPrompt = appendSkillCatalog(systemPrompt, skills);
  }

  if (options.skillMode === "strict") {
    if (skills.length > 0) {
      systemPrompt +=
        "\n\nIMPORTANT: Only use the skills listed above. " +
        "Do not search the filesystem for additional skills or capabilities beyond what is listed.";
    } else {
      systemPrompt +=
        "\n\nIMPORTANT: You have no skills loaded in this session. " +
        "Do not search the filesystem for skills or capabilities. " +
        "Respond using only your built-in knowledge and tools.";
    }
  }

  if (options.memoryBlock) {
    systemPrompt += `\n\n${options.memoryBlock}`;
  }

  systemPrompt += buildEnvironmentBlock();

  return systemPrompt;
}
