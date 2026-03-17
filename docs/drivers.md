# Drivers

Drivers are the AI backends that power pug-claw. Each driver implements the same interface (create session, query, destroy session) but connects to a different provider.

## Claude driver

Uses the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) to run Claude models with tool use.

### Authentication

Set the `ANTHROPIC_API_KEY` environment variable (used automatically by the SDK).

### Model aliases

| Alias | Model ID |
|-------|----------|
| `sonnet` | `claude-sonnet-4-6` |
| `opus` | `claude-opus-4-6` |

You can also pass any valid Claude model ID directly via `!model <id>`.

### Default tools

Claude sessions are created with these tools enabled: `Read`, `Glob`, `Grep`, `Bash`. Per-channel tool overrides can be configured in `config.json`.

### Working directory

The Claude agent session's working directory defaults to `~/.pug-claw` (the pug-claw home directory). This controls what files the agent considers "in scope" — it will self-restrict file access to paths within or near the `cwd`.

To override, set `drivers.claude.cwd` in `config.json`:

```json
{
  "drivers": {
    "claude": {
      "cwd": "/home/user/projects"
    }
  }
}
```

To give the agent access to additional directories without changing the `cwd`, create symlinks inside the working directory.

### Session behavior

- Each session starts with an initialization query to establish a session ID
- Subsequent queries resume the same session, preserving conversation context
- `!new` destroys the session and starts fresh

## Pi driver

Uses [@mariozechner/pi-coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) to run models via OpenRouter, OpenAI Codex, and other providers.

### Authentication

**OpenRouter models:** Set the `OPENROUTER_API_KEY` environment variable.

**OpenAI Codex models:** Requires OAuth authentication:

```bash
# Option 1: Use the pi CLI
pi login
# Select openai-codex when prompted

# Option 2: Direct login
cd ~/.pi/agent && bunx @mariozechner/pi-ai login openai-codex
```

Codex credentials are stored in `~/.pi/agent/auth.json`.

### Model format

Pi models use a `provider/model-id` format:

```
openrouter/minimax/minimax-m2.5
openrouter/openai/gpt-4o
openai-codex/gpt-5.4
```

### Model aliases

| Alias | Model ID |
|-------|----------|
| `minimax` | `openrouter/minimax/minimax-m2.5` |
| `gpt` | `openai-codex/gpt-5.4` |

### Session behavior

- Sessions run in-memory with compaction and retry enabled
- The system prompt is injected via a resource loader override
- Full coding tools are available by default

## Switching drivers

Use `!driver <name>` (Discord) or `/driver <name>` (TUI) to switch. Switching drivers resets the current session. Use `!driver` with no argument to see the current driver and available options.

## Per-channel driver configuration

In `config.json`, you can set a default driver per channel:

```json
{
  "channels": {
    "123456789": {
      "driver": "pi",
      "model": "openrouter/openai/gpt-4o"
    }
  }
}
```

This is useful for dedicating specific Discord channels to specific backends.
