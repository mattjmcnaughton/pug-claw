# Configuration

pug-claw is configured through two mechanisms: environment variables (`.env`) for secrets and runtime settings, and `agents.json` for bot behavior.

## Environment variables

Set these in the `.env` file (copied from `.env.example`):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | Yes (Discord mode) | — | Bot token from the Discord Developer Portal |
| `ANTHROPIC_API_KEY` | Yes (Claude driver) | — | Anthropic API key |
| `OPENROUTER_API_KEY` | No | — | OpenRouter API key for Pi driver models |
| `LOG_LEVEL` | No | `info` | Log verbosity: `debug`, `info`, `warn`, `error`, `fatal` |
| `NODE_ENV` | No | — | Set to `production` for JSON log output |

## agents.json

The main configuration file controlling bot behavior. Validated at startup using Zod schemas.

### Full schema

```json
{
  "default_agent": "default",
  "default_driver": "claude",
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
  }
}
```

### Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `default_agent` | string | Yes | Agent to use when no channel-specific override exists. Must match a directory under `agents/`. |
| `default_driver` | string | Yes | Driver to use by default. Must be `claude` or `pi`. |
| `drivers` | object | No | Per-driver configuration (see below). Defaults to `{}`. |
| `channels` | object | No | Per-channel overrides keyed by Discord channel ID. Defaults to `{}`. |

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

### Resolution order

For each setting, pug-claw resolves in this order:

1. Runtime override (via `!driver`, `!model`, `!agent` commands)
2. Channel-specific config from `agents.json`
3. Top-level default from `agents.json`
4. Driver built-in default

### Validation

`agents.json` is validated at startup. If the file is missing or contains invalid data, pug-claw will fail to start with a descriptive error. The Zod schemas enforce:

- `default_agent` and `default_driver` are required strings
- `drivers` and `channels` are optional objects with known field types
- `tools` (if present) must be an array of strings
