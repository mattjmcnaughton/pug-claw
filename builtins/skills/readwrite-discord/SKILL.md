---
name: readwrite-discord
description: Send messages, create channels, and manage Discord via discord.js
metadata:
  managed-by: pug-claw
---

# Read/Write Discord

Read and write Discord server data using the discord.js script.

## Prerequisites

- `DISCORD_BOT_TOKEN` must be set in the environment or secrets provider
- The bot must be a member of the target guild with appropriate permissions

## Usage

Run commands via `bun run` with the script at `./scripts/discord.ts`:

```bash
bun run ./scripts/discord.ts <command> [options]
```

## Read Commands

### list-channels

```bash
bun run ./scripts/discord.ts list-channels --guild-id=<id>
```

### read-messages

```bash
bun run ./scripts/discord.ts read-messages --channel-id=<id> --limit=<n>
```

### list-members

```bash
bun run ./scripts/discord.ts list-members --guild-id=<id> --limit=<n>
```

### get-guild

```bash
bun run ./scripts/discord.ts get-guild --guild-id=<id>
```

### get-channel

```bash
bun run ./scripts/discord.ts get-channel --channel-id=<id>
```

## Write Commands

### send-message

Send a message to a channel.

```bash
bun run ./scripts/discord.ts send-message --channel-id=<id> --content="Hello, world!"
```

Note: Messages are limited to 2000 characters. For longer content, split into multiple messages.

### create-channel

Create a new text channel in a guild.

```bash
bun run ./scripts/discord.ts create-channel --guild-id=<id> --name=<channel-name>
```

Options:
- `--topic` — Channel topic description
- `--category-id` — Parent category ID

### modify-channel

Modify an existing channel.

```bash
bun run ./scripts/discord.ts modify-channel --channel-id=<id> --name=<new-name> --topic=<new-topic>
```

### delete-channel

Delete a channel. Use with caution.

```bash
bun run ./scripts/discord.ts delete-channel --channel-id=<id>
```

### add-reaction

Add a reaction to a message.

```bash
bun run ./scripts/discord.ts add-reaction --channel-id=<id> --message-id=<id> --emoji=<emoji>
```

## Safety Notes

- Confirm with the user before executing destructive operations (delete-channel)
- Message content is limited to 2000 characters
- Rate limits apply — avoid rapid successive calls

## Output

All commands output JSON with `success` boolean and either `data` or `error` fields.
