---
name: read-discord
description: Read Discord data (channels, messages, members) via discord.js
metadata:
  managed-by: pug-claw
---

# Read Discord

Read Discord server data using the discord.js script.

## Prerequisites

- `DISCORD_BOT_TOKEN` must be set in the environment or secrets provider
- The bot must be a member of the target guild

## Usage

Run commands via `bun run` with the script at `./scripts/discord.ts`:

```bash
bun run ./scripts/discord.ts <command> [options]
```

## Commands

### list-channels

List all channels in a guild.

```bash
bun run ./scripts/discord.ts list-channels --guild-id=<id>
```

### read-messages

Read recent messages from a channel.

```bash
bun run ./scripts/discord.ts read-messages --channel-id=<id> --limit=<n>
```

Options:
- `--limit` — Number of messages to fetch (default: 25, max: 100)
- `--before` — Message ID to fetch messages before (for pagination)

### list-members

List members of a guild.

```bash
bun run ./scripts/discord.ts list-members --guild-id=<id> --limit=<n>
```

### get-guild

Get guild (server) information.

```bash
bun run ./scripts/discord.ts get-guild --guild-id=<id>
```

### get-channel

Get detailed channel information.

```bash
bun run ./scripts/discord.ts get-channel --channel-id=<id>
```

## Output

All commands output JSON for easy parsing. Each response includes a `success` boolean and either `data` or `error` fields.
