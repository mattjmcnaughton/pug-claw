# Roadmap

## Completed

- [x] Multi-driver architecture (Claude, Pi)
- [x] Discord and TUI frontends
- [x] Per-channel agent/driver/model configuration
- [x] Pluggable agent/skills system
- [x] CI pipeline (lint, format, typecheck, tests)
- [x] Semantic-release with GitHub Releases
- [x] Standalone binary builds (Linux x86_64, macOS ARM64) — **paused** (CI workflow disabled; flip `publish-binaries` flag in CI config to re-enable)
- [x] Resource discovery: `~/.pug-claw` home directory with consolidated `config.json`
- [x] CLI framework (Commander.js) with `start`, `tui`, `init` subcommands
- [x] Interactive `pug-claw init` wizard (@clack/prompts)
- [x] Global + agent-specific skills with merge and precedence
- [x] Secrets provider abstraction (`env`, `dotenv`)
- [x] Discord guild filtering and owner identity config
- [x] Global CLI install via `bun link`

---

## Phase 0: Foundation

Core infrastructure that unblocks everything else.

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
- [ ] Refine and extend `config.json` schema for new features
- [ ] Config validation CLI command (`pug-claw check-config`)

### Type Normalization

- [ ] Audit and tighten core types (`DriverResponse`, `DriverOptions`, `FrontendContext`)
- [ ] Shared constants for driver names, tool names, command prefixes

---

## Phase 1: Deployment

Get pug-claw running on a real server as early as possible. Everything else gets more useful once it's always-on.

### Process Management

- [ ] SystemD unit file generation (`pug-claw init-service`)
- [ ] Graceful shutdown: drain sessions, flush logs
- [ ] Health check endpoint (for systemd watchdog, uptime monitoring)
- [ ] JSONL structured logs from all agent interactions (audit trail)

### Safe Restart

Ability to restart the process cleanly, and to roll back to the last known good state if something goes wrong.

- [ ] Graceful restart command / signal handler (finish in-flight work, then restart)
- [ ] State snapshot on shutdown (active sessions, pending jobs, config version)
- [ ] Restore from snapshot on startup (resume where we left off)
- [ ] Last-known-good config: persist last config that booted successfully
- [ ] `pug-claw rollback` — restart using last-known-good config + binary
- [ ] Automatic rollback on crash loop (N crashes in M minutes → revert)

### Management Web UI

Standalone web server (separate process) for managing pug-claw out-of-band. Critical for recovery when the main process crashes or a bad config/update breaks things.

- [ ] Standalone HTTP server (`pug-claw admin`) — runs independently of the main process
- [ ] Process monitor: show main process status (running, crashed, PID, uptime)
- [ ] Log viewer: stream and search JSONL logs from the browser
- [ ] Config viewer: display current config with validation status and diagnostics
- [ ] Start / stop / restart controls for the main pug-claw process
- [ ] Configurable process command (so the admin server knows how to launch pug-claw)
- [ ] Last-known-good config display and one-click rollback
- [ ] Auth: at minimum, bind to localhost only; optionally token-based access

### Deploy Pipeline

- [ ] Deploy to VM (manual first run)
- [ ] Automated deploy script or CI job (build → scp/rsync → restart service)
- [ ] Smoke test after deploy (health check passes before marking deploy as good)

---

## Phase 2: Memory, Knowledge, and Cron

### Conversation Log

Append-only JSONL log of all conversations. Source of truth for everything downstream.

- [ ] JSONL conversation logger (one file per agent per day)
- [ ] Log schema: timestamp, agent, user, role, content, metadata
- [ ] Log rotation / retention policy

### Working Memory

Per-agent scratchpad the agent can read/write during a session. Persists across sessions.

- [ ] Working memory storage (markdown or JSONL, one per agent)
- [ ] `SaveMemory` / `ReadMemory` tools for agents
- [ ] `!remember` / `!forget` / `!memory` user commands

### MEMORY.md and Conversation Summaries

Batch job (cron) that processes JSONL logs into usable artifacts. Runs as a skill.

- [ ] `MEMORY.md` per agent — distilled facts, preferences, patterns
- [ ] `days/DAY.md` — daily conversation summaries
- [ ] Summarization skill (agent-driven, invoked by cron job)
- [ ] Incremental processing (track last-processed log offset)
- [ ] System prompt tells agents these files exist and how to access them on-demand

### Second Brain

Agents can search and write to your personal knowledge base.

- [ ] Brain config: source paths, inbox path, index path (`[brain]` in config)
- [ ] `brain-search` tool: full-text search (ripgrep) across configured source paths
- [ ] `brain-save` tool: save notes to inbox with title, tags, frontmatter
- [ ] `brain-list` tool: browse knowledge by path, recency, or tags
- [ ] Obsidian compatibility: respect frontmatter, wikilinks, tags
- [ ] Conversation capture: auto-summarize sessions and save to `conversations/`
- [ ] Indexing: incremental reindex on startup based on mtime
- [ ] File watcher for live reindex during long-running processes
- [ ] `pug-claw reindex` CLI command

### Basic Cron / Scheduled Tasks

Simple timer-based agent actions. Enables conversation capture, memory compaction, brain reindexing, and daily summaries without full workflow infrastructure.

- [ ] Schedule config in `config.json` or `schedules.yaml`
- [ ] Timer runtime (`setInterval`-based, runs inside the main process)
- [ ] Each job: agent + prompt + output target (Discord channel, brain, log only)
- [ ] `!schedules` / `/schedules` command to list active jobs
- [ ] Built-in jobs: brain reindex, memory compaction

### Semantic Embeddings (optional, later)

Optional layer on top of conversation logs and memory. Enables similarity search across all stored content.

- [ ] Embedding generation (local model via Ollama or API)
- [ ] Vector storage in SQLite (sqlite-vec or similar — TBD)
- [ ] Semantic search tool for agents ("find conversations/notes related to X")
- [ ] Incremental embedding on new log entries / memory writes

### Second Brain - Advanced (later)

- [ ] Connection discovery ("notes related to X")
- [ ] Spaced repetition surfacing ("you wrote about this 3 months ago")
- [ ] Ingest pipeline: PDF extraction, web clips, email import, voice transcription

---

## Phase 3: Agent Ecosystem

### Core Agents

- [ ] `coder` - coding-focused, full tool access, opinionated about style
- [ ] `ops` - DevOps/infra, knows your VM, can check services and logs
- [ ] `researcher` - deep research with web search + brain search combined
- [ ] `writer` - content creation: blog posts, docs, READMEs
- [ ] `archivist` - knowledge management, indexes and organizes the brain
- [ ] `triage` - lightweight router, classifies messages and delegates to the right agent
- [ ] `reviewer` - code review, reads diffs, gives structured feedback
- [ ] `scheduler` - manages recurring tasks, reminders, check-ins

### Core Skills

Coding:
- [ ] `code-review` - review code for bugs, style, security
- [ ] `explain-code` - explain what code does in plain language
- [ ] `debug` - diagnose bugs from error output
- [ ] `write-tests` - generate tests for given code
- [ ] `git-summary` - summarize recent git activity

Knowledge:
- [ ] `recall` - search the brain for relevant knowledge
- [ ] `remember` - save a fact or insight to the brain
- [ ] `capture` - save a web page, PDF, or excerpt to the brain
- [ ] `research` - web search + brain search, what do I know vs. what's new

Content:
- [ ] `draft-post` - draft a blog post or social media post
- [ ] `edit-prose` - improve clarity, tone, grammar
- [ ] `write-docs` - generate documentation from code

Ops:
- [ ] `check-service` - check status of a systemd service
- [ ] `tail-logs` - tail and summarize recent logs
- [ ] `deploy` - guide or execute deployment steps

Utility:
- [ ] `delegate` - hand off a subtask to another agent
- [ ] `classify` - classify a message by intent/topic

### Agent-to-Agent Delegation

- [ ] `delegate` tool: create temp session with target agent, send prompt, return result
- [ ] Recursion depth limit
- [ ] Context passing controls (full conversation vs. subtask only)

### Message Routing

- [ ] Better routing rules: regex, keywords, user roles
- [ ] Message ignore/filter rules (bots, patterns, specific users)
- [ ] Triage agent as default entry point (optional)

---

## Phase 4: Advanced Automation and Workflows

### Workflow Chaining

- [ ] Workflow definitions (YAML): sequential steps with agent + input/output mapping
- [ ] Trigger types: message, cron, webhook, agent output
- [ ] Variable interpolation between steps

### VM Coding Agent + Tailscale

- [ ] `vm-code` skill: launch a coding agent (Claude Code / Codex) in a sandboxed workspace
- [ ] Monitor agent progress, report status back to user
- [ ] Serve output over Tailscale (bind to port, or `tailscale serve`)
- [ ] Port tracking and cleanup
- [ ] Workspace lifecycle: auto-cleanup after timeout or `!stop` command
- [ ] Resource limits (Docker container option)

### Event-Driven Triggers

- [ ] Webhook receiver (HTTP endpoint for GitHub, etc.)
- [ ] File change watcher triggers
- [ ] Agent output triggers (agent A finishes -> agent B starts)

---

## Phase 5: Operations and Polish

### Distribution

- [ ] Homebrew tap formula
- [ ] npm package (if requested)
- [ ] Getting started guide / quickstart walkthrough
- [ ] Blog post / launch announcement

### Export and Backup

- [ ] `pug-claw export` - full backup (config, agents, memory, brain inbox, conversations)
- [ ] `pug-claw export --memory|--brain|--config|--conversations` - selective export
- [ ] `pug-claw import` - restore from backup
- [ ] `pug-claw inspect memory|data|agents|brain` - show what's stored
- [ ] Systemd timer or cron for nightly backups

### Quality

- [ ] Better test coverage (frontends, drivers, integration with real APIs)
- [ ] Refactoring pass on shared frontend logic (Discord + TUI command handling is still duplicated; agent resolution extracted to `src/agents.ts`)
- [ ] Error recovery and retry logic for drivers
- [ ] Dev mode hot reload (`bun --watch`)
- [ ] Agent/skill scaffolding CLI (`pug-claw new-agent`, `pug-claw new-skill`)

### Port OpenClaw Workflows

- [ ] Identify and list OpenClaw workflows to port
- [ ] PR review pipeline (GitHub webhook -> reviewer agent -> post comment)
- [ ] Daily standup bot (cron -> summarize activity -> post to channel)
- [ ] On-call assistant (alert -> ops agent triages)
- [ ] Knowledge capture (conversation -> archivist extracts key facts)

---

## Future / Someday

- [ ] Webhook / HTTP API frontend
- [ ] Slack frontend
- [ ] Multi-user permissions model
- [ ] Cost / token tracking per user and per agent
- [ ] Rate limiting and per-user quotas
- [ ] Observability: metrics (Prometheus), tracing (OpenTelemetry)
- [ ] Artifact / file sharing (surface agent outputs cleanly per frontend)
- [ ] Knowledge graph (entities + relationships across notes)
- [ ] Output formatters / renderers per frontend
- [ ] Data source plugins (databases, APIs, RSS, calendars)
