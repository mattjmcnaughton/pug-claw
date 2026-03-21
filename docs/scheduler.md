# Scheduler

pug-claw includes a cron-based scheduler for recurring agent jobs.

## Scope

Scheduler v1 is intentionally narrow:

- schedules are defined in `config.json`
- schedules run only in Discord mode (`pug-claw start`)
- each run uses a fresh agent session
- success output can be posted to a Discord channel
- run metadata is stored in SQLite
- detailed run events are written to a scheduler JSONL audit log

The scheduler does **not** run in TUI mode.

## Config example

```json
{
  "scheduler": {
    "timezone": "America/New_York"
  },
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

## Schedule fields

Required:

- `cron`
- `agent`
- `prompt`

Optional:

- `description`
- `enabled`
- `driver`
- `model`
- `output`

Notes:

- `scheduler.timezone` is required when `schedules` is present
- schedule names must match `^[a-z0-9][a-z0-9_-]*$`
- schedules are enabled by default
- `enabled: false` disables cron execution, but manual runs still work
- cron expressions use standard 5-field syntax: minute, hour, day-of-month, month, day-of-week
- schedules do not inherit Discord channel config

## Commands

Discord owner-only commands:

- `!schedule list`
- `!schedule run <name>`

`!schedule list` shows:

- enabled/disabled state
- cron expression and timezone
- agent
- output target summary
- next run
- whether the schedule is currently running
- last run status and timestamp

`!schedule run <name>`:

- works even when the schedule is disabled
- uses the same execution pipeline as a cron-triggered run
- returns an immediate acknowledgement with a `run_id`
- refuses to start if the scheduler is inactive on that instance
- refuses to start if the schedule is already running

## Execution semantics

- every scheduled run creates a fresh driver session
- missed runs are skipped if pug-claw was down
- overlapping runs are skipped
- successful Discord delivery posts only the final response text
- failure delivery posts a short message with the `run_id`

## Persistence

Runtime DB:

- `${PUG_CLAW_DATA_DIR:-<home>/data}/pug-claw.sqlite`

Scheduler lock:

- `${PUG_CLAW_DATA_DIR:-<home>/data}/locks/scheduler.lock/owner.json`

Scheduler audit logs:

- `${PUG_CLAW_LOGS_DIR:-<home>/logs}/schedules/YYYY-MM-DD.jsonl`

System logs continue to live under:

- `${PUG_CLAW_LOGS_DIR:-<home>/logs}/system/`

## Operational notes

- only one scheduler instance is active per host at a time
- if the lock is already held, the bot still runs but scheduler execution is disabled on that instance
- on startup, previously running schedule rows are marked `interrupted`
- `!system reload` reloads schedule definitions live
