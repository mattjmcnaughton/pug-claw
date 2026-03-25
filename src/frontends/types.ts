import type { Driver } from "../drivers/types.ts";
import type { Logger } from "../logger.ts";
import type { MemoryBackend } from "../memory/types.ts";
import type { ResolvedConfig } from "../resources.ts";
import type { ResolvedAgent } from "../skills.ts";

export interface FrontendContext {
  drivers: Record<string, Driver>;
  config: ResolvedConfig;
  pluginDirs: Map<string, string>;
  resolveAgent: (agentDir: string) => ResolvedAgent;
  logger: Logger;
  memoryBackend?: MemoryBackend | undefined;
  reloadConfig: () => Promise<{
    config: ResolvedConfig;
    pluginDirs: Map<string, string>;
    resolveAgent: (agentDir: string) => ResolvedAgent;
  }>;
}

export interface Frontend {
  start(ctx: FrontendContext): Promise<void>;
}
