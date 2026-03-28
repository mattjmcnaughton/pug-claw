export const Paths = {
  DEFAULT_HOME: "~/.pug-claw",
  CONFIG_FILE: "config.json",
  CONFIG_FALLBACK_FILE: "config.last-good.json",
  SYSTEM_MD: "SYSTEM.md",
  SKILL_MD: "SKILL.md",
  DOT_ENV: ".env",
  AGENTS_DIR: "agents",
  SKILLS_DIR: "skills",
  INTERNAL_DIR: "internal",
  PLUGINS_DIR: "plugins",
  DATA_DIR: "data",
  CODE_DIR: "code",
  LOGS_DIR: "logs",
  SYSTEM_LOG_DIR: "system",
  SCHEDULES_LOG_DIR: "schedules",
  LOCKS_DIR: "locks",
  SCHEDULER_LOCK_DIR: "scheduler.lock",
  SCHEDULER_LOCK_OWNER_FILE: "owner.json",
  RUNTIME_DB_FILE: "pug-claw.sqlite",
  MODELS_DIR: "models",
} as const;

export const EnvVars = {
  HOME: "PUG_CLAW_HOME",
  AGENTS_DIR: "PUG_CLAW_AGENTS_DIR",
  SKILLS_DIR: "PUG_CLAW_SKILLS_DIR",
  INTERNAL_DIR: "PUG_CLAW_INTERNAL_DIR",
  DATA_DIR: "PUG_CLAW_DATA_DIR",
  CODE_DIR: "PUG_CLAW_CODE_DIR",
  LOGS_DIR: "PUG_CLAW_LOGS_DIR",
  LOG_LEVEL: "LOG_LEVEL",
} as const;

export const Drivers = {
  CLAUDE: "claude",
  PI: "pi",
} as const;

export type DriverName = (typeof Drivers)[keyof typeof Drivers];

export const Frontends = {
  DISCORD: "discord",
  TUI: "tui",
} as const;

export type FrontendName = (typeof Frontends)[keyof typeof Frontends];

export const CommandPrefixes = {
  DISCORD: "!",
  TUI: "/",
} as const;

export type CommandPrefix =
  (typeof CommandPrefixes)[keyof typeof CommandPrefixes];

export const SessionScopePrefixes = {
  THREAD: "thread:",
  REPLY: "reply:",
} as const;

export const SchedulerMessages = {
  SCHEDULES_HEADER: "**Schedules**",
  SCHEDULES_NONE_CONFIGURED: "**Schedules**\n(none configured)",
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

export const FrontmatterMetadata = {
  MANAGED_BY: "managed-by",
} as const;

export const ManagedBy = {
  PUG_CLAW: "pug-claw",
} as const;

export const Limits = {
  DISCORD_MESSAGE_LENGTH: 2000,
} as const;

export const CodingDefaults = {
  AGENT: "claude",
  POLL_INTERVAL_SECONDS: 15,
  TASK_TIMEOUT_MINUTES: 30,
} as const;

export const CodingTmuxDefaults = {
  READ_LINES: 100,
} as const;

export const VERSION = "0.1.0";
