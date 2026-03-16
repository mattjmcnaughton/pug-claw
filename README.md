# pug-claw

A multi-driver AI agent bot with Discord and TUI frontends. Swap between **Claude** (via Agent SDK) and **Pi** (via OpenRouter/Codex) backends on the fly, with per-channel configuration and a pluggable agent/skills system.

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- [Node.js](https://nodejs.org/) >= 20 (required by some dependencies)
- A [Discord bot token](https://discord.com/developers/applications) with the **Message Content** privileged intent enabled
- An [Anthropic API key](https://console.anthropic.com/) (for the Claude driver) — **or** existing Claude Code credentials (`claude auth login`)
- An [OpenRouter API key](https://openrouter.ai/) (for the Pi driver, optional)

## Installation

### Homebrew

```bash
brew install mattjmcnaughton/tap/pug-claw
```

### Standalone binary

Download the latest binary for your platform from [GitHub Releases](../../releases):

```bash
# macOS (Apple Silicon)
curl -L https://github.com/mattjmcnaughton/pug-claw/releases/latest/download/pug-claw-macos-aarch64.tar.gz | tar xz
chmod +x pug-claw-macos-aarch64
mv pug-claw-macos-aarch64 /usr/local/bin/pug-claw

# Linux (x86_64)
curl -L https://github.com/mattjmcnaughton/pug-claw/releases/latest/download/pug-claw-linux-x86_64.tar.gz | tar xz
chmod +x pug-claw-linux-x86_64
mv pug-claw-linux-x86_64 /usr/local/bin/pug-claw
```

### From source

Clone the repo and install globally with `bun link`:

```bash
git clone <repo-url>
cd pug-claw
bun install
bun link       # makes `pug-claw` available globally
```

After linking, you can run `pug-claw init`, `pug-claw start`, etc. from anywhere.

## Configuration

### Quick start

Run the interactive setup wizard to create `~/.pug-claw/` with a `config.json`, default agent, and optional `.env` secrets file:

```bash
bun run init
```

You can also set `PUG_CLAW_HOME` to use a different directory:

```bash
PUG_CLAW_HOME=/opt/pug-claw bun run init
```

### Config file

All configuration lives in `~/.pug-claw/config.json` (created by `pug-claw init`):

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
      "driver": "pi",
      "model": "openrouter/openai/gpt-4o"
    }
  },
  "secrets": {
    "provider": "dotenv"
  },
  "discord": {
    "guild_id": "123456789",
    "owner_id": "987654321"
  }
}
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes (Discord mode) | Bot token from the Discord Developer Portal |
| `ANTHROPIC_API_KEY` | No | Anthropic API key for the Claude driver. If not set, falls back to existing Claude Code credentials on the host (i.e. `claude auth login`) |
| `OPENROUTER_API_KEY` | No | API key for OpenRouter-backed models (Pi driver) |
| `LOG_LEVEL` | No | Logging level: `debug`, `info` (default), `warn`, `error`, `fatal` |
| `NODE_ENV` | No | Set to `production` for JSON log output; otherwise uses pretty-printing |
| `PUG_CLAW_HOME` | No | Override the home directory (default: `~/.pug-claw`) |

Secrets can be provided via environment variables directly, or via a `.env` file when `"secrets": {"provider": "dotenv"}` is set in `config.json`.

## Usage

### Discord mode (default)

```bash
bun run start
```

### TUI mode

```bash
bun run tui
```

### Commands

**Discord** (`!` prefix) / **TUI** (`/` prefix):

| Command | Description |
|---------|-------------|
| `new` | Start a fresh conversation |
| `driver [name]` | Show or switch AI driver (resets session) |
| `model [name]` | Show or switch model (resets session) |
| `agent [name]` | Show or switch agent persona (resets session) |
| `skills` | List available skills for the current agent |
| `status` | Show current driver, agent, model, and session state |
| `help` | Show available commands |

## Architecture

```
src/
  main.ts              # CLI entrypoint (Commander: start, tui, init)
  resources.ts         # Config loading, path resolution, secrets providers
  agents.ts            # Agent directory resolution
  logger.ts            # Pino structured logger
  skills.ts            # Agent skill discovery and system prompt injection
  commands/
    init.ts            # Interactive setup wizard (@clack/prompts)
  drivers/
    types.ts           # Driver interface (createSession, query, destroySession)
    claude.ts          # Claude Agent SDK driver
    pi.ts              # Pi Coding Agent driver (OpenRouter, Codex)
  frontends/
    types.ts           # Frontend interface
    discord.ts         # Discord.js frontend with per-channel state
    tui.ts             # Terminal UI frontend (pi-tui)

~/.pug-claw/           # User home directory (created by `pug-claw init`)
  config.json          # Consolidated configuration
  agents/
    default/
      SYSTEM.md        # Default agent system prompt
      skills/          # Agent-specific skills
  skills/              # Global skills (available to all agents)
  data/                # Runtime data
  .env                 # Optional dotenv secrets file
```

### Drivers

- **claude** — Uses `@anthropic-ai/claude-agent-sdk`. Model aliases: `sonnet` (claude-sonnet-4-6), `opus` (claude-opus-4-6).
- **pi** — Uses `@mariozechner/pi-coding-agent`. Supports any model via OpenRouter, OpenAI Codex OAuth, or other providers. Default: `openrouter/minimax/minimax-m2.5`.

### Agents and skills

Agents live in `~/.pug-claw/agents/<name>/` with a `SYSTEM.md` system prompt. Each agent can have a `skills/` directory containing skill definitions (`SKILL.md` with YAML frontmatter). Global skills in `~/.pug-claw/skills/` are available to agents that list them in their `allowed-skills` frontmatter. Agent-specific skills are always available.

Skills are injected natively per driver: the Claude driver uses per-agent plugin directories (symlinks in `~/.pug-claw/plugins/`) so skills appear as native Claude Code skills, while the Pi driver appends a skill catalog to the system prompt.

## Discord Bot Setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications)
2. Under **Bot**, enable the **Message Content** privileged gateway intent
3. Generate a bot token and add it to your `.env`
4. Invite the bot to your server with the **Send Messages** and **Read Message History** permissions

## Status

WIP
