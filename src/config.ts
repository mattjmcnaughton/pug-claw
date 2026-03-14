import { z } from "zod";
import { logger } from "./logger.ts";

const DriverConfigSchema = z.object({
  default_model: z.string().optional(),
});

const ChannelConfigSchema = z.object({
  agent: z.string().optional(),
  driver: z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

const BotConfigSchema = z.object({
  default_agent: z.string(),
  default_driver: z.string(),
  drivers: z.record(z.string(), DriverConfigSchema).default({}),
  channels: z.record(z.string(), ChannelConfigSchema).default({}),
});

export type DriverConfig = z.infer<typeof DriverConfigSchema>;
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;
export type BotConfig = z.infer<typeof BotConfigSchema>;

export async function loadConfig(path: string): Promise<BotConfig> {
  const data = JSON.parse(await Bun.file(path).text());
  const config = BotConfigSchema.parse(data);
  logger.info(
    {
      default_agent: config.default_agent,
      default_driver: config.default_driver,
      channel_count: Object.keys(config.channels).length,
    },
    "config_loaded",
  );
  return config;
}

export function getChannelConfig(
  config: BotConfig,
  channelId: string,
): ChannelConfig {
  return config.channels[channelId] ?? {};
}
