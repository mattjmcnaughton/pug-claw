---
name: read-pug-claw-config
description: Read and inspect pug-claw configuration files and settings
metadata:
  managed-by: pug-claw
---

# Read Pug-Claw Config

Read and inspect pug-claw configuration without modifying it.

## Config Location

The config file lives at `$PUG_CLAW_HOME/config.json` (default: `~/.pug-claw/config.json`).

## Config Schema

The config file is a JSON object with these top-level fields:

| Field | Type | Description |
|-------|------|-------------|
| `default_agent` | string | Default agent name (e.g., "default") |
| `default_driver` | string | Default AI driver (e.g., "claude") |
| `drivers` | object | Per-driver config (each key is a driver name, value has optional `default_model`) |
| `channels` | object | Per-channel overrides (each key is a channel ID, value has optional `agent`, `driver`, `model`, `tools`) |
| `paths` | object | Optional path overrides: `agents_dir`, `skills_dir`, `data_dir` |
| `secrets` | object | Secrets provider config: `provider` ("env" or "dotenv"), optional `dotenv_path` |
| `discord` | object | Discord config: `guild_id`, `owner_id` |

## How to Read

Use the Read tool to read `$PUG_CLAW_HOME/config.json`. If `PUG_CLAW_HOME` is not set, use `~/.pug-claw/config.json`.

## Directory Structure

```
~/.pug-claw/
  config.json          # Main config
  agents/              # Agent definitions
    default/SYSTEM.md
  skills/              # Global skills
  data/                # Runtime data
  logs/system/         # Log files
```

## Inspecting Agents and Skills

- List agents: read the `agents/` directory under the home dir
- List skills: read the `skills/` directory under the home dir
- Each agent is a subdirectory with a `SYSTEM.md` file
- Each skill is a subdirectory with a `SKILL.md` file
