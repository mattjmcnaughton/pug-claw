import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Paths } from "./constants.ts";
import type { ResolvedConfig } from "./resources.ts";

export function ensureResolvedHomeLayout(config: ResolvedConfig): void {
  mkdirSync(config.agentsDir, { recursive: true });
  mkdirSync(config.skillsDir, { recursive: true });
  mkdirSync(config.internalDir, { recursive: true });
  mkdirSync(resolve(config.internalDir, Paths.PLUGINS_DIR), {
    recursive: true,
  });
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.codeDir, { recursive: true });
  mkdirSync(resolve(config.logsDir, Paths.SYSTEM_LOG_DIR), { recursive: true });
  mkdirSync(resolve(config.logsDir, Paths.SCHEDULES_LOG_DIR), {
    recursive: true,
  });
}
