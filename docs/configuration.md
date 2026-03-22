# Configuration

pug-claw is configured through a single `config.json` file in its home directory (`~/.pug-claw/` by default). Secrets are provided via environment variables or an optional `.env` file.

## Getting started

Run the interactive setup wizard to create your configuration:

```bash
pug-claw init
# or: bun run init
```

This creates `~/.pug-claw/` with a `config.json`, default agent, and optional `.env` template. It also initializes `scheduler.timezone` from the host machine's current timezone.

## Home directory

The home directory defaults to `~/.pug-claw`. Override it with:

- **CLI flag:** `--home /path/to/home`
- **Environment variable:** `PUG_CLAW_HOME=/path/to/home`

The home directory must exist and contain a `config.json`. If it doesn't, pug-claw will exit with a message to run `pug-claw init`.

## Directory layout

```
~/.pug-claw/
  config.json          # Main configuration file
  agents/              # Agent definitions
    default/
      SYSTEM.md        # Agent system prompt
      skills/          # Agent-specific skills
  skills/              # Global skills (available to all agents)
  internal/            # Runtime state (SQLite runtime DB, locks, plugins)
  data/                # User workspace data
  code/                # Agent-generated code projects
  logs/
    system/            # Application logs
    schedules/         # Scheduler audit logs (JSONL)
  .env                 # Optional dotenv secrets file
```

## config.json

Most fields are optional. Missing fields use sensible defaults. One exception: `scheduler.timezone` is required whenever `schedules` are configured.

### Full schema

```json
{
  "default_agent": "default",
  "default_driver": "claude",
  "paths": {
    "agents_dir": "agents",
    "skills_dir": "skills",
    "internal_dir": "internal",
    "data_dir": "data",
    "code_dir": "code",
    "logs_dir": "logs"
  },
  "backup": {
    "include_dirs": ["data_dir", "code_dir"],
    "output_dir": "backups"
  },
  "scheduler": {
    "timezone": "America/New_York"
  },
  "drivers": {
    "claude": {},
    "pi": {
      "default_model": "openrouter/minimax/minimax-m2.5"
    }
  },
  "channels": {
    "123456789": {
      "agent": "researcher",
      "driver": "pi",
      "model": "openrouter/openai/gpt-4o",
      "tools": ["Read", "Glob", "Grep"]
    }
  },
  "schedules": {
    "daily-summary": {
      "description": "Post a morning summary to Discord",
      "cron": "0 9 * * *",
      "agent": "writer",
      "prompt": "Summarize yesterday's important activity.",
      "output": {
        "type": "discord_channel",
        "channel_id": "123456789"
      }
    }
  },
  "secrets": {
    "provider": "env",
    "dotenv_path": ".env"
  },
  "discord": {
    "guild_id": "123456789",
    "owner_id": "987654321"
  }
}
```

### Top-level fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `default_agent` | string | `"default"` | Agent to use when no channel-specific override exists |
| `default_driver` | string | `"claude"` | Driver to use by default (`claude` or `pi`) |
| `paths` | object | — | Custom paths for agents, skills, internal runtime data, workspace data, code, and logs |
| `backup` | object | — | Backup configuration for optional directory inclusion |
| `scheduler` | object | — | Scheduler configuration, currently `timezone` |
| `drivers` | object | `{}` | Per-driver configuration |
| `channels` | object | `{}` | Per-channel overrides keyed by Discord channel ID |
| `schedules` | object | `{}` | Scheduled agent jobs keyed by schedule name |
| `secrets` | object | — | Secrets provider configuration |
| `discord` | object | — | Discord identity configuration |

### Paths

All paths are relative to the home directory unless absolute. Each can also be overridden via CLI flag or environment variable.

| Field | CLI flag | Env var | Default |
|-------|----------|---------|---------|
| `agents_dir` | `--agents-dir` | `PUG_CLAW_AGENTS_DIR` | `agents` |
| `skills_dir` | `--skills-dir` | `PUG_CLAW_SKILLS_DIR` | `skills` |
| `internal_dir` | `--internal-dir` | `PUG_CLAW_INTERNAL_DIR` | `internal` |
| `data_dir` | `--data-dir` | `PUG_CLAW_DATA_DIR` | `data` |
| `code_dir` | `--code-dir` | `PUG_CLAW_CODE_DIR` | `code` |
| `logs_dir` | `--logs-dir` | `PUG_CLAW_LOGS_DIR` | `logs` |

**Override precedence:** CLI flag > environment variable > config file > default.

### Backup

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `include_dirs` | string[] | `[]` | Optional directories to include in backups. Supported values: `data_dir`, `code_dir`, `logs_dir`. |
| `output_dir` | string | current working directory | Default directory for backup archives when `pug-claw export` is run without `--output` or `--output-dir`. Relative paths are resolved from the pug-claw home directory. |

Home content (`config.json`, `config.last-good.json`, agents, skills) and the runtime SQLite DB are always included. `.env`, runtime locks, and generated plugins are always excluded.

### Scheduler

| Field | Type | Description |
|-------|------|-------------|
| `timezone` | string | Required when `schedules` is present. Must be a valid IANA timezone such as `America/New_York` or `UTC`. |

### Schedules

Schedules are keyed by name. Schedule names must match `^[a-z0-9][a-z0-9_-]*$`.

Each schedule supports:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | No | Human-readable description |
| `enabled` | boolean | No | Defaults to `true`; `false` disables automatic cron execution |
| `cron` | string | Yes | Standard 5-field cron expression |
| `agent` | string | Yes | Agent name to run |
| `driver` | string | No | Optional driver override |
| `model` | string | No | Optional model override |
| `prompt` | string | Yes | Prompt sent to the agent for each run |
| `output` | object | No | Optional explicit output target |

Supported `output` values:

```json
{
  "type": "discord_channel",
  "channel_id": "123456789"
}
```

Scheduler semantics:

- schedules run only in Discord mode
- each run uses a fresh session
- successful Discord delivery posts only the final response text
- failures post a short message with a `run_id`
- missed runs are skipped
- overlapping runs are skipped
- disabled schedules can still be triggered manually with `!schedule run <name>`
- schedules do not inherit per-channel Discord config

See [scheduler.md](./scheduler.md) for the operational guide.

### Driver configuration

Each key under `drivers` is a driver name. Currently supported fields:

| Field | Type | Description |
|-------|------|-------------|
| `default_model` | string | Default model for this driver. Overrides the driver's built-in default. |

### Channel configuration

Each key under `channels` is a Discord channel ID (string). All fields are optional — unset fields fall back to the top-level defaults.

| Field | Type | Description |
|-------|------|-------------|
| `agent` | string | Agent to use in this channel |
| `driver` | string | Driver to use in this channel |
| `model` | string | Model to use in this channel |
| `tools` | string[] | Tools to enable for the Claude driver in this channel |

### Secrets

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `"env"` or `"dotenv"` | `"env"` | How to load secrets |
| `dotenv_path` | string | `".env"` | Path to `.env` file (relative to home dir, only used with `dotenv` provider) |

With the `dotenv` provider, secrets are loaded from the `.env` file but environment variables always take precedence. The `.env` format supports `KEY=VALUE`, quoted values, and comments.

### Discord

| Field | Type | Description |
|-------|------|-------------|
| `guild_id` | string | If set, the bot only responds to messages from this guild |
| `owner_id` | string | Bot owner ID (logged at startup for visibility) |

The bot user ID is fetched from `client.user.id` at runtime and does not need to be configured.

### Resolution order

For each runtime setting, pug-claw resolves in this order:

1. Runtime override (via `!driver set`, `!model set`, `!agent set` commands)
2. Channel-specific config from `config.json`
3. Top-level default from `config.json`
4. Driver built-in default

### Validation

`config.json` is validated at startup using Zod schemas and additional semantic checks. If the file contains invalid data, pug-claw will fail to start with a descriptive error.

Scheduler validation includes:

- missing `scheduler.timezone` when `schedules` are present
- invalid schedule names
- invalid IANA timezone names
- invalid cron expressions
- unknown schedule agents
- unknown schedule drivers

## Environment variables

These environment variables are used by pug-claw regardless of secrets provider:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | Yes (Discord mode) | — | Bot token from the Discord Developer Portal |
| `ANTHROPIC_API_KEY` | Yes (Claude driver) | — | Anthropic API key |
| `OPENROUTER_API_KEY` | No | — | OpenRouter API key for Pi driver models |
| `LOG_LEVEL` | No | `info` | Log verbosity: `debug`, `info`, `warn`, `error`, `fatal` |
| `NODE_ENV` | No | — | Set to `production` for JSON log output |
| `PUG_CLAW_HOME` | No | `~/.pug-claw` | Override the home directory |
| `PUG_CLAW_AGENTS_DIR` | No | `<home>/agents` | Override the agents directory |
| `PUG_CLAW_SKILLS_DIR` | No | `<home>/skills` | Override the skills directory |
| `PUG_CLAW_INTERNAL_DIR` | No | `<home>/internal` | Override the runtime state directory |
| `PUG_CLAW_DATA_DIR` | No | `<home>/data` | Override the user data directory |
| `PUG_CLAW_CODE_DIR` | No | `<home>/code` | Override the generated code directory |
| `PUG_CLAW_LOGS_DIR` | No | `<home>/logs` | Override the logs directory |
