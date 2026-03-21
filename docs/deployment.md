# Deployment

This guide covers running pug-claw on a host machine with systemd for process management.

## Prerequisites

Install the following on your host:

- **Bun** >= 1.0: `curl -fsSL https://bun.sh/install | bash`
- **Node.js** >= 20: Required by some transitive dependencies
- **Git**: To clone and update the repository

## Setup

```bash
# Clone the repo
cd /opt/pug-claw  # or your preferred location
git clone <repo-url> .

# Install dependencies
bun install

# Initialize configuration
bun run init
# Or set a custom home: PUG_CLAW_HOME=/etc/pug-claw bun run init
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `ANTHROPIC_API_KEY` | Yes (Claude) | Anthropic API key |
| `OPENROUTER_API_KEY` | No | OpenRouter API key (Pi driver) |
| `LOG_LEVEL` | No | `debug`, `info` (default), `warn`, `error`, `fatal` |
| `NODE_ENV` | No | Set to `production` for JSON logs |
| `PUG_CLAW_LOGS_DIR` | No | Override the logs directory (default: `<home>/logs`) |

## Running directly

```bash
# Discord mode
bun run start

# TUI mode (for testing)
bun run tui
```

Scheduler note:

- the cron scheduler runs only in Discord mode
- `bun run tui` never starts the scheduler

## systemd service

Create a systemd unit file to run pug-claw as a managed service.

### Unit file

Create `/etc/systemd/system/pug-claw.service`:

```ini
[Unit]
Description=pug-claw Discord bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pug-claw
Group=pug-claw
WorkingDirectory=/opt/pug-claw
ExecStart=/usr/local/bin/bun src/main.ts start
Restart=on-failure
RestartSec=5

EnvironmentFile=/opt/pug-claw/.env
Environment=PUG_CLAW_HOME=/var/lib/pug-claw
Environment=PUG_CLAW_LOGS_DIR=/var/log/pug-claw

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/opt/pug-claw /var/lib/pug-claw /var/log/pug-claw
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

> Adjust the `ExecStart` path to match your Bun installation. Find it with `which bun`.

### Create a service user

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin pug-claw
sudo mkdir -p /var/lib/pug-claw /var/log/pug-claw
sudo chown -R pug-claw:pug-claw /opt/pug-claw /var/lib/pug-claw /var/log/pug-claw
```

### Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable pug-claw
sudo systemctl start pug-claw
```

### Managing the service

```bash
# Check status
sudo systemctl status pug-claw

# View logs
sudo journalctl -u pug-claw -f

# Restart after config changes
sudo systemctl restart pug-claw

# Stop
sudo systemctl stop pug-claw
```

## Logging

In production, set `NODE_ENV=production` in your `.env` file. This outputs structured JSON logs (one JSON object per line), which integrates well with `journalctl` and log aggregation tools.

For development or debugging, omit `NODE_ENV` to get colorized pretty-printed output via `pino-pretty`.

Log locations:

- system logs: `${PUG_CLAW_LOGS_DIR:-<home>/logs}/system/`
- scheduler audit logs: `${PUG_CLAW_LOGS_DIR:-<home>/logs}/schedules/`

Scheduler runtime state lives under `${PUG_CLAW_DATA_DIR:-<home>/data}` and includes:

- `pug-claw.sqlite`
- `locks/scheduler.lock/owner.json`

## Scheduler operations

The scheduler uses a single-host lock. If multiple Discord bot processes run on the same host and share the same `data/` directory, only one will execute schedules. Other instances still run the bot, but `!schedule run <name>` will be refused on those inactive instances.

Use `!schedules` in Discord to verify whether the current bot process is the active scheduler.

## Updating

```bash
cd /opt/pug-claw
git pull
bun install
sudo systemctl restart pug-claw
```
