# Product Roadmap

---

## Core

### Resource Discovery

Configurable paths for where pug-claw finds agents, skills, config, secrets, memory, data, and brain sources.

- [x] `~/.pug-claw/config.json` as consolidated config file (replaces `agents.json`)
- [x] Override precedence: CLI flag > env var > config file > default
- [x] `pug-claw init` interactive setup wizard (Commander + @clack/prompts)
- [x] Global + agent-specific skills with merge (agent wins on name collision)
- [x] Secrets provider abstraction (`env` | `dotenv`)
- [x] Discord identity config (`guild_id`, `owner_id`) with guild filtering
- [x] Hard-fail with `pug-claw init` guidance when config missing
- [ ] Multi-path merging for agents and skills (layer project + personal + system)
- [ ] Additional secrets providers (`1password` | `sops`)

### User Identity

Agents have zero awareness of who they're talking to. Needed by memory, permissions, brain, and audit.

- [ ] `UserContext` type (`id`, `displayName`, `platform`, `roles`)
- [ ] Discord frontend: extract from `message.author` + guild roles
- [ ] TUI frontend: derive from OS user or config
- [ ] Inject user context into system prompt per turn
- [ ] Pass user context through `DriverOptions`

### Config Refinements

- [x] Zod-validated `config.json` with clear error messages on invalid data
- [x] Hard-fail with actionable "Run `pug-claw init`" message when config missing
- [x] Refine and extend `config.json` schema for new features — *partial: scheduler config and schedules added; broader future config areas still remain*
- [x] Config validation CLI command (`pug-claw check-config`)
- [ ] Toggle visibility of agent thinking (show/hide reasoning traces per agent or frontend)
- [ ] Toggle visibility of agent tool calls (show/hide tool invocations and results per agent or frontend) — *partial: Discord shows tool events via `onEvent` callback; TUI does not; no per-agent/frontend config toggle*

### Sessions

Refine the "session" primitive — a context window with an agent, regardless of frontend (Discord, TUI, future frontends).

- [ ] Session lifecycle: create, resume, expire, close — *partial: create and close implemented; resume and expire not yet*
- [ ] Session identity: tie sessions to a user + agent + channel
- [ ] Thread support: threaded conversations within a frontend (Discord threads, etc.)
- [ ] Session persistence: survive process restarts (ties into Safe Restart snapshot/restore)
- [ ] Session API: unified interface that frontends implement

---

## Drivers & Frontends

### Streaming Responses

Stream driver output to frontends incrementally instead of waiting for the full response.

- [ ] Streaming interface in `Driver` (yield chunks as they arrive from the model) — *partial: `onEvent` callback emits tool-use events incrementally; text response is still buffered*
- [ ] Frontend support for rendering incremental updates (Discord: edit message in place; TUI: live output) — *partial: Discord sends tool-use notifications via `onEvent`; TUI does not use the callback*
- [ ] Graceful fallback for frontends that don't support streaming (buffer and send on completion)

### Interactive Confirmation

Allow agents to pause execution and ask the user for confirmation before taking destructive or high-stakes actions (e.g., "Are you sure you want to delete X?").

- [ ] Confirmation primitive in the session/frontend interface (agent requests yes/no, frontend collects response)
- [ ] Timeout and default behavior when the user doesn't respond
- [ ] Driver integration: surface confirmation requests from underlying agent SDKs (Claude tool approval, etc.) — *partial: Claude driver detects elicitation messages but only logs them; not surfaced to user*
- [ ] Configurable confirmation policies per agent (always confirm, never confirm, confirm destructive only)

### Additional Frontends

- [ ] Slack frontend
- [ ] Telegram frontend
- [ ] Shared frontend logic extraction (reduce duplication between Discord/TUI/new frontends)

---

## Memory & Knowledge

### Working Memory

Per-agent scratchpad the agent can read/write during a session. Persists across sessions.

- [ ] Working memory storage (markdown or JSONL, one per agent)
- [ ] `SaveMemory` / `ReadMemory` tools for agents
- [ ] `!remember` / `!forget` / `!memory` user commands

### Conversation Log

Append-only JSONL log of all conversations. Source of truth for everything downstream.

- [ ] JSONL conversation logger (one file per agent per day)
- [ ] Log schema: timestamp, agent, user, role, content, metadata
- [ ] Log rotation / retention policy

### Conversation Summaries

Batch job (cron) that processes JSONL logs into usable artifacts. Runs as a skill.

- [ ] `MEMORY.md` per agent — distilled facts, preferences, patterns
- [ ] `days/DAY.md` — daily conversation summaries
- [ ] Summarization skill (agent-driven, invoked by cron job)
- [ ] Incremental processing (track last-processed log offset)
- [ ] System prompt tells agents these files exist and how to access them on-demand

### Second Brain

Agents can search and write to a personal knowledge base.

- [ ] Brain config: source paths, inbox path, index path (`[brain]` in config)
- [ ] `brain-search` tool: full-text search (ripgrep) across configured source paths
- [ ] `brain-save` tool: save notes to inbox with title, tags, frontmatter
- [ ] `brain-list` tool: browse knowledge by path, recency, or tags
- [ ] Obsidian compatibility: respect frontmatter, wikilinks, tags
- [ ] Conversation capture: auto-summarize sessions and save to `conversations/`
- [ ] Indexing: incremental reindex on startup based on mtime
- [ ] File watcher for live reindex during long-running processes
- [ ] `pug-claw reindex` CLI command

### Semantic Embeddings

Optional layer on top of conversation logs and memory. Enables similarity search across all stored content.

- [ ] Embedding generation (local model via Ollama or API)
- [ ] Vector storage in SQLite (sqlite-vec or similar — TBD)
- [ ] Semantic search tool for agents ("find conversations/notes related to X")
- [ ] Incremental embedding on new log entries / memory writes
- [ ] Pluggable vector store backend (sqlite-vec, pgvector, Pinecone, etc.)
- [ ] Vector store configuration in `config.json`

---

## Jobs & Scheduling

### Cron Jobs

Simple timer-based agent actions. Enables conversation capture, brain reindexing, and daily summaries without full workflow infrastructure.

- [x] Schedule config in `config.json`
- [x] Timer runtime (polling loop + cron parsing, runs inside the main Discord process)
- [ ] Each job: agent + prompt + output target (Discord channel, brain, log only) — *partial: Discord channel output + built-in logging implemented*
- [x] `!schedules` command to list active jobs — *TUI command intentionally out of scope for v1*
- [ ] Built-in jobs: brain reindex
- [ ] Memory compaction — "one-day" feature. Was implemented and then intentionally removed (commit `8274794`). Deferred until the core memory write/retrieval/editing flow is stable.

### Agent-Spawned Jobs

Background tasks kicked off by a main agent during a session.

- [ ] Integration with Pi/Claude Agent SDK primitives (sub-agents, tool calls)
- [ ] Job lifecycle: submit, running, completed, failed
- [ ] Job monitoring: status, logs, cancellation
- [ ] `job-management` skill for agents to create/monitor/cancel jobs
- [ ] Notification when jobs complete (back to originating session/channel)

---

## Agent Framework

### Command Framework

Extend the existing `!command` pattern into a general-purpose `!namespace:command` system. Users and skills can register custom commands as lightweight shortcuts for invoking skills or agents with preset prompts/config.

- [ ] `!namespace:command` invocation pattern (e.g., `!brain:search`, `!ops:restart`, `!memory:forget`)
- [ ] Command registration: skills and agents can declare commands they provide
- [ ] Built-in commands ship with pug-claw (extend existing `!help`, `!agent`, etc.)
- [ ] Top-level `!command` sugar for global/common commands (e.g., `!help` as shorthand for `!pug-claw:help`)
- [ ] Command discovery: `!help` lists namespaces, `!help <namespace>` lists commands in that namespace
- [ ] Per-agent command filtering (consistent with existing `allowed-skills` pattern)
- [ ] User-defined commands via config (name, description, skill/agent to invoke, default prompt)

### Agent-to-Agent Delegation

- [ ] `delegate` tool: create temp session with target agent, send prompt, return result
- [ ] Recursion depth limit
- [ ] Context passing controls (full conversation vs. subtask only)

### Message Routing

- [ ] Better routing rules: regex, keywords, user roles
- [ ] Message ignore/filter rules (bots, patterns, specific users)
- [ ] Triage agent as default entry point (optional)

---

## API

Programmatic interface for interacting with pug-claw. Ordered by value.

**Agent Invocation API** — The core primitive. Invoke agents programmatically over HTTP. Unlocks scripting, CI/CD integration, webhooks, mobile/web UIs, Shortcuts/Raycast, and inter-service communication.

- [ ] `POST /api/v1/agent/invoke` — send a prompt to a named agent, get a response
- [ ] Auth (API key or token-based)
- [ ] Async mode: submit a job, poll or receive callback on completion
- [ ] Webhook ingestion: accept events from external services (GitHub, Linear, etc.) and route to agents

**Management API** — CRUD for config, agents, sessions, and jobs. Backend for the Management & Admin UI.

- [ ] Agent endpoints: list, inspect, enable/disable
- [ ] Session endpoints: list active, inspect, close
- [ ] Job endpoints: list, inspect, cancel
- [ ] Config endpoints: view, validate, update

**Event Streaming** — Real-time agent activity for live dashboards and custom UIs.

- [ ] WebSocket or SSE endpoint for agent events (tool use, status changes, completions)
- [ ] Filterable by agent, session, or event type

---

## Automation

### Workflow Chaining

Multi-step pipelines built on top of the Command Framework. Commands are single-action shortcuts; workflows chain multiple commands/agents together declaratively.

- [ ] Workflow definitions (YAML): sequential steps with agent + input/output mapping
- [ ] Trigger types: message, cron, webhook, agent output
- [ ] Variable interpolation between steps

### Sandbox Execution

Run agent workloads (coding agents, long-running tasks) in isolated environments. Platform-level infrastructure that agents and skills can leverage.

- [ ] Sandbox provider interface: abstract over execution backends (Docker, VM, local)
- [ ] Docker sandbox: launch containers with mounted workspaces, resource limits, auto-cleanup
- [ ] VM sandbox: provision and manage lightweight VMs for heavier workloads
- [ ] Agent progress monitoring: status callbacks from sandbox to originating session
- [ ] Workspace lifecycle: create, monitor, timeout, cleanup
- [ ] Network access controls: expose sandbox services via Tailscale or port forwarding
- [ ] Integration with coding agent SDKs (Claude Code, Codex, Pi) as sandbox workloads

### Event-Driven Triggers

- [ ] Webhook receiver (HTTP endpoint for GitHub, etc.)
- [ ] File change watcher triggers
- [ ] Agent output triggers (agent A finishes -> agent B starts)

---

## Operations

### Management & Admin UI

Standalone web server (separate process) for managing pug-claw out-of-band. Critical for recovery when the main process crashes or a bad config/update breaks things.

- [ ] Standalone HTTP server (`pug-claw admin`) — runs independently of the main process
- [ ] Process monitor: show main process status (running, crashed, PID, uptime)
- [ ] Log viewer: stream and search JSONL logs from the browser
- [ ] Config viewer / editor: display and edit config with validation status and diagnostics
- [ ] Start / stop / restart controls for the main pug-claw process
- [ ] Configurable process command (so the admin server knows how to launch pug-claw)
- [ ] Last-known-good config display and one-click rollback
- [ ] Auth: at minimum, bind to localhost only; optionally token-based access
- [ ] Agent management: view, configure, enable/disable agents
- [ ] Session viewer: active sessions, history, replay
- [ ] Job dashboard: running/completed/failed jobs, logs, retry
- [ ] Metrics overview: message counts, token usage, error rates

### Export and Backup

- [x] `pug-claw export` - full backup v1 (config, agents, skills, runtime DB, optional data/code/logs directories)
- [ ] `pug-claw export --memory|--brain|--config|--conversations` - selective export
- [x] `pug-claw import` - restore from backup
- [ ] `pug-claw inspect memory|data|agents|brain` - show what's stored
- [ ] Systemd timer or cron for nightly backups

### Distribution

- [ ] Homebrew tap formula
- [ ] npm package (if requested)
- [ ] Getting started guide / quickstart walkthrough
- [ ] Blog post / launch announcement

---

## Future / Someday

- [ ] Fine-grained agent permissions (per-agent permission modes, tool allow/deny lists, filesystem sandboxing). Currently all agents run with full permissions (`bypassPermissions` on Claude, unrestricted on Pi).
- [ ] Multi-user permissions model
- [ ] Cost / token tracking per user and per agent
- [ ] Rate limiting and per-user quotas
- [ ] Artifact / file sharing (surface agent outputs cleanly per frontend)
- [ ] Knowledge graph (entities + relationships across notes)
- [ ] Output formatters / renderers per frontend
- [ ] Data source plugins (databases, APIs, RSS, calendars)
