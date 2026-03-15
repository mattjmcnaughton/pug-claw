import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export function resolveAgentDir(
  agentsDir: string,
  agentName: string,
): string | null {
  const dir = resolve(agentsDir, agentName);
  const systemMd = resolve(dir, "SYSTEM.md");
  if (!existsSync(systemMd)) return null;
  return dir;
}

export function listAvailableAgents(agentsDir: string): string[] {
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(resolve(agentsDir, d.name, "SYSTEM.md")))
    .map((d) => d.name)
    .sort();
}
