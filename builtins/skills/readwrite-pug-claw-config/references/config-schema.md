# Config Schema Reference

## Top-Level Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `default_agent` | string | No | `"default"` | Agent name to use when none specified |
| `default_driver` | string | No | `"claude"` | Driver to use when none specified |
| `drivers` | object | No | `{}` | Per-driver configuration |
| `channels` | object | No | `{}` | Per-channel overrides |
| `paths` | object | No | — | Custom directory paths |
| `secrets` | object | No | — | Secrets provider configuration |
| `discord` | object | No | — | Discord-specific settings |

## `drivers` Object

Each key is a driver name (e.g., `"claude"`, `"pi"`):

| Field | Type | Description |
|-------|------|-------------|
| `default_model` | string? | Default model for this driver |

## `channels` Object

Each key is a channel ID:

| Field | Type | Description |
|-------|------|-------------|
| `agent` | string? | Agent override for this channel |
| `driver` | string? | Driver override |
| `model` | string? | Model override |
| `tools` | string[]? | Tool overrides |

## `paths` Object

| Field | Type | Description |
|-------|------|-------------|
| `agents_dir` | string? | Custom agents directory (absolute or relative to home) |
| `skills_dir` | string? | Custom skills directory |
| `data_dir` | string? | Custom data directory |

## `secrets` Object

| Field | Type | Description |
|-------|------|-------------|
| `provider` | `"env"` or `"dotenv"` | How to load secrets |
| `dotenv_path` | string? | Path to .env file (relative to home or absolute) |

## `discord` Object

| Field | Type | Description |
|-------|------|-------------|
| `guild_id` | string? | Discord server (guild) ID |
| `owner_id` | string? | Bot owner's Discord user ID |
