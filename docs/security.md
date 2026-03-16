# Security

This document outlines pug-claw's security model, where secrets are stored, and best practices for operating the bot safely.

## Threat model

pug-claw sits between untrusted user input (Discord messages) and powerful AI backends that can execute code and read files. The primary risks are:

- **Secret exposure** — API keys or tokens leaked via logs, git, or bot responses
- **Prompt injection** — Malicious user messages that manipulate the AI's behavior
- **Unauthorized access** — The bot responding in channels or to users it shouldn't
- **Host compromise** — Both AI backends have access to the host filesystem and can execute commands

## Secrets management

### Where secrets live

| Secret | Location | Format |
|--------|----------|--------|
| `DISCORD_BOT_TOKEN` | Environment or `~/.pug-claw/.env` | Plaintext |
| `ANTHROPIC_API_KEY` | Environment or `~/.pug-claw/.env` | Plaintext |
| `OPENROUTER_API_KEY` | Environment or `~/.pug-claw/.env` | Plaintext |
| OpenAI Codex OAuth | `~/.pi/agent/auth.json` | JSON (managed by pi-ai CLI) |

Secrets can be loaded from environment variables (default) or from a `.env` file when `config.json` has `"secrets": {"provider": "dotenv"}`. With dotenv, environment variables always take precedence over file values.

### Protection measures

- **`.env` is gitignored** — The `.gitignore` includes `.env` and `auth.json` to prevent accidental commits
- **No secrets in code** — All secrets are loaded via the `SecretsProvider` abstraction at runtime
- **No secrets in logs** — Pino's structured logging only outputs fields explicitly passed; secrets are never logged

### Best practices

- Use a secrets manager (e.g., systemd `EnvironmentFile`, AWS SSM, 1Password CLI) in production instead of a plaintext `.env` file
- Rotate tokens and API keys periodically
- If a secret is compromised, rotate it immediately:
  - Discord token: Reset in the [Developer Portal](https://discord.com/developers/applications) Bot tab
  - Anthropic key: Regenerate in the [Anthropic Console](https://console.anthropic.com/)
  - OpenRouter key: Regenerate at [OpenRouter](https://openrouter.ai/keys)

## AI backend security

### Tool access

Both drivers grant filesystem and shell access by default. Any user who can message the bot can indirectly trigger these capabilities.

**Claude driver** grants these tools by default: `Read`, `Glob`, `Grep`, `Bash`. This means the AI can:

- Read any file accessible to the process user
- Execute arbitrary shell commands as the process user
- Search the filesystem

The Claude driver runs in `bypassPermissions` mode — all tool calls (reads, writes, shell commands) are auto-approved without interactive prompts. This is required for headless operation (e.g., Discord frontend) where no human is present to approve. You can restrict tools per-channel via `config.json`:

```json
{
  "channels": {
    "123456789": {
      "tools": ["Read", "Glob", "Grep"]
    }
  }
}
```

**Pi driver** uses the `codingTools` toolset from `@mariozechner/pi-coding-agent`, which similarly provides:

- File read and write access
- Shell command execution
- Filesystem search

The Pi driver does not currently support per-channel tool restriction.

**Mitigations (both drivers):**

- Run pug-claw as a dedicated, low-privilege user (see [deployment.md](./deployment.md))
- Use systemd hardening directives (`ProtectSystem=strict`, `ProtectHome=read-only`, `NoNewPrivileges=true`) to limit what the process user can access
- Restrict the bot to specific Discord channels using Discord's channel permissions
- For the Claude driver, use per-channel `tools` config to remove `Bash` in channels where shell access isn't needed
- Both drivers currently run with full permissions (`bypassPermissions` on Claude, unrestricted on Pi). OS-level isolation (dedicated user, systemd sandboxing) is the primary security boundary. Fine-grained per-agent permissions are on the [roadmap](./product/roadmap.md).

### Prompt injection

Users can attempt to manipulate the AI via crafted messages. The system prompt is set by the agent's `SYSTEM.md`, but user messages could try to override it.

**Mitigations:**

- Keep system prompts clear and directive
- Monitor bot responses for unexpected behavior
- Use the `!new` command to reset sessions if the bot starts behaving oddly

## Discord permissions

Follow the principle of least privilege:

- Only grant the bot **Send Messages**, **Read Message History**, and **View Channels** permissions
- Do not grant **Administrator** or other elevated permissions
- Use channel-specific permissions in Discord to restrict where the bot can operate

## Network exposure

pug-claw makes outbound connections only:

- Discord gateway (WebSocket)
- Anthropic API (HTTPS)
- OpenRouter API (HTTPS)

It does not listen on any ports or expose any HTTP endpoints.

## Logging and monitoring

- Structured JSON logs (in production) make it easy to detect anomalies
- Key events to monitor:
  - `session_create_error` — May indicate auth issues or API problems
  - `query_error` / `pi_query_error` — Backend failures
  - `message_received` — Includes author ID and content length (not content) for audit trails
- Message content is intentionally **not** logged to avoid storing sensitive user data
