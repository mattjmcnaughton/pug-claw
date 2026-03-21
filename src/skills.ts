import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { parseAgentSystemMd } from "./agents.ts";
import { EnvVars, Paths } from "./constants.ts";
import { logger } from "./logger.ts";
import { toError } from "./resources.ts";

const SkillFrontmatterSchema = z
  .object({
    name: z.unknown().optional(),
    description: z.unknown().optional(),
  })
  .passthrough();

export interface SkillSummary {
  name: string;
  description: string;
  path: string;
}

export function parseSkillFrontmatter(filePath: string): SkillSummary | null {
  let text: string;
  try {
    text = readFileSync(filePath, "utf-8");
  } catch (err) {
    logger.warn({ err: toError(err), path: filePath }, "skill_read_error");
    return null;
  }

  const parts = text.split("---", 3);
  if (parts.length < 3) {
    logger.warn({ path: filePath }, "skill_no_frontmatter");
    return null;
  }

  let rawMeta: unknown;
  try {
    const frontmatter = parts[1];
    if (frontmatter === undefined) {
      logger.warn({ path: filePath }, "skill_no_frontmatter");
      return null;
    }
    rawMeta = yaml.load(frontmatter);
  } catch (err) {
    logger.warn({ err: toError(err), path: filePath }, "skill_yaml_error");
    return null;
  }

  const parsed = SkillFrontmatterSchema.safeParse(rawMeta);
  if (!parsed.success) {
    logger.warn({ path: filePath }, "skill_invalid_frontmatter");
    return null;
  }

  const { name, description } = parsed.data;
  if (typeof name !== "string" || typeof description !== "string") {
    logger.warn(
      {
        path: filePath,
        has_name: typeof name === "string",
        has_description: typeof description === "string",
      },
      "skill_missing_fields",
    );
    return null;
  }

  return { name, description, path: resolve(filePath) };
}

function discoverSkillsFromDir(dir: string): SkillSummary[] {
  if (!existsSync(dir)) return [];

  const skills: SkillSummary[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = resolve(dir, entry.name, Paths.SKILL_MD);
    if (!existsSync(skillMd)) continue;

    const summary = parseSkillFrontmatter(skillMd);
    if (summary) {
      skills.push(summary);
      logger.info(
        { name: summary.name, path: summary.path },
        "skill_discovered",
      );
    }
  }
  return skills;
}

export function discoverSkills(
  agentDir: string,
  globalSkillsDir?: string,
  allowedGlobalSkills?: string[],
): SkillSummary[] {
  const agentSkills = discoverSkillsFromDir(
    resolve(agentDir, Paths.SKILLS_DIR),
  );

  if (!globalSkillsDir) {
    return agentSkills.sort((a, b) => a.name.localeCompare(b.name));
  }

  // If allowedGlobalSkills is undefined, no global skills are injected (safe default)
  if (allowedGlobalSkills === undefined) {
    return agentSkills.sort((a, b) => a.name.localeCompare(b.name));
  }

  // If allowedGlobalSkills is an empty array, no global skills are injected
  if (allowedGlobalSkills.length === 0) {
    return agentSkills.sort((a, b) => a.name.localeCompare(b.name));
  }

  const allowedSet = new Set(allowedGlobalSkills);
  const globalSkills = discoverSkillsFromDir(globalSkillsDir).filter((s) =>
    allowedSet.has(s.name),
  );

  // Agent-specific skills win on name collision
  const agentSkillNames = new Set(agentSkills.map((s) => s.name));
  const merged = [
    ...agentSkills,
    ...globalSkills.filter((s) => !agentSkillNames.has(s.name)),
  ];

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildSkillCatalog(skills: SkillSummary[]): string {
  if (skills.length === 0) return "";

  const lines = ["<available-skills>"];
  for (const s of skills) {
    lines.push(`  <skill name="${s.name}" path="${s.path}">`);
    lines.push(`    ${s.description}`);
    lines.push("  </skill>");
  }
  lines.push("</available-skills>");
  return lines.join("\n");
}

export function appendSkillCatalog(
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

export function buildEnvironmentBlock(): string {
  return (
    "\n\n# Environment\n\n" +
    "The following environment variables are set and available in Bash commands and skill scripts:\n\n" +
    `- \`${EnvVars.HOME}\` — pug-claw home directory (config, agents, skills, data)\n` +
    `- \`${EnvVars.DATA_DIR}\` — data directory for persistent storage (databases, files)\n` +
    `- \`${EnvVars.AGENTS_DIR}\` — agents directory\n` +
    `- \`${EnvVars.SKILLS_DIR}\` — global skills directory\n`
  );
}

export interface ResolvedAgent {
  systemPrompt: string;
  skills: SkillSummary[];
  driver?: string;
  model?: string;
}

export function resolveAgent(
  agentDir: string,
  globalSkillsDir?: string,
): ResolvedAgent {
  const parsed = parseAgentSystemMd(agentDir);
  const skills = discoverSkills(
    agentDir,
    globalSkillsDir,
    parsed.meta.allowedSkills,
  );

  return {
    systemPrompt: parsed.systemPrompt,
    skills,
    driver: parsed.meta.driver,
    model: parsed.meta.model,
  };
}
