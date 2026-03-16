import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Paths } from "./constants.ts";

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
