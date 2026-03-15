# Configuration

pug-claw is configured through a single `config.json` file in its home directory (`~/.pug-claw/` by default). Secrets are provided via environment variables or an optional `.env` file.

## Getting started

Run the interactive setup wizard to create your configuration:

```bash
pug-claw init
# or: bun run init
```

This creates `~/.pug-claw/` with a `config.json`, default agent, and optional `.env` template.

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
  data/                # Runtime data (memory, conversations, logs)
  .env                 # Optional dotenv secrets file
```

## config.json

All fields are optional. Missing fields use sensible defaults.

### Full schema

```json
{
  "default_agent": "default",
  "default_driver": "claude",
  "paths": {
    "agents_dir": "agents",
    "skills_dir": "skills",
    "data_dir": "data"
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
| `paths` | object | — | Custom paths for agents, skills, and data directories |
| `drivers` | object | `{}` | Per-driver configuration |
| `channels` | object | `{}` | Per-channel overrides keyed by Discord channel ID |
| `secrets` | object | — | Secrets provider configuration |
| `discord` | object | — | Discord identity configuration |

### Paths

All paths are relative to the home directory unless absolute. Each can also be overridden via CLI flag or environment variable.

| Field | CLI flag | Env var | Default |
|-------|----------|---------|---------|
| `agents_dir` | `--agents-dir` | `PUG_CLAW_AGENTS_DIR` | `agents` |
| `skills_dir` | `--skills-dir` | `PUG_CLAW_SKILLS_DIR` | `skills` |
| `data_dir` | `--data-dir` | `PUG_CLAW_DATA_DIR` | `data` |

**Override precedence:** CLI flag > environment variable > config file > default.

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

1. Runtime override (via `!driver`, `!model`, `!agent` commands)
2. Channel-specific config from `config.json`
3. Top-level default from `config.json`
4. Driver built-in default

### Validation

`config.json` is validated at startup using Zod schemas. If the file contains invalid data, pug-claw will fail to start with a descriptive error.

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
