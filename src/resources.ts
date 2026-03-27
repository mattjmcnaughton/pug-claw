import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Defaults, EnvVars, Paths } from "./constants.ts";
import { logger } from "./logger.ts";
import {
  type ConfigOptions,
  expandTilde,
  type ResolvedConfigPaths,
  resolveConfigPaths,
  resolveConfigRelativePath,
  resolveLogsDir,
} from "./config/paths.ts";
import {
  createSecretsProvider,
  type SecretsProvider,
} from "./config/secrets.ts";
import {
  type BackupIncludeDirKey,
  type ChannelConfig,
  type ConfigFile,
  ConfigFileSchema,
  loadAndValidateConfig,
  type ResolvedMemoryConfig,
  type ResolvedScheduleConfig,
  type ScheduleConfig,
  type ScheduleOutputConfig,
} from "./config/schema.ts";
import {
  normalizeSchedules,
  validateConfigSemantics as validateConfigSemanticsInternal,
} from "./config/validation.ts";

export type {
  BackupIncludeDirKey,
  ChannelConfig,
  ConfigFile,
  ConfigOptions,
  ResolvedConfigPaths,
  ResolvedMemoryConfig,
  ResolvedScheduleConfig,
  ScheduleConfig,
  ScheduleOutputConfig,
  SecretsProvider,
};

export {
  ConfigFileSchema,
  expandTilde,
  loadAndValidateConfig,
  resolveConfigPaths,
  resolveLogsDir,
};

export interface DiscordIdentity {
  guildId?: string | undefined;
  ownerId?: string | undefined;
}

export interface ResolvedConfig {
  homeDir: string;
  agentsDir: string;
  skillsDir: string;
  internalDir: string;
  dataDir: string;
  codeDir: string;
  logsDir: string;
  backupIncludeDirs: BackupIncludeDirKey[];
  backupOutputDir?: string | undefined;
  memory: ResolvedMemoryConfig;
  timezone: string;

  defaultAgent: string;
  defaultDriver: string;
  drivers: Record<
    string,
    {
      defaultModel?: string | undefined;
      cwd?: string | undefined;
    }
  >;
  channels: Record<string, ChannelConfig>;
  schedules: Record<string, ResolvedScheduleConfig>;

  discord?: DiscordIdentity | undefined;

  secrets: SecretsProvider;
}

export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function validateConfigSemantics(
  rawConfig: ConfigFile,
  homeDir: string,
  paths: ResolvedConfigPaths,
): void {
  validateConfigSemanticsInternal(rawConfig, homeDir, paths, toError);
}

function loadConfigWithFallback(
  configPath: string,
  fallbackPath: string,
): ConfigFile {
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

  let discord: DiscordIdentity | undefined;
  if (rawConfig.discord?.guild_id || rawConfig.discord?.owner_id) {
    discord = {
      guildId: rawConfig.discord.guild_id,
      ownerId: rawConfig.discord.owner_id,
    };
  }

  const drivers: ResolvedConfig["drivers"] = {};
  if (rawConfig.drivers) {
    for (const [name, driverConfig] of Object.entries(rawConfig.drivers)) {
      drivers[name] = {
        defaultModel: driverConfig.default_model,
        cwd: driverConfig.cwd,
      };
    }
  }

  const timezone =
    rawConfig.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC";

  const config: ResolvedConfig = {
    homeDir,
    agentsDir: paths.agentsDir,
    skillsDir: paths.skillsDir,
    internalDir: paths.internalDir,
    dataDir: paths.dataDir,
    codeDir: paths.codeDir,
    logsDir: paths.logsDir,
    backupIncludeDirs: rawConfig.backup?.include_dirs ?? [],
    backupOutputDir: resolveConfigRelativePath(
      homeDir,
      rawConfig.backup?.output_dir,
    ),
    memory: {
      enabled: rawConfig.memory?.enabled ?? true,
      injectionBudgetTokens: rawConfig.memory?.injection_budget_tokens ?? 2000,
      embeddings: {
        enabled: rawConfig.memory?.embeddings?.enabled ?? false,
        model: rawConfig.memory?.embeddings?.model ?? "Xenova/all-MiniLM-L6-v2",
      },
      seed: {
        global: rawConfig.memory?.seed?.global ?? [],
      },
    },
    timezone,
    defaultAgent: rawConfig.default_agent ?? Defaults.AGENT,
    defaultDriver: rawConfig.default_driver ?? Defaults.DRIVER,
    drivers,
    channels: rawConfig.channels ?? {},
    schedules: normalizeSchedules(rawConfig.schedules),
    discord,
    secrets: createSecretsProvider(homeDir, rawConfig.secrets),
  };

  logger.info(
    {
      homeDir: config.homeDir,
      agentsDir: config.agentsDir,
      skillsDir: config.skillsDir,
      internalDir: config.internalDir,
      dataDir: config.dataDir,
      codeDir: config.codeDir,
      logsDir: config.logsDir,
      backupIncludeDirs: config.backupIncludeDirs,
      backupOutputDir: config.backupOutputDir,
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
