---
name: readwrite-pug-claw-config
description: Edit pug-claw configuration (add channels, schedules, change defaults, update paths)
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
5. Remind the user to run `!system reload` (Discord) or `/system reload` (TUI) to apply changes

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

### Add a schedule

```json
{
  "timezone": "America/New_York",
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
  }
}
```

When editing schedules:

- use standard 5-field cron syntax
- keep schedule names slug-like, e.g. `daily-summary`
- ensure the referenced agent already exists
- set `enabled: false` if the user wants the schedule defined but not automatically active
- remember that scheduled runs always use a fresh session and do not inherit channel config
- if the user wants Discord delivery, use `output.type = "discord_channel"`

## Important Notes

- Always preserve existing fields when editing — read first, modify, then write
- The config is validated on load — invalid JSON, invalid cron expressions, unknown schedule agents, unknown schedule drivers, or invalid timezones will prevent startup
- After editing, remind the user to `!system reload` or `/system reload` to pick up changes
- Scheduler control commands are Discord owner-only: `!schedule list` and `!schedule run <name>`
- Back up the config before making major changes (`!backup export` in Discord or `/backup export` in the TUI)
