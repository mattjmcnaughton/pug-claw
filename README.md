# pug-claw

A multi-driver AI agent bot with Discord and TUI frontends. Swap between **Claude** (via Agent SDK) and **Pi** (via OpenRouter/Codex) backends on the fly, with per-channel configuration and a pluggable agent/skills system.

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- [Node.js](https://nodejs.org/) >= 20 (required by some dependencies)
- A [Discord bot token](https://discord.com/developers/applications) with the **Message Content** privileged intent enabled
- An [Anthropic API key](https://console.anthropic.com/) (for the Claude driver)
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

If you're forking or developing locally:

```bash
bun install
```

If you would like an npm package, please [file an issue](https://github.com/mattjmcnaughton/pug-claw/issues/new) and let me know :)

## Configuration

### Environment variables

Copy the example and fill in your secrets:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes (Discord mode) | Bot token from the Discord Developer Portal |
| `OPENROUTER_API_KEY` | No | API key for OpenRouter-backed models (Pi driver) |
| `LOG_LEVEL` | No | Logging level: `debug`, `info` (default), `warn`, `error`, `fatal` |
| `NODE_ENV` | No | Set to `production` for JSON log output; otherwise uses pretty-printing |

### Bot configuration

Edit `agents.json` to set defaults and per-channel overrides:

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
  }
}
```

## Usage

### Discord mode (default)

```bash
bun start
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
pug-claw/
  main.ts              # Entrypoint — wires drivers, config, and frontend
  config.ts            # Zod-validated config loading from agents.json
  logger.ts            # Pino structured logger
  skills.ts            # Agent skill discovery and system prompt injection
  agents.json          # Bot configuration
  drivers/
    types.ts           # Driver interface (createSession, query, destroySession)
    claude.ts          # Claude Agent SDK driver
    pi.ts              # Pi Coding Agent driver (OpenRouter, Codex)
  frontends/
    types.ts           # Frontend interface
    discord.ts         # Discord.js frontend with per-channel state
    tui.ts             # Terminal UI frontend (pi-tui)
  agents/
    default/
      SYSTEM.md        # Default agent system prompt
      skills/          # Optional skill directories
```

### Drivers

- **claude** — Uses `@anthropic-ai/claude-agent-sdk`. Model aliases: `sonnet` (claude-sonnet-4-6), `opus` (claude-opus-4-6).
- **pi** — Uses `@mariozechner/pi-coding-agent`. Supports any model via OpenRouter, OpenAI Codex OAuth, or other providers. Default: `openrouter/minimax/minimax-m2.5`.

### Agents and skills

Agents live in `agents/<name>/` with a `SYSTEM.md` system prompt. Each agent can optionally have a `skills/` directory containing skill definitions (`SKILL.md` with YAML frontmatter). Skills are automatically discovered and injected into the system prompt.

## Discord Bot Setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications)
2. Under **Bot**, enable the **Message Content** privileged gateway intent
3. Generate a bot token and add it to your `.env`
4. Invite the bot to your server with the **Send Messages** and **Read Message History** permissions

## Status

WIP
