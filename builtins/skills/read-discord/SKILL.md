---
name: read-discord
description: Read Discord data (channels, messages, members) via discord.py
metadata:
  managed-by: pug-claw
---

# Read Discord

Read Discord server data using the discord.py script.

## Prerequisites

- `DISCORD_BOT_TOKEN` must be set in the environment or secrets provider
- The bot must be a member of the target guild

## Usage

Run commands via `uvx` with the script at `./scripts/discord.py`:

```bash
uvx --with discord.py python ./scripts/discord.py <command> [options]
```

## Commands

### list-channels

List all channels in a guild.

```bash
uvx --with discord.py python ./scripts/discord.py list-channels --guild-id=<id>
```

### read-messages

Read recent messages from a channel.

```bash
uvx --with discord.py python ./scripts/discord.py read-messages --channel-id=<id> --limit=<n>
```

Options:
- `--limit` — Number of messages to fetch (default: 25, max: 100)
- `--before` — Message ID to fetch messages before (for pagination)

### list-members

List members of a guild.

```bash
uvx --with discord.py python ./scripts/discord.py list-members --guild-id=<id> --limit=<n>
```

### get-guild

Get guild (server) information.

```bash
uvx --with discord.py python ./scripts/discord.py get-guild --guild-id=<id>
```

### get-channel

Get detailed channel information.

```bash
uvx --with discord.py python ./scripts/discord.py get-channel --channel-id=<id>
```

## Output

All commands output JSON for easy parsing. Each response includes a `success` boolean and either `data` or `error` fields.
