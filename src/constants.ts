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
  LOGS_DIR: "logs",
  SYSTEM_LOG_DIR: "system",
  SCHEDULES_LOG_DIR: "schedules",
  LOCKS_DIR: "locks",
  SCHEDULER_LOCK_DIR: "scheduler.lock",
  SCHEDULER_LOCK_OWNER_FILE: "owner.json",
  RUNTIME_DB_FILE: "pug-claw.sqlite",
} as const;

export const EnvVars = {
  HOME: "PUG_CLAW_HOME",
  AGENTS_DIR: "PUG_CLAW_AGENTS_DIR",
  SKILLS_DIR: "PUG_CLAW_SKILLS_DIR",
  DATA_DIR: "PUG_CLAW_DATA_DIR",
  LOGS_DIR: "PUG_CLAW_LOGS_DIR",
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
  SCHEDULER_POLL_INTERVAL_MS: 15_000,
} as const;

export const SecretsProviders = {
  ENV: "env",
  DOTENV: "dotenv",
} as const;

export const Limits = {
  DISCORD_MESSAGE_LENGTH: 2000,
} as const;

export const VERSION = "0.1.0";
