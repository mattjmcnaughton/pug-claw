import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { Paths } from "./constants.ts";
import { logger } from "./logger.ts";
import { toError } from "./resources.ts";

const AgentFrontmatterSchema = z
  .object({
    name: z.unknown().optional(),
    description: z.unknown().optional(),
    driver: z.unknown().optional(),
    model: z.unknown().optional(),
    memory: z.unknown().optional(),
    "allowed-skills": z.array(z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export interface AgentMeta {
  name?: string;
  description?: string;
  driver?: string;
  model?: string;
  memory?: boolean;
  allowedSkills?: string[];
  metadata?: Record<string, string>;
}

export interface ParsedAgent {
  meta: AgentMeta;
  systemPrompt: string;
}

export function parseAgentSystemMd(agentDir: string): ParsedAgent {
  const systemMdPath = resolve(agentDir, Paths.SYSTEM_MD);
  let text: string;
  try {
    text = readFileSync(systemMdPath, "utf-8");
  } catch (err) {
    logger.warn(
      { err: toError(err), path: systemMdPath },
      "agent_system_md_read_error",
    );
    return { meta: {}, systemPrompt: "" };
  }

  const parts = text.split("---", 3);
  if (parts.length < 3 || parts[0]?.trim() !== "") {
    return { meta: {}, systemPrompt: text };
  }

  let rawMeta: unknown;
  try {
    const frontmatter = parts[1];
    if (!frontmatter?.trim()) {
      return { meta: {}, systemPrompt: text };
    }
    rawMeta = yaml.load(frontmatter);
  } catch (err) {
    logger.warn(
      { err: toError(err), path: systemMdPath },
      "agent_frontmatter_yaml_error",
    );
    return { meta: {}, systemPrompt: text };
  }

  const parsed = AgentFrontmatterSchema.safeParse(rawMeta);
  if (!parsed.success) {
    return { meta: {}, systemPrompt: text };
  }

  const record = parsed.data;
  const meta: AgentMeta = {};

  if (typeof record.name === "string") {
    meta.name = record.name;
  }
  if (typeof record.description === "string") {
    meta.description = record.description;
  }
  if (typeof record.driver === "string") {
    meta.driver = record.driver;
  }
  if (typeof record.model === "string") {
    meta.model = record.model;
  }
  if (typeof record.memory === "boolean") {
    meta.memory = record.memory;
  }
  if (Array.isArray(record["allowed-skills"])) {
    meta.allowedSkills = record["allowed-skills"].filter(
      (skill): skill is string => typeof skill === "string",
    );
  }
  if (record.metadata) {
    meta.metadata = {};
    for (const [key, value] of Object.entries(record.metadata)) {
      if (typeof value === "string") {
        meta.metadata[key] = value;
      }
    }
  }

  const body = parts.slice(2).join("---").replace(/^\n/, "");
  return { meta, systemPrompt: body };
}

export function resolveAgentDir(
  agentsDir: string,
  agentName: string,
): string | null {
  const dir = resolve(agentsDir, agentName);
  const systemMd = resolve(dir, Paths.SYSTEM_MD);
  if (!existsSync(systemMd)) return null;
  return dir;
}

export function listAvailableAgents(agentsDir: string): string[] {
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(resolve(agentsDir, d.name, Paths.SYSTEM_MD)))
    .map((d) => d.name)
    .sort();
}
