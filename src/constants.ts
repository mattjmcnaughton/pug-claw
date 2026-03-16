export const Paths = {
  DEFAULT_HOME: "~/.pug-claw",
  CONFIG_FILE: "config.json",
  CONFIG_FALLBACK_FILE: "config.last-good.json",
  SYSTEM_MD: "SYSTEM.md",
  SKILL_MD: "SKILL.md",
  DOT_ENV: ".env",
  AGENTS_DIR: "agents",
  SKILLS_DIR: "skills",
  PLUGINS_DIR: "plugins",
  DATA_DIR: "data",
  LOG_DIR: "logs/system",
} as const;

export const EnvVars = {
  HOME: "PUG_CLAW_HOME",
  AGENTS_DIR: "PUG_CLAW_AGENTS_DIR",
  SKILLS_DIR: "PUG_CLAW_SKILLS_DIR",
  DATA_DIR: "PUG_CLAW_DATA_DIR",
  LOG_LEVEL: "LOG_LEVEL",
} as const;

export const Drivers = {
  CLAUDE: "claude",
  PI: "pi",
} as const;

export const Defaults = {
  AGENT: "default",
  DRIVER: "claude",
  SECRETS_PROVIDER: "env",
} as const;

export const SecretsProviders = {
  ENV: "env",
  DOTENV: "dotenv",
} as const;

export const Limits = {
  DISCORD_MESSAGE_LENGTH: 2000,
} as const;
