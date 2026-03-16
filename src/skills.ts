import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { Paths } from "./constants.ts";
import { logger } from "./logger.ts";
import { toError } from "./resources.ts";

interface SkillSummary {
  name: string;
  description: string;
  path: string;
}

function parseSkillFrontmatter(filePath: string): SkillSummary | null {
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

  let meta: unknown;
  try {
    const frontmatter = parts[1];
    if (frontmatter === undefined) {
      logger.warn({ path: filePath }, "skill_no_frontmatter");
      return null;
    }
    meta = yaml.load(frontmatter);
  } catch (err) {
    logger.warn({ err: toError(err), path: filePath }, "skill_yaml_error");
    return null;
  }

  if (typeof meta !== "object" || meta === null) {
    logger.warn({ path: filePath }, "skill_invalid_frontmatter");
    return null;
  }

  const record = meta as Record<string, unknown>;
  const name = record.name;
  const description = record.description;
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
    const skillMd = `${dir}/${entry.name}/${Paths.SKILL_MD}`;
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
): SkillSummary[] {
  const agentSkills = discoverSkillsFromDir(`${agentDir}/skills`);

  if (!globalSkillsDir) {
    return agentSkills.sort((a, b) => a.name.localeCompare(b.name));
  }

  const globalSkills = discoverSkillsFromDir(globalSkillsDir);

  // Agent-specific skills win on name collision
  const agentSkillNames = new Set(agentSkills.map((s) => s.name));
  const merged = [
    ...agentSkills,
    ...globalSkills.filter((s) => !agentSkillNames.has(s.name)),
  ];

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

function buildSkillCatalog(skills: SkillSummary[]): string {
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

function loadSystemPrompt(agentDir: string): string {
  const systemMd = `${agentDir}/${Paths.SYSTEM_MD}`;
  if (!existsSync(systemMd)) {
    throw new Error(`Missing SYSTEM.md in ${agentDir}`);
  }
  return readFileSync(systemMd, "utf-8");
}

export function buildFullSystemPrompt(
  agentDir: string,
  globalSkillsDir?: string,
): string {
  let prompt = loadSystemPrompt(agentDir);
  const skills = discoverSkills(agentDir, globalSkillsDir);
  const catalog = buildSkillCatalog(skills);

  if (catalog) {
    prompt +=
      "\n\n# Available Skills\n\n" +
      "The following skills are available. When a user's request matches a skill, " +
      "use the Read tool to read the full SKILL.md file at the given path for detailed instructions.\n\n" +
      catalog;
  }

  return prompt;
}
