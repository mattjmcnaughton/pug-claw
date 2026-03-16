import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { Defaults, EnvVars, Paths, SecretsProviders } from "./constants.ts";
import { logger } from "./logger.ts";

// --- Zod Schemas ---

const DriverConfigSchema = z.object({
  default_model: z.string().optional(),
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
  provider: z.enum(["env", "dotenv"]).optional(),
  dotenv_path: z.string().optional(),
});

const DiscordConfigSchema = z.object({
  guild_id: z.string().optional(),
  owner_id: z.string().optional(),
});

export const ConfigFileSchema = z.object({
  paths: PathsConfigSchema.optional(),
  secrets: SecretsConfigSchema.optional(),
  discord: DiscordConfigSchema.optional(),
  default_agent: z.string().optional(),
  default_driver: z.string().optional(),
  drivers: z.record(z.string(), DriverConfigSchema).optional(),
  channels: z.record(z.string(), ChannelConfigSchema).optional(),
});

// --- Exported Types ---

export type ConfigFile = z.infer<typeof ConfigFileSchema>;
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

export interface SecretsProvider {
  get(key: string): string | undefined;
  require(key: string): string;
}

export interface DiscordIdentity {
  guildId: string;
  ownerId: string;
}

export interface ResolvedConfig {
  homeDir: string;
  agentsDir: string;
  skillsDir: string;
  dataDir: string;

  defaultAgent: string;
  defaultDriver: string;
  drivers: Record<string, { defaultModel?: string }>;
  channels: Record<string, ChannelConfig>;

  discord?: DiscordIdentity;

  secrets: SecretsProvider;
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
        // Strip surrounding quotes
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        this.vars[key] = value;
      }
    }
  }

  get(key: string): string | undefined {
    // process.env wins over dotenv file
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
    // Absolute paths used as-is, relative resolved against homeDir
    if (expanded.startsWith("/")) return expanded;
    return resolve(homeDir, expanded);
  }
  return resolve(homeDir, defaultRelative);
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

  // Try primary config
  if (existsSync(configPath)) {
    try {
      const config = loadAndValidateConfig(configPath);
      // On success, save as last-good
      try {
        copyFileSync(configPath, fallbackPath);
      } catch (err) {
        logger.warn({ err: toError(err) }, "config_backup_failed");
      }
      return config;
    } catch (err) {
      primaryError = err instanceof Error ? err : new Error(String(err));
    }
  } else {
    primaryError = new Error(
      `config.json not found in ${resolve(configPath, "..")}\n\nRun \`pug-claw init\` to set up your configuration.`,
    );
  }

  // Try fallback
  if (existsSync(fallbackPath)) {
    try {
      const config = loadAndValidateConfig(fallbackPath);
      console.warn(
        `Warning: config.json failed to load (${primaryError?.message}). Using config.last-good.json as fallback.`,
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
  // 1. Determine home dir
  const rawHome = opts.home ?? process.env[EnvVars.HOME] ?? Paths.DEFAULT_HOME;
  const homeDir = resolve(expandTilde(rawHome));

  // 2. Verify home dir and config.json exist
  if (!existsSync(homeDir)) {
    throw new Error(
      `pug-claw home directory not found: ${homeDir}\n\nRun \`pug-claw init\` to set up your configuration.`,
    );
  }

  const configPath = resolve(homeDir, Paths.CONFIG_FILE);
  const fallbackPath = resolve(homeDir, Paths.CONFIG_FALLBACK_FILE);

  // 3. Load and validate config.json (with fallback)
  const rawConfig = loadConfigWithFallback(configPath, fallbackPath);

  // 4. Resolve paths
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

  // 5. Create secrets provider
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

  // 6. Build discord identity
  let discord: DiscordIdentity | undefined;
  if (rawConfig.discord?.guild_id && rawConfig.discord?.owner_id) {
    discord = {
      guildId: rawConfig.discord.guild_id,
      ownerId: rawConfig.discord.owner_id,
    };
  } else if (rawConfig.discord?.guild_id || rawConfig.discord?.owner_id) {
    // Partial config — still set what we have
    discord = {
      guildId: rawConfig.discord.guild_id ?? "",
      ownerId: rawConfig.discord.owner_id ?? "",
    };
  }

  // 7. Build drivers map (convert from snake_case config to camelCase)
  const drivers: Record<string, { defaultModel?: string }> = {};
  if (rawConfig.drivers) {
    for (const [name, dc] of Object.entries(rawConfig.drivers)) {
      drivers[name] = { defaultModel: dc.default_model };
    }
  }

  const config: ResolvedConfig = {
    homeDir,
    agentsDir,
    skillsDir,
    dataDir,
    defaultAgent: rawConfig.default_agent ?? Defaults.AGENT,
    defaultDriver: rawConfig.default_driver ?? Defaults.DRIVER,
    drivers,
    channels: rawConfig.channels ?? {},
    discord,
    secrets,
  };

  logger.info(
    {
      homeDir: config.homeDir,
      agentsDir: config.agentsDir,
      skillsDir: config.skillsDir,
      defaultAgent: config.defaultAgent,
      defaultDriver: config.defaultDriver,
      channelCount: Object.keys(config.channels).length,
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
