import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { Cron } from "croner";
import { z } from "zod";
import {
  Defaults,
  Drivers,
  EnvVars,
  Paths,
  SecretsProviders,
} from "./constants.ts";
import { logger } from "./logger.ts";
import { ScheduleOutputTypes } from "./scheduler/types.ts";

const SCHEDULE_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

// --- Zod Schemas ---

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
  data_dir: z.string().optional(),
});

const SecretsConfigSchema = z.object({
  provider: z.enum([SecretsProviders.ENV, SecretsProviders.DOTENV]).optional(),
  dotenv_path: z.string().optional(),
});

const DiscordConfigSchema = z.object({
  guild_id: z.string().optional(),
  owner_id: z.string().optional(),
});

const SchedulerConfigSchema = z
  .object({
    timezone: z.string().min(1),
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
    discord: DiscordConfigSchema.optional(),
    scheduler: SchedulerConfigSchema.optional(),
    default_agent: z.string().optional(),
    default_driver: z.string().optional(),
    drivers: z.record(z.string(), DriverConfigSchema).optional(),
    channels: z.record(z.string(), ChannelConfigSchema).optional(),
    schedules: z.record(z.string(), ScheduleConfigSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.schedules && Object.keys(data.schedules).length > 0) {
      if (!data.scheduler?.timezone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scheduler", "timezone"],
          message:
            "scheduler.timezone is required when schedules are configured",
        });
      }

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

// --- Exported Types ---

export type ConfigFile = z.infer<typeof ConfigFileSchema>;
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;
export type SchedulerConfig = z.infer<typeof SchedulerConfigSchema>;
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;
export type ScheduleOutputConfig = z.infer<typeof ScheduleOutputConfigSchema>;

export interface ResolvedSchedulerConfig {
  timezone: string;
}

export interface ResolvedScheduleOutput {
  type: typeof ScheduleOutputTypes.DISCORD_CHANNEL;
  channelId: string;
}

export interface ResolvedScheduleConfig {
  description?: string;
  enabled: boolean;
  cron: string;
  agent: string;
  driver?: string;
  model?: string;
  prompt: string;
  output?: ResolvedScheduleOutput;
}

export interface SecretsProvider {
  get(key: string): string | undefined;
  require(key: string): string;
}

export interface DiscordIdentity {
  guildId?: string;
  ownerId?: string;
}

export interface ResolvedConfig {
  homeDir: string;
  agentsDir: string;
  skillsDir: string;
  dataDir: string;
  logsDir: string;

  defaultAgent: string;
  defaultDriver: string;
  drivers: Record<string, { defaultModel?: string; cwd?: string }>;
  channels: Record<string, ChannelConfig>;
  scheduler?: ResolvedSchedulerConfig;
  schedules: Record<string, ResolvedScheduleConfig>;

  discord?: DiscordIdentity;

  secrets: SecretsProvider;
}

export interface ResolvedConfigPaths {
  agentsDir: string;
  skillsDir: string;
  dataDir: string;
  logsDir: string;
}

// --- Secrets Providers ---

class EnvSecretsProvider implements SecretsProvider {
  get(key: string): string | undefined {
    return process.env[key];
  }

  require(key: string): string {
    const value = this.get(key);
    if (value === undefined || value === "") {
      throw new Error(`Required secret "${key}" is not set`);
    }
    return value;
  }
}

class DotenvSecretsProvider implements SecretsProvider {
  private vars: Record<string, string>;

  constructor(dotenvPath: string) {
    this.vars = {};
    if (existsSync(dotenvPath)) {
      const content = readFileSync(dotenvPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        this.vars[key] = value;
      }
    }

    for (const [key, value] of Object.entries(this.vars)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  get(key: string): string | undefined {
    return process.env[key] ?? this.vars[key];
  }

  require(key: string): string {
    const value = this.get(key);
    if (value === undefined || value === "") {
      throw new Error(`Required secret "${key}" is not set`);
    }
    return value;
  }
}

// --- Error Helpers ---

export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

// --- Path Resolution Helpers ---

export function expandTilde(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

function resolvePathWithOverrides(
  homeDir: string,
  defaultRelative: string,
  configValue: string | undefined,
  envVar: string | undefined,
  cliFlag: string | undefined,
): string {
  if (cliFlag) return resolve(expandTilde(cliFlag));
  if (envVar) return resolve(expandTilde(envVar));
  if (configValue) {
    const expanded = expandTilde(configValue);
    if (expanded.startsWith("/")) return expanded;
    return resolve(homeDir, expanded);
  }
  return resolve(homeDir, defaultRelative);
}

export function resolveLogsDir(homeDir: string): string {
  const rawLogsDir = process.env[EnvVars.LOGS_DIR];
  if (!rawLogsDir) {
    return resolve(homeDir, Paths.LOGS_DIR);
  }

  const expanded = expandTilde(rawLogsDir);
  if (expanded.startsWith("/")) {
    return expanded;
  }
  return resolve(homeDir, expanded);
}

export function resolveConfigPaths(
  homeDir: string,
  rawConfig: ConfigFile,
  opts: ConfigOptions = {},
): ResolvedConfigPaths {
  const agentsDir = resolvePathWithOverrides(
    homeDir,
    Paths.AGENTS_DIR,
    rawConfig.paths?.agents_dir,
    process.env[EnvVars.AGENTS_DIR],
    opts.agentsDir,
  );

  const skillsDir = resolvePathWithOverrides(
    homeDir,
    Paths.SKILLS_DIR,
    rawConfig.paths?.skills_dir,
    process.env[EnvVars.SKILLS_DIR],
    opts.skillsDir,
  );

  const dataDir = resolvePathWithOverrides(
    homeDir,
    Paths.DATA_DIR,
    rawConfig.paths?.data_dir,
    process.env[EnvVars.DATA_DIR],
    opts.dataDir,
  );

  const logsDir = resolveLogsDir(homeDir);

  return {
    agentsDir,
    skillsDir,
    dataDir,
    logsDir,
  };
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch (err) {
    throw new Error(
      `Invalid scheduler timezone "${timezone}": ${toError(err).message}`,
    );
  }
}

function validateCronExpression(
  cronExpression: string,
  timezone: string,
): void {
  try {
    new Cron(cronExpression, {
      paused: true,
      timezone,
      mode: "5-part",
    });
  } catch (err) {
    throw new Error(
      `Invalid cron expression "${cronExpression}": ${toError(err).message}`,
    );
  }
}

function isKnownDriverName(driverName: string): boolean {
  return Object.values(Drivers).includes(
    driverName as (typeof Drivers)[keyof typeof Drivers],
  );
}

export function validateConfigSemantics(
  rawConfig: ConfigFile,
  homeDir: string,
  paths: ResolvedConfigPaths,
): void {
  const defaultDriver = rawConfig.default_driver ?? Defaults.DRIVER;
  if (!isKnownDriverName(defaultDriver)) {
    throw new Error(`Unknown default driver: ${defaultDriver}`);
  }

  const timezone = rawConfig.scheduler?.timezone;
  if (timezone) {
    validateTimezone(timezone);
  }

  for (const [channelId, channel] of Object.entries(rawConfig.channels ?? {})) {
    if (channel.driver && !isKnownDriverName(channel.driver)) {
      throw new Error(
        `Channel "${channelId}" references unknown driver "${channel.driver}"`,
      );
    }
  }

  for (const [name, schedule] of Object.entries(rawConfig.schedules ?? {})) {
    if (!timezone) {
      throw new Error(
        `scheduler.timezone is required when schedules are configured (missing for schedule "${name}")`,
      );
    }

    validateCronExpression(schedule.cron, timezone);

    const agentSystemPath = resolve(
      paths.agentsDir,
      schedule.agent,
      Paths.SYSTEM_MD,
    );
    if (!existsSync(agentSystemPath)) {
      throw new Error(
        `Schedule "${name}" references unknown agent "${schedule.agent}" at ${agentSystemPath}`,
      );
    }

    const driverName = schedule.driver ?? defaultDriver;
    if (!isKnownDriverName(driverName)) {
      throw new Error(
        `Schedule "${name}" references unknown driver "${driverName}"`,
      );
    }
  }

  const dotenvPath = rawConfig.secrets?.dotenv_path;
  if (dotenvPath) {
    const expanded = expandTilde(dotenvPath);
    if (!expanded.startsWith("/")) {
      resolve(homeDir, expanded);
    }
  }
}

function normalizeSchedules(
  rawSchedules: ConfigFile["schedules"],
): Record<string, ResolvedScheduleConfig> {
  const schedules: Record<string, ResolvedScheduleConfig> = {};

  for (const [name, schedule] of Object.entries(rawSchedules ?? {})) {
    schedules[name] = {
      description: schedule.description,
      enabled: schedule.enabled ?? true,
      cron: schedule.cron,
      agent: schedule.agent,
      driver: schedule.driver,
      model: schedule.model,
      prompt: schedule.prompt,
      output: schedule.output
        ? {
            type: schedule.output.type,
            channelId: schedule.output.channel_id,
          }
        : undefined,
    };
  }

  return schedules;
}

// --- Config Options ---

export interface ConfigOptions {
  home?: string;
  agentsDir?: string;
  skillsDir?: string;
  dataDir?: string;
}

// --- Config Loading Helpers ---

export function loadAndValidateConfig(
  configPath: string,
): z.infer<typeof ConfigFileSchema> {
  const content = readFileSync(configPath, "utf-8");
  return ConfigFileSchema.parse(JSON.parse(content));
}

function loadConfigWithFallback(
  configPath: string,
  fallbackPath: string,
): z.infer<typeof ConfigFileSchema> {
  let primaryError: Error | undefined;

  if (existsSync(configPath)) {
    try {
      const config = loadAndValidateConfig(configPath);
      try {
        copyFileSync(configPath, fallbackPath);
      } catch (err) {
        logger.warn({ err: toError(err) }, "config_backup_failed");
      }
      return config;
    } catch (err) {
      primaryError = toError(err);
    }
  } else {
    primaryError = new Error(
      `${Paths.CONFIG_FILE} not found in ${resolve(configPath, "..")}\n\nRun \`pug-claw init\` to set up your configuration.`,
    );
  }

  if (existsSync(fallbackPath)) {
    try {
      const config = loadAndValidateConfig(fallbackPath);
      console.warn(
        `Warning: ${Paths.CONFIG_FILE} failed to load (${primaryError?.message}). Using ${Paths.CONFIG_FALLBACK_FILE} as fallback.`,
      );
      return config;
    } catch (err) {
      logger.warn({ err: toError(err) }, "config_fallback_failed");
    }
  }

  throw primaryError;
}

// --- Main Entry Point ---

export async function resolveConfig(
  opts: ConfigOptions = {},
): Promise<ResolvedConfig> {
  const rawHome = opts.home ?? process.env[EnvVars.HOME] ?? Paths.DEFAULT_HOME;
  const homeDir = resolve(expandTilde(rawHome));

  if (!existsSync(homeDir)) {
    throw new Error(
      `pug-claw home directory not found: ${homeDir}\n\nRun \`pug-claw init\` to set up your configuration.`,
    );
  }

  const configPath = resolve(homeDir, Paths.CONFIG_FILE);
  const fallbackPath = resolve(homeDir, Paths.CONFIG_FALLBACK_FILE);
  const rawConfig = loadConfigWithFallback(configPath, fallbackPath);
  const paths = resolveConfigPaths(homeDir, rawConfig, opts);
  validateConfigSemantics(rawConfig, homeDir, paths);

  const secretsConfig = rawConfig.secrets;
  let secrets: SecretsProvider;
  if (secretsConfig?.provider === SecretsProviders.DOTENV) {
    const rawDotenvPath = expandTilde(
      secretsConfig.dotenv_path ?? Paths.DOT_ENV,
    );
    const dotenvPath = rawDotenvPath.startsWith("/")
      ? rawDotenvPath
      : resolve(homeDir, rawDotenvPath);
    secrets = new DotenvSecretsProvider(dotenvPath);
  } else {
    secrets = new EnvSecretsProvider();
  }

  let discord: DiscordIdentity | undefined;
  if (rawConfig.discord?.guild_id || rawConfig.discord?.owner_id) {
    discord = {
      guildId: rawConfig.discord.guild_id,
      ownerId: rawConfig.discord.owner_id,
    };
  }

  const drivers: Record<string, { defaultModel?: string; cwd?: string }> = {};
  if (rawConfig.drivers) {
    for (const [name, dc] of Object.entries(rawConfig.drivers)) {
      drivers[name] = { defaultModel: dc.default_model, cwd: dc.cwd };
    }
  }

  const config: ResolvedConfig = {
    homeDir,
    agentsDir: paths.agentsDir,
    skillsDir: paths.skillsDir,
    dataDir: paths.dataDir,
    logsDir: paths.logsDir,
    defaultAgent: rawConfig.default_agent ?? Defaults.AGENT,
    defaultDriver: rawConfig.default_driver ?? Defaults.DRIVER,
    drivers,
    channels: rawConfig.channels ?? {},
    scheduler: rawConfig.scheduler
      ? {
          timezone: rawConfig.scheduler.timezone,
        }
      : undefined,
    schedules: normalizeSchedules(rawConfig.schedules),
    discord,
    secrets,
  };

  logger.info(
    {
      homeDir: config.homeDir,
      agentsDir: config.agentsDir,
      skillsDir: config.skillsDir,
      dataDir: config.dataDir,
      logsDir: config.logsDir,
      defaultAgent: config.defaultAgent,
      defaultDriver: config.defaultDriver,
      channelCount: Object.keys(config.channels).length,
      scheduleCount: Object.keys(config.schedules).length,
    },
    "config_resolved",
  );

  return config;
}

export function getChannelConfig(
  config: ResolvedConfig,
  channelId: string,
): ChannelConfig {
  return config.channels[channelId] ?? {};
}
