---
name: readwrite-pug-claw-config
description: Edit pug-claw configuration (add channels, change defaults, update paths)
metadata:
  managed-by: pug-claw
---

# Read/Write Pug-Claw Config

Edit pug-claw configuration files safely.

## Config Location

`$PUG_CLAW_HOME/config.json` (default: `~/.pug-claw/config.json`).

## Safe Editing Process

1. Read the current config with the Read tool
2. Parse and understand the current state
3. Make targeted modifications
4. Write the updated config using the Write tool
5. Remind the user to run `!reload` (Discord) or `/reload` (TUI) to apply changes

## Config Schema

See the reference file at `./references/config-schema.md` for the full schema.

## Common Operations

### Add a channel override

```json
{
  "channels": {
    "channel-id-here": {
      "agent": "researcher",
      "driver": "claude",
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

### Change default agent

Set `default_agent` to the agent name (must have a corresponding directory in `agents/`).

### Change default driver

Set `default_driver` to `"claude"` or `"pi"`.

### Update secrets provider

```json
{
  "secrets": {
    "provider": "dotenv",
    "dotenv_path": ".env"
  }
}
```

### Set Discord identity

```json
{
  "discord": {
    "guild_id": "your-guild-id",
    "owner_id": "your-user-id"
  }
}
```

## Important Notes

- Always preserve existing fields when editing — read first, modify, then write
- The config is validated by Zod on load — invalid JSON will prevent startup
- After editing, remind the user to `!reload` or `/reload` to pick up changes
- Back up the config before making major changes
