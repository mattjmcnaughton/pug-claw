# Cron / Scheduler v1 — PRD + Technical Design

## Status

Draft design for the first cron-based scheduler implementation in `pug-claw`.

## Terminology note

This document is a hybrid of:

- a **PRD** (product requirements doc): what the feature should do
- a **technical design doc**: how we should implement it

It is not literally test-driven development, but it does include a testing plan.

---

## 1. Summary

Add a cron-driven scheduler to `pug-claw` that runs **agent-based jobs** on a schedule.

Each scheduled job:

- is defined in `config.json`
- uses **true cron syntax**
- runs in a **fresh agent session**
- takes a **prompt**
- may post its final output to **Discord**
- may also take side effects through the agent's normal tool usage
- records durable run metadata in a **SQLite runtime DB**
- records rich run details in a **scheduler JSONL audit log**

This is a **platform-aware** design with a **narrow first implementation**:

- one job type: scheduled agent prompt
- one explicit output target: Discord channel
- one active runtime: `pug-claw start`
- simple safety semantics: skip missed runs, skip overlaps

---

## 2. Product goals

### Goals

- Let users define recurring agent automations in `config.json`
- Let scheduled jobs post successful output to Discord
- Let scheduled jobs take actions via existing agent capabilities
- Provide basic operator visibility:
  - list schedules
  - manually trigger a schedule
  - see last status / last run
- Persist run metadata across restarts
- Make detailed debugging possible via `run_id` + audit logs
- Prevent duplicate schedulers on a single host

### Non-goals for v1

- No scheduler in `pug-claw tui`
- No agent-spawned background jobs
- No workflow chaining
- No pause/resume
- No schedule history command
- No scheduler-owned file output target
- No per-schedule timezone override
- No catch-up/replay of missed runs
- No scheduler-enforced timeout
- No full storage provider abstraction / Prisma / PostgreSQL

---

## 3. User-facing behavior

## 3.1 Schedule definition

Schedules live in `config.json`.

### Proposed config shape

```json
{
  "scheduler": {
    "timezone": "America/New_York"
  },
  "schedules": {
    "daily-summary": {
      "description": "Post a morning summary to Discord",
      "enabled": true,
      "cron": "0 9 * * *",
      "agent": "writer",
      "driver": "pi",
      "model": "openrouter/openai/gpt-4o",
      "prompt": "Summarize yesterday's important activity and produce a concise morning update.",
      "output": {
        "type": "discord_channel",
        "channel_id": "123456789"
      }
    },
    "nightly-memory-pass": {
      "description": "Refresh durable memory artifacts",
      "enabled": false,
      "cron": "0 2 * * *",
      "agent": "archivist",
      "prompt": "Review recent conversation artifacts and update durable memory as needed."
    }
  }
}
```

## 3.2 Schedule semantics

- `scheduler.timezone` is **required**
- `pug-claw init` should populate it from the server timezone
- schedules are keyed by name
- schedules are **enabled by default**
- `enabled: false` disables automatic cron execution, but **manual run still works**
- prompts are stored inline in `config.json`
- schedule names should be command-friendly slug keys matching:
  - `^[a-z0-9][a-z0-9_-]*$`

## 3.3 Execution semantics

- each run uses a **fresh session**
- no session continuity across runs
- continuity should come from memory/artifacts, not retained chat state
- missed runs are **skipped**
- overlapping cron runs are **skipped**
- manual run while already running is blocked with a clear message
- disabled schedules can still be manually run by the owner
- no scheduler timeout in v1
- schedules should use standard **5-field cron expressions**
  - minute hour day-of-month month day-of-week

## 3.4 Output semantics

### Success

- if `output.type = "discord_channel"`, post **only the final agent response text**

### Failure

- post a short failure message to the configured Discord channel
- include the **`run_id`**
- do not dump full details in-channel

### Logging

- logging always happens automatically
- there is no configurable `"log"` output target; logging is built-in

---

## 4. Commands

## 4.1 Discord-only commands

Owner-only:

- `!schedules`
- `!schedule run <name>`

These commands are **not** exposed in TUI in v1.

## 4.2 `!schedules` output

Show **all schedules**, including disabled ones, with:

- name
- enabled/disabled
- cron + timezone
- agent
- output summary
- next run time
- currently running
- last run status
- last run timestamp

If the current bot process failed to acquire the scheduler lock, include a top-level note like:

- `Scheduler is disabled on this instance (lock not acquired).`

## 4.3 `!schedule run <name>`

- owner-only
- works even if schedule is disabled
- uses the same execution pipeline as cron
- if already running, return a clear message:
  - `Schedule "daily-summary" is already running.`
- if this bot process is not the active scheduler instance, return a clear message:
  - `Scheduler is not active on this instance.`

---

## 5. Runtime scope

## 5.1 Where scheduler runs

Scheduler runs **only** in:

- `pug-claw start`

Scheduler does **not** run in:

- `pug-claw tui`

## 5.2 Identity model

Scheduled runs are conceptually initiated by a **synthetic system actor**.

For v1, this mainly affects design and logging, not an explicit `UserContext` implementation.

## 5.3 Duplicate scheduler protection

Use a **single-host scheduler lock**.

Behavior:

- on startup, the Discord process attempts to acquire the scheduler lock
- if lock acquired:
  - scheduler starts
- if lock not acquired:
  - bot still runs
  - scheduler stays disabled
  - commands remain read-only / non-executing as described above
  - log a warning

---

## 6. Data persistence

## 6.1 SQLite runtime DB

Add a lightweight SQLite DB, named as a **general runtime DB**, even though only scheduler tables exist initially.

Suggested path:

- `data/pug-claw.sqlite`

### SQLite choice

Use Bun's built-in SQLite support:

- `bun:sqlite`

Reasons:

- no extra dependency
- good fit for a Bun-native project
- enough for a narrow runtime store

### DB initialization approach

Use startup SQL with `CREATE TABLE IF NOT EXISTS`, not a migration framework.

Suggested startup pragmas:

- `PRAGMA journal_mode = WAL;`
- `PRAGMA busy_timeout = 5000;`
- `PRAGMA foreign_keys = ON;`

We should not introduce Prisma or a storage abstraction in v1.

## 6.2 What goes in DB

Store **run metadata only**, not full final output text.

### Proposed `schedule_runs` table

Fields roughly:

- `run_id` (string primary key)
- `schedule_name` (string)
- `trigger_source` (`cron` | `manual`)
- `status` (`running` | `succeeded` | `failed` | `skipped` | `interrupted`)
- `agent` (string)
- `driver` (string, nullable)
- `model` (string, nullable)
- `cron_expression` (string)
- `timezone` (string)
- `output_type` (nullable)
- `output_target` (nullable; e.g. channel id)
- `execution_status` (`running` | `succeeded` | `failed` | `interrupted`)
- `delivery_status` (`pending` | `succeeded` | `failed` | `not_applicable`)
- `started_at` (ISO string)
- `finished_at` (ISO string, nullable)
- `error_message` (nullable, sanitized)

Suggested indexes:

- `(schedule_name, started_at DESC)`
- `(status, started_at DESC)`

### State model

Do **not** add a separate `schedule_state` table in v1.

Use:

- config for schedule definitions
- latest `schedule_runs` row per schedule for last status / last run
- in-memory runtime state for currently running jobs

## 6.3 Restart behavior

On startup:

- any run still marked `running`
- should be updated to `interrupted`

---

## 7. Audit logging

## 7.1 Dedicated scheduler audit log

Add a dedicated JSONL scheduler audit log.

Suggested path pattern:

- `data/logs/schedules/YYYY-MM-DD.jsonl`

### Rotation / retention

- rotate daily by filename
- no automatic retention/deletion policy in v1
- manual cleanup is acceptable for now

## 7.2 Why separate from DB

- DB stays small and operational
- logs carry rich detail
- final response text lives in logs, not SQLite
- logs are searchable via `run_id`

## 7.3 Audit log event schema

Each JSONL line should include at least:

- `ts` — ISO timestamp
- `event` — event name
- `run_id`
- `schedule_name`
- `trigger_source`
- `agent`
- `driver`
- `model`
- `cron_expression`
- `timezone`
- `output` — object or `null`
- `status` — when applicable
- `message` — human-readable summary when useful
- `error` — sanitized string when applicable

For output events, include:

- `response_text`

For delivery events, include:

- `delivery_status`
- `channel_id`

## 7.4 Suggested event types

- `schedule_run_started`
- `schedule_run_skipped_overlap`
- `schedule_run_completed`
- `schedule_run_failed`
- `schedule_run_output`
- `schedule_run_delivery_started`
- `schedule_run_delivery_succeeded`
- `schedule_run_delivery_failed`
- `scheduler_lock_acquired`
- `scheduler_lock_not_acquired`
- `scheduler_lock_reclaimed_stale`

These are scheduler-specific structured logs and should be distinct from normal interactive message/session logs.

---

## 8. Success / failure model

There are two layers:

### Execution status

Did the agent run complete?

### Delivery status

Did configured Discord delivery succeed?

### Overall run result

If Discord delivery is configured and delivery fails:

- execution may be successful
- but **overall run is failed**

This is the operator-facing status shown in `!schedules`.

---

## 9. Technical decisions finalized

## 9.1 Cron library

Use **Croner** as the cron expression library.

Reasons:

- lightweight dependency
- supports real cron syntax
- supports timezone-aware scheduling
- provides next-run calculation without forcing us into its full runtime model

We still own the scheduler runtime loop; Croner is used for parsing and next-run computation.

## 9.2 Scheduler polling model

Use an internal polling loop, not one timer per schedule.

Suggested initial behavior:

- poll every **15 seconds**
- evaluate whether any enabled schedule is due
- fire at most one run per schedule occurrence

This keeps the runtime simple while still giving acceptable latency for minute-granularity cron jobs.

## 9.3 SQLite client

Use:

- `bun:sqlite`

Do not add an external ORM or SQL builder in v1.

## 9.4 Lock mechanism

Use a PID-based **lock directory**, not a plain lock file.

Suggested path:

- `data/locks/scheduler.lock/`

Suggested contents inside the directory:

- `owner.json`

`owner.json` should include:

- `pid`
- `started_at`
- `hostname`
- optionally `version`

### Acquisition strategy

- acquire lock by atomically creating the lock directory
- if creation fails because it already exists:
  - read `owner.json`
  - check whether the PID is still alive on the current host
  - if PID is dead or metadata is unreadable/stale, reclaim the lock
  - otherwise, do not start the scheduler

### Release strategy

- on clean shutdown, remove the lock directory
- on unclean shutdown, stale lock is reclaimed at next startup

## 9.5 `run_id` format

Use a prefixed UUID:

- `sched_<uuid>`

Example:

- `sched_550e8400-e29b-41d4-a716-446655440000`

Reasons:

- easy to search in logs and DB
- clearly distinguishable from other future IDs

## 9.6 Audit log schema

Use JSONL with one event per line and a stable `run_id` connecting:

- DB metadata
- audit log events
- Discord failure messages

Do not store log offsets or file byte positions in the DB in v1.

## 9.7 `!schedules` formatting

Use a compact Markdown/plain-text hybrid optimized for Discord.

Suggested shape:

```text
**Schedules**
- `daily-summary` — enabled, idle
  cron: `0 9 * * *` (`America/New_York`)
  agent: `writer`
  output: <#123456789>
  next: `2026-03-22 09:00 EDT`
  last: `succeeded` at `2026-03-21 09:00 EDT`
- `nightly-memory-pass` — disabled, idle
  cron: `0 2 * * *` (`America/New_York`)
  agent: `archivist`
  output: none
  next: `disabled`
  last: `never`
```

Requirements:

- render Discord channels as `<#channel_id>`
- chunk output to respect Discord message limits
- if scheduler inactive on this instance, prepend a status line

## 9.8 TUI exposure

Do not expose scheduler commands in TUI in v1.

TUI is intentionally out of scope for scheduler control and execution.

---

## 10. Technical architecture

## 10.1 New runtime pieces

### `src/scheduler/types.ts`

Core types:

- `ResolvedSchedule`
- `ScheduleOutput`
- `ScheduleRunRecord`
- `ScheduleRunStatus`
- `ScheduleTriggerSource`

### `src/scheduler/config.ts`

Normalize validated schedule config into runtime types.

### `src/scheduler/runtime.ts`

Main scheduler loop:

- load schedules
- compute due schedules from cron + timezone
- tick periodically
- enforce overlap rules
- expose:
  - `listSchedules()`
  - `runSchedule(name, triggerSource)`

### `src/scheduler/runner.ts`

Executes a single run:

- generate `run_id`
- persist DB row as `running`
- create fresh driver session
- run prompt
- destroy session
- update DB row
- emit audit log
- deliver to Discord if configured

### `src/scheduler/store.ts`

SQLite wrapper for:

- DB init
- insert/update run metadata
- fetch latest run per schedule
- mark stale runs interrupted

### `src/scheduler/audit-log.ts`

Append JSONL audit events.

### `src/scheduler/lock.ts`

Single-host lock acquisition and release.

### `src/scheduler/output.ts`

Output sink interfaces.

### `src/scheduler/discord-output.ts`

Discord delivery adapter.

## 10.2 Discord integration

Because `DiscordFrontend` owns the Discord client, scheduler creation should live in or be initialized by `DiscordFrontend`.

Introduce a small abstraction like:

```ts
export interface SchedulerOutputSink {
  sendDiscordMessage(channelId: string, text: string): Promise<void>;
}
```

Then:

- `DiscordFrontend` creates the Discord client
- scheduler runtime receives a sink implementation backed by that client

This avoids making the scheduler depend directly on `DiscordFrontend` internals while still letting the Discord frontend own the client lifecycle.

## 10.3 Agent execution path

Do **not** route scheduled runs through `ChannelHandler`.

Why:

- `ChannelHandler` is session/channel-oriented
- schedules should use fresh sessions every time
- schedule execution is not really a channel conversation

Instead, scheduled execution should:

1. resolve schedule config
2. resolve agent
3. resolve driver/model defaults
4. create a fresh driver session directly
5. query once with the prompt
6. destroy session

This may share helper logic with `ChannelHandler` later, but v1 should keep them separate.

---

## 11. Config resolution rules

For scheduled runs:

### Required

- `agent`
- `cron`
- `prompt`

### Optional

- `description`
- `enabled`
- `driver`
- `model`
- `output`

### Resolution

- `agent`: explicit only
- `driver`: schedule override or normal global default resolution
- `model`: schedule override or normal driver / agent default resolution
- tool access comes from agent/driver setup, not schedule config
- schedules should **not** inherit from Discord channel config

---

## 12. Startup and shutdown behavior

## 12.1 Startup

In `pug-claw start`:

1. load config
2. initialize Discord client
3. initialize scheduler store
4. mark stale `running` runs as `interrupted`
5. attempt to acquire scheduler lock
6. if lock acquired:
   - create scheduler runtime
   - start polling loop
7. if lock not acquired:
   - keep bot running without active scheduler

## 12.2 Shutdown

On clean shutdown:

- stop scheduler polling loop
- allow in-flight run cleanup best-effort
- release scheduler lock

If shutdown is unclean, the next startup reclaims stale lock and marks stale running jobs interrupted.

---

## 13. Testing strategy

## 13.1 Unit tests

### Cron evaluation

- due / not-due logic
- next-run computation
- timezone handling
- 5-field cron validation

### Overlap logic

- running schedule skips cron overlap
- manual run while running returns blocked message

### Config validation

- missing `scheduler.timezone` fails
- invalid cron fails
- invalid output type fails
- disabled schedules still parse
- invalid schedule name fails

### Store behavior

- insert/update runs
- latest run lookup
- mark stale running -> interrupted

### Lock behavior

- acquires when absent
- rejects second scheduler
- stale lock reclaimed

## 13.2 Integration tests

### Scheduler execution

- manual run creates DB row + audit log entry
- successful run posts to mocked Discord sink
- failed delivery marks overall failure
- failed run posts failure notice with `run_id`

### Startup behavior

- scheduler only starts in Discord mode
- old running runs become interrupted
- inactive scheduler instance refuses manual execution

## 13.3 Test helpers

To keep tests deterministic:

- inject a clock into scheduler runtime
- use temporary SQLite DB files in temporary directories
- use a fake Discord sink in tests
- use mock drivers / fake driver implementations for scheduler runner tests

---

## 14. Suggested implementation order

### PR 1

Config + types

- schema updates in `src/resources.ts`
- constants for scheduler paths / files
- `init` updates for `scheduler.timezone`
- `check-config` updates / coverage

### PR 2

SQLite store + audit log + lock

- DB init
- schedule run persistence
- stale-run interruption
- JSONL audit logging
- scheduler lock acquisition/release

### PR 3

Scheduler runtime + runner

- cron polling loop
- overlap rules
- fresh-session execution
- manual trigger API

### PR 4

Discord integration

- output sink
- `!schedules`
- `!schedule run <name>`
- failure posting with `run_id`

### PR 5

Polish + tests + docs

- startup/shutdown cleanup
- message chunking / formatting cleanup
- integration tests
- user-facing docs updates

---

## 15. Final one-line product statement

`pug-claw` cron v1 is a Discord-hosted, config-defined scheduler that runs fresh agent sessions on cron expressions, posts successful outputs to Discord, records durable run metadata in SQLite, and writes rich per-run audit logs keyed by `run_id`.
