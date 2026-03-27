import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  BackupIncludeDirKeySchema,
  type BackupIncludeDirKey,
} from "../backup/types.ts";
import { SecretsProviders } from "../constants.ts";
import { ScheduleOutputTypes } from "../scheduler/types.ts";

const SCHEDULE_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

const DriverConfigSchema = z.object({
  default_model: z.string().optional(),
  cwd: z.string().optional(),
});

const ChannelConfigSchema = z.object({
  agent: z.string().optional(),
  driver: z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

const PathsConfigSchema = z.object({
  agents_dir: z.string().optional(),
  skills_dir: z.string().optional(),
  internal_dir: z.string().optional(),
  data_dir: z.string().optional(),
  code_dir: z.string().optional(),
  logs_dir: z.string().optional(),
});

const SecretsConfigSchema = z.object({
  provider: z.enum([SecretsProviders.ENV, SecretsProviders.DOTENV]).optional(),
  dotenv_path: z.string().optional(),
});

const BackupConfigSchema = z
  .object({
    include_dirs: z.array(BackupIncludeDirKeySchema).optional(),
    output_dir: z.string().optional(),
  })
  .strict();

const DiscordConfigSchema = z.object({
  guild_id: z.string().optional(),
  owner_id: z.string().optional(),
});

const EmbeddingsConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    model: z.string().optional(),
  })
  .strict();

const MemorySeedConfigSchema = z
  .object({
    global: z.array(z.string().min(1)).optional(),
  })
  .strict();

const MemoryConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    injection_budget_tokens: z.number().int().positive().optional(),
    embeddings: EmbeddingsConfigSchema.optional(),
    seed: MemorySeedConfigSchema.optional(),
  })
  .strict();

const ScheduleOutputConfigSchema = z
  .object({
    type: z.literal(ScheduleOutputTypes.DISCORD_CHANNEL),
    channel_id: z.string().min(1),
  })
  .strict();

const ScheduleConfigSchema = z
  .object({
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    cron: z.string().min(1),
    agent: z.string().min(1),
    driver: z.string().optional(),
    model: z.string().optional(),
    prompt: z.string().min(1),
    output: ScheduleOutputConfigSchema.optional(),
  })
  .strict();

export const ConfigFileSchema = z
  .object({
    paths: PathsConfigSchema.optional(),
    secrets: SecretsConfigSchema.optional(),
    backup: BackupConfigSchema.optional(),
    discord: DiscordConfigSchema.optional(),
    memory: MemoryConfigSchema.optional(),
    timezone: z.string().min(1).optional(),
    default_agent: z.string().optional(),
    default_driver: z.string().optional(),
    drivers: z.record(z.string(), DriverConfigSchema).optional(),
    channels: z.record(z.string(), ChannelConfigSchema).optional(),
    schedules: z.record(z.string(), ScheduleConfigSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.schedules && Object.keys(data.schedules).length > 0) {
      for (const name of Object.keys(data.schedules)) {
        if (!SCHEDULE_NAME_REGEX.test(name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["schedules", name],
            message: "schedule name must match ^[a-z0-9][a-z0-9_-]*$",
          });
        }
      }
    }
  });

export type ConfigFile = z.infer<typeof ConfigFileSchema>;
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;
export type ScheduleOutputConfig = z.infer<typeof ScheduleOutputConfigSchema>;

export interface ResolvedScheduleOutput {
  type: typeof ScheduleOutputTypes.DISCORD_CHANNEL;
  channelId: string;
}

export interface ResolvedMemoryConfig {
  enabled: boolean;
  injectionBudgetTokens: number;
  embeddings: {
    enabled: boolean;
    model: string;
  };
  seed: {
    global: string[];
  };
}

export interface ResolvedScheduleConfig {
  description?: string | undefined;
  enabled: boolean;
  cron: string;
  agent: string;
  driver?: string | undefined;
  model?: string | undefined;
  prompt: string;
  output?: ResolvedScheduleOutput | undefined;
}

export function loadAndValidateConfig(configPath: string): ConfigFile {
  const content = readFileSync(configPath, "utf-8");
  return ConfigFileSchema.parse(JSON.parse(content));
}

export type { BackupIncludeDirKey };
