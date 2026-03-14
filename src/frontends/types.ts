import type { BotConfig } from "../config.ts";
import type { Driver } from "../drivers/types.ts";
import type { Logger } from "../logger.ts";

export interface FrontendContext {
  drivers: Record<string, Driver>;
  config: BotConfig;
  agentsDir: string;
  buildSystemPrompt: (agentDir: string) => string;
  logger: Logger;
}

export interface Frontend {
  start(ctx: FrontendContext): Promise<void>;
}
