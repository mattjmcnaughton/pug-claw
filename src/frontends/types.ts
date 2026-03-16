import type { Driver } from "../drivers/types.ts";
import type { Logger } from "../logger.ts";
import type { ResolvedConfig } from "../resources.ts";

export interface FrontendContext {
  drivers: Record<string, Driver>;
  config: ResolvedConfig;
  buildSystemPrompt: (agentDir: string) => string;
  logger: Logger;
  reloadConfig: () => Promise<{
    config: ResolvedConfig;
    buildSystemPrompt: (agentDir: string) => string;
  }>;
}

export interface Frontend {
  start(ctx: FrontendContext): Promise<void>;
}
