# Coding v1 — PRD + Technical Design

## Status

Draft — awaiting review.

## Terminology note

This document is a hybrid of:

- a **PRD** (product requirements doc): what the feature should do
- a **technical design doc**: how we should implement it

---

## 1. Summary

Add remote coding capabilities to `pug-claw` that let agents submit coding tasks to a dedicated coding VM, manage long-running processes, and monitor results asynchronously.

The coding system is organized in three layers:

1. **SSH execution** — run commands on a remote VM (the foundation)
2. **tmux primitives** — manage long-running processes, tail logs, interact with services
3. **acpx integration** — structured coding agent tasks via the Agent Client Protocol

Key capabilities:

1. **Agents can submit coding tasks** to Claude Code or Codex via acpx on a remote VM
2. **Async task model** — submit returns immediately; a background monitor polls and notifies the originating channel when done
3. **tmux process management** — agents can start, monitor, and interact with arbitrary long-running processes on the VM (dev servers, logs, builds, etc.)
4. **Per-agent coding config** — different agents can target different VMs or coding agents
5. **Standalone module with CLI** — the coding subsystem can be tested independently of pug-claw's frontends and drivers
6. **Built-in `coder` agent** — opinionated agent tuned for coding tasks, with any agent able to opt-in via config

The coding VM itself is provisioned and managed in a separate repository. This document covers only what lives in pug-claw.

---

## 2. Product goals

### Goals

- Agents can submit coding prompts to remote coding agents (Claude Code, Codex) and receive results
- Coding tasks run asynchronously — the user is notified when tasks complete, rather than waiting
- Agents can manage arbitrary long-running processes on the VM via tmux (start, read output, send input, stop)
- Agents can clone repositories to the VM on demand
- Agents can run one-off commands on the VM
- A built-in `coder` agent provides an opinionated starting point for coding workflows
- Any agent can opt-in to coding tools via config
- The coding module can be integration-tested standalone, without deploying pug-claw

### Non-goals for v1

- No VM provisioning or lifecycle management (separate repo)
- No dynamic VM provisioning or VM pool (single pre-provisioned VM)
- No PR creation orchestration from pug-claw (the coding agent on the VM handles this via `gh`)
- No full job framework (the coding monitor is purpose-built for coding tasks)
- No tmux-based coding agent fallback (designed for but not implemented — tmux is for general process management)
- No multi-VM orchestration
- No workspace cleanup automation (manual for v1)
- No web UI for coding task management
- No cost/token tracking for remote coding sessions

---

## 3. Architecture

### 3.1 Three-layer model

```
Layer 1: SSH execution     — vm_exec: run short-lived commands, return stdout/stderr
Layer 2: tmux primitives   — named sessions for long-running processes
Layer 3: acpx integration  — structured coding agent tasks via ACP
```

Each layer builds on the one below:

- tmux tools use SSH to create and manage tmux sessions
- acpx tools use SSH to invoke `acpx` commands
- the background coding monitor uses SSH to poll `acpx status`

### 3.2 End-to-end flow

```
User (Discord/TUI) → "fix the failing tests in pug-claw"
  → pug-claw routes to coder agent
  → agent calls coding_submit tool
  → tool SSHes to coding VM, runs: acpx --no-wait claude 'fix the failing tests'
  → tool returns task ID immediately
  → agent tells user: "Submitted coding task #abc123, I'll notify you when it's done."
  → background monitor polls: ssh coding-vm 'acpx claude status'
  → when done, monitor posts result to originating channel
```

### 3.3 Network topology

```
User → Discord/TUI → pug-claw (incus VM, on Tailscale)
                          │
                          │ SSH over Tailscale
                          ▼
                    coding VM (on Tailscale)
                      ├── acpx → Claude Code / Codex
                      ├── tmux sessions (dev servers, logs, builds)
                      ├── gh CLI (GitHub operations)
                      └── git repos (pre-cloned + on-demand)
```

### 3.4 Assumptions about the coding VM

The coding VM is provisioned and managed externally. pug-claw assumes:

- SSH access via Tailscale hostname with key-based auth
- `acpx`, `tmux`, `git`, and `gh` are installed and on PATH
- Claude Code and/or Codex are available as acpx agents
- A dedicated user account exists for pug-claw to SSH into
- GitHub SSH key and token are configured for the VM user

---

## 4. Tool set

### 4.1 Layer 1: VM execution

| Tool | Purpose | Inputs | Output |
|------|---------|--------|--------|
| `vm_exec` | Run a short-lived command on the VM | `command: string` | stdout, stderr, exit code |

`vm_exec` is the escape hatch for anything not covered by tmux or acpx tools. It runs synchronously and returns when the command completes. Not intended for long-running processes — use tmux for those.

### 4.2 Layer 2: tmux

| Tool | Purpose | Inputs | Output |
|------|---------|--------|--------|
| `tmux_start` | Create a named tmux session and run a command in it | `name: string, command: string` | success/error |
| `tmux_read` | Capture current pane output from a session | `name: string, lines?: number` | captured text |
| `tmux_send` | Send keys/input to a running session | `name: string, keys: string` | success/error |
| `tmux_list` | List active tmux sessions | — | session names + status |
| `tmux_kill` | Kill a tmux session | `name: string` | success/error |

Implementation:

- `tmux_start` → `ssh <vm> 'tmux new-session -d -s <name> "<command>"'`
- `tmux_read` → `ssh <vm> 'tmux capture-pane -t <name> -p -S -<lines>'`
- `tmux_send` → `ssh <vm> 'tmux send-keys -t <name> "<keys>" Enter'`
- `tmux_list` → `ssh <vm> 'tmux list-sessions -F "#{session_name} #{session_activity}"'`
- `tmux_kill` → `ssh <vm> 'tmux kill-session -t <name>'`

### 4.3 Layer 3: coding (acpx)

| Tool | Purpose | Inputs | Output |
|------|---------|--------|--------|
| `coding_submit` | Submit a prompt to a coding agent via acpx `--no-wait` | `prompt: string, agent?: string, cwd: string, session_name?: string` | task ID |
| `coding_status` | Check acpx session status | `cwd: string, agent?: string, session_name?: string` | running/idle/dead + summary |
| `coding_result` | Get the full output of the last completed prompt | `cwd: string, agent?: string, session_name?: string` | response text |
| `coding_cancel` | Cancel a running prompt | `cwd: string, agent?: string, session_name?: string` | success/error |
| `coding_sessions` | List acpx sessions on the VM | `agent?: string` | session list with status |
| `coding_clone` | Clone a repository to the VM | `url: string, path?: string` | local path on VM |

Implementation:

- `coding_submit` → `ssh <vm> 'cd <cwd> && acpx --no-wait --format json <agent> "<prompt>"'`
- `coding_status` → `ssh <vm> 'cd <cwd> && acpx <agent> status'`
- `coding_result` → `ssh <vm> 'cd <cwd> && acpx <agent> sessions history --limit 1'`
- `coding_cancel` → `ssh <vm> 'cd <cwd> && acpx <agent> cancel'`
- `coding_sessions` → `ssh <vm> 'acpx <agent> sessions list'`
- `coding_clone` → `ssh <vm> 'git clone <url> <path>'`

Default `agent` is `claude` unless overridden via per-agent config.

### 4.4 Tool input validation

All tools must validate and sanitize inputs before constructing SSH commands:

- `name` fields: alphanumeric, hyphens, and underscores only
- `command` and `prompt` fields: shell-escaped before embedding in SSH commands
- `cwd` and `path` fields: absolute paths, no shell metacharacters
- `url` fields: must match expected git URL patterns

This is a security boundary — user-influenced input flows through AI agents into shell commands on a remote machine.

---

## 5. Async model and background monitor

### 5.1 Task lifecycle

```
Submitted
  → coding_submit returns task ID, records task in monitor
Running
  → monitor polls acpx status periodically
Completed
  → monitor detects completion, posts result to originating channel
Failed
  → monitor detects failure, posts error to originating channel
Cancelled
  → coding_cancel sends acpx cancel, monitor detects stopped state
```

### 5.2 Coding task monitor

A lightweight background polling loop, separate from the scheduler subsystem.

Behavior:

- maintains an in-memory map of active coding tasks
- each task records: task ID, VM host, cwd, agent, session name, originating channel/session, submitted timestamp
- polls all active tasks on a configurable interval (default: 15 seconds)
- when a task completes, fetches the result and posts to the originating channel via a notification callback
- when a task fails, posts an error summary to the originating channel
- tasks that have been running longer than a configurable timeout (default: 30 minutes) are flagged but not automatically cancelled

### 5.3 Notification callback

The monitor does not depend on any specific frontend. It accepts a notification callback:

```typescript
type CodingNotificationCallback = (notification: CodingNotification) => Promise<void>;

interface CodingNotification {
  taskId: string;
  status: "completed" | "failed" | "timeout_warning";
  result?: string;
  error?: string;
  originChannel?: string;
  originSession?: string;
}
```

The frontend (Discord, TUI) provides a callback implementation that posts to the appropriate channel or session. This mirrors the scheduler's output sink pattern.

### 5.4 Persistence

For v1, the active task map is **in-memory only**. If pug-claw restarts, in-flight coding tasks are lost from the monitor's perspective (though the acpx sessions survive on the VM). Users can manually check with `coding_status`.

Future versions may persist active tasks to SQLite for restart resilience.

---

## 6. Configuration

### 6.1 Per-agent coding config

Coding configuration lives in agent frontmatter (`SYSTEM.md`), not in a global config section. This allows different agents to target different VMs and coding agents.

```yaml
---
name: coder
description: Coding agent with remote VM access
coding:
  vm_host: coding-vm.tail1234.ts.net
  ssh_user: pug-claw
  default_agent: claude
  repos:
    pug-claw: /home/pug-claw/repos/pug-claw
    my-app: /home/pug-claw/repos/my-app
  poll_interval_seconds: 15
  task_timeout_minutes: 30
---
```

### 6.2 Config fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `coding.vm_host` | string | Yes | — | Tailscale hostname or IP of the coding VM |
| `coding.ssh_user` | string | Yes | — | SSH user on the coding VM |
| `coding.default_agent` | string | No | `claude` | Default acpx agent (`claude`, `codex`, etc.) |
| `coding.repos` | Record<string, string> | No | `{}` | Named repo paths on the VM |
| `coding.poll_interval_seconds` | number | No | `15` | How often the monitor polls active tasks |
| `coding.task_timeout_minutes` | number | No | `30` | Timeout warning threshold for coding tasks |

### 6.3 Config resolution

When a coding tool is invoked:

1. Look up the current agent's `coding` config from frontmatter
2. If absent, the tool call fails with a clear error: "This agent is not configured for coding. Add a `coding` section to the agent's SYSTEM.md frontmatter."
3. Tool-level `agent` parameter overrides `coding.default_agent`

### 6.4 SSH connection details

SSH connections use the system `ssh` CLI:

- Host: `coding.vm_host`
- User: `coding.ssh_user`
- Authentication: system SSH agent / key (no password auth)
- SSH config: standard `~/.ssh/config` applies (e.g., `StrictHostKeyChecking`, `IdentityFile`)

No SSH connection pooling in v1. Each tool invocation opens a new SSH connection. If latency becomes a problem, connection multiplexing via `ControlMaster` in SSH config is the recommended mitigation (no code changes needed).

---

## 7. Design for testability

Every layer is built around injectable interfaces so that each component can be unit-tested in isolation without SSH, a VM, or any I/O.

### 7.1 Dependency graph

```
┌─────────────────────────────────────────────────────────┐
│ CodingMcpServer (MCP tool definitions)                  │
│   depends on: CodingClient                              │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│ CodingClient (public API, composes layers)              │
│   depends on: TmuxClient, AcpxClient, SshExecutor      │
└───────┬──────────────────────┬──────────────────────────┘
        │                      │
┌───────▼──────────┐  ┌───────▼──────────┐
│ TmuxClient       │  │ AcpxClient       │
│  depends on:     │  │  depends on:     │
│  SshExecutor     │  │  SshExecutor     │
└───────┬──────────┘  └───────┬──────────┘
        │                      │
┌───────▼──────────────────────▼──────────────────────────┐
│ SshExecutor (interface)                                  │
│   production: ProcessSshExecutor (shells out to ssh CLI) │
│   tests: FakeSshExecutor (records commands, scripted)    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ CodingTaskMonitor                                        │
│   depends on: StatusPoller (function), NotificationCb    │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Core interfaces

#### SshExecutor

The foundation. All remote operations go through this interface.

```typescript
interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface SshExecutor {
  exec(command: string): Promise<ExecResult>;
}
```

Production implementation (`ProcessSshExecutor`) shells out to the `ssh` CLI. Test implementation (`FakeSshExecutor`) records commands and returns scripted responses.

`TmuxClient` and `AcpxClient` receive an `SshExecutor` via their constructor — they never know or care whether SSH is real.

#### StatusPoller

The monitor does not depend on `AcpxClient` or `SshExecutor` directly. It receives a polling function:

```typescript
type StatusPoller = (task: CodingTask) => Promise<CodingStatus>;
```

In production, this is wired to `AcpxClient.status()`. In tests, it's a function that returns scripted status transitions (running → running → completed).

#### CodingNotificationCallback

The monitor's output side is also a function, not a concrete frontend:

```typescript
type CodingNotificationCallback = (notification: CodingNotification) => Promise<void>;
```

In production, the frontend provides a callback that posts to Discord/TUI. In tests, a `FakeCodingNotificationCallback` records notifications for assertion.

### 7.3 Test fakes

| Fake | What it replaces | Behavior |
|------|-----------------|----------|
| `FakeSshExecutor` | `ProcessSshExecutor` | Records all commands in a `calls: string[]` array. Returns responses from a `responses: Map<string, ExecResult>` keyed by command substring match. Throws for unmatched commands. |
| `FakeCodingNotificationCallback` | Frontend notification callback | Records all notifications in a `notifications: CodingNotification[]` array. |
| Scripted `StatusPoller` | `AcpxClient.status()` | Returns statuses from a queue: e.g., `["running", "running", "completed"]`. Each call pops the next status. |

### 7.4 What each layer can test without

| Layer | No SSH needed | No VM needed | No acpx needed | No frontend needed |
|-------|:---:|:---:|:---:|:---:|
| `SshExecutor` (unit) | yes (test command construction) | yes | yes | yes |
| `TmuxClient` (unit) | yes (FakeSshExecutor) | yes | yes | yes |
| `AcpxClient` (unit) | yes (FakeSshExecutor) | yes | yes | yes |
| `CodingClient` (unit) | yes (FakeSshExecutor) | yes | yes | yes |
| `CodingTaskMonitor` (unit) | yes | yes | yes (scripted StatusPoller) | yes (FakeCb) |
| `CodingMcpServer` (unit) | yes (FakeSshExecutor) | yes | yes | yes |
| Config parsing (unit) | yes | yes | yes | yes |
| Input validation (unit) | yes | yes | yes | yes |
| Integration tests | no | no | no | yes (FakeCb) |

### 7.5 Pure functions

The following are stateless, I/O-free functions that can be tested with plain input/output assertions:

- **`buildSshCommand(host, user, command)`** — constructs the full SSH command string
- **`sanitizeName(name)`** — validates and sanitizes session/tmux names
- **`sanitizePath(path)`** — validates absolute paths
- **`escapeForShell(input)`** — shell-escapes arbitrary input
- **`buildTmuxCommand(operation, args)`** — constructs tmux command strings
- **`buildAcpxCommand(operation, args)`** — constructs acpx command strings
- **`parseAcpxStatus(output)`** — parses acpx status JSON into `CodingStatus`
- **`parseAcpxSessionsList(output)`** — parses acpx sessions list output
- **`parseTmuxSessionsList(output)`** — parses tmux list-sessions output
- **`generateTaskId()`** — produces a `coding_<uuid>` prefixed ID

### 7.6 No globals or singletons

Following the memory subsystem's pattern:

- `SshExecutor` is constructed and injected, never imported as a module singleton
- `TmuxClient`, `AcpxClient`, `CodingClient` are all instantiated with their dependencies
- `CodingTaskMonitor` is instantiated with its poller and callback
- Tests construct their own instances with fakes — no shared mutable state between tests

---

## 8. Standalone module

### 8.1 Module structure

```
src/coding/
  index.ts          — Public API exports (CodingClient class)
  cli.ts            — Standalone CLI entry point for testing
  ssh.ts            — SshExecutor interface + ProcessSshExecutor implementation
  tmux.ts           — TmuxClient (depends on SshExecutor)
  acpx.ts           — AcpxClient (depends on SshExecutor)
  monitor.ts        — CodingTaskMonitor (depends on StatusPoller + NotificationCb)
  types.ts          — All shared types (CodingTask, CodingConfig, ExecResult, etc.)
  config.ts         — Config parsing and validation (Zod schemas)
  sanitize.ts       — Input validation and shell-escaping (pure functions)
```

### 8.2 CLI entry point

The CLI allows testing all three layers without starting pug-claw:

```bash
# Layer 1: VM execution
bun run src/coding/cli.ts exec --host coding-vm --user pug-claw --command "uname -a"

# Layer 2: tmux
bun run src/coding/cli.ts tmux start --host coding-vm --user pug-claw \
  --name logs --command "tail -f /var/log/app.log"
bun run src/coding/cli.ts tmux read --host coding-vm --user pug-claw --name logs
bun run src/coding/cli.ts tmux list --host coding-vm --user pug-claw
bun run src/coding/cli.ts tmux kill --host coding-vm --user pug-claw --name logs

# Layer 3: coding
bun run src/coding/cli.ts coding submit --host coding-vm --user pug-claw \
  --agent claude --cwd /home/pug-claw/repos/pug-claw --prompt "fix the tests"
bun run src/coding/cli.ts coding status --host coding-vm --user pug-claw \
  --agent claude --cwd /home/pug-claw/repos/pug-claw
bun run src/coding/cli.ts coding sessions --host coding-vm --user pug-claw --agent claude

# Repo management
bun run src/coding/cli.ts clone --host coding-vm --user pug-claw \
  --url git@github.com:user/repo.git
```

The CLI constructs a `ProcessSshExecutor` from `--host` and `--user`, wires up real implementations, and calls the same `CodingClient` API that pug-claw uses.

### 8.3 Public API

```typescript
class CodingClient {
  constructor(deps: {
    ssh: SshExecutor;
    tmux: TmuxClient;
    acpx: AcpxClient;
  });

  // Layer 1
  exec(command: string): Promise<ExecResult>;

  // Layer 2
  tmuxStart(name: string, command: string): Promise<void>;
  tmuxRead(name: string, lines?: number): Promise<string>;
  tmuxSend(name: string, keys: string): Promise<void>;
  tmuxList(): Promise<TmuxSession[]>;
  tmuxKill(name: string): Promise<void>;

  // Layer 3
  codingSubmit(options: CodingSubmitOptions): Promise<string>;   // returns task ID
  codingStatus(options: CodingSessionRef): Promise<CodingStatus>;
  codingResult(options: CodingSessionRef): Promise<string>;
  codingCancel(options: CodingSessionRef): Promise<void>;
  codingSessions(agent?: string): Promise<CodingSessionInfo[]>;
  clone(url: string, path?: string): Promise<string>;            // returns local path
}
```

Factory function for convenience:

```typescript
function createCodingClient(config: CodingConfig): CodingClient {
  const ssh = new ProcessSshExecutor(config.vmHost, config.sshUser);
  const tmux = new TmuxClient(ssh);
  const acpx = new AcpxClient(ssh);
  return new CodingClient({ ssh, tmux, acpx });
}
```

In tests, construct with fakes:

```typescript
const ssh = new FakeSshExecutor();
const tmux = new TmuxClient(ssh);
const acpx = new AcpxClient(ssh);
const client = new CodingClient({ ssh, tmux, acpx });
```

---

## 9. Agent integration

### 9.1 MCP server

The coding tools are exposed to agents via an MCP server, following the same pattern as the memory tools in `src/memory/tools.ts`.

At session creation, if the agent has `coding` config in its frontmatter:

1. A `CodingClient` is constructed from the agent's coding config (via `createCodingClient`)
2. An MCP server is created with tools wrapping the client's methods
3. The MCP server is registered in the driver's session options

The MCP server receives the `CodingClient` as a dependency — it does not construct its own. This means tests can pass a `CodingClient` backed by `FakeSshExecutor` to test tool registration and invocation without any I/O.

### 9.2 Built-in `coder` agent

A new built-in agent at `builtins/agents/coder/`:

```yaml
---
name: coder
description: Coding agent with remote VM access
coding:
  vm_host: "${CODING_VM_HOST}"
  ssh_user: "${CODING_VM_USER}"
  default_agent: claude
  repos: {}
allowed-skills: []
metadata:
  managed-by: pug-claw
---
```

The system prompt instructs the agent on:

- How to use coding tools to submit tasks to remote coding agents
- How to use tmux tools for process management, log tailing, and debugging
- How to use `vm_exec` for one-off commands
- When to use which layer (quick command → `vm_exec`, long process → tmux, coding task → acpx)
- How to report progress and results to the user
- How to clone repos and manage the workspace

### 9.3 Environment variable substitution in frontmatter

The `coding` config references `${CODING_VM_HOST}` and `${CODING_VM_USER}`. These are resolved from environment variables at agent load time, keeping secrets out of checked-in agent files.

If the built-in coder agent is used and the env vars are not set, session creation fails with a clear message: "Set CODING_VM_HOST and CODING_VM_USER environment variables to use the coder agent."

### 9.4 Any agent opt-in

Any agent can gain coding capabilities by adding a `coding` section to its `SYSTEM.md` frontmatter. No code changes needed — the MCP server registration is driven entirely by the presence of `coding` config.

---

## 10. Security considerations

### 10.1 SSH command injection

All tool inputs that are interpolated into SSH commands must be sanitized. This is the primary security boundary — AI-generated content flowing into shell commands on a remote machine.

Mitigations:

- `name` fields: validated against `^[a-z0-9][a-z0-9_-]*$`
- `command` and `prompt` fields: passed via stdin or temporary files rather than shell interpolation where possible; otherwise shell-escaped
- `cwd` and `path` fields: validated as absolute paths with no shell metacharacters
- `url` fields: validated against expected git URL patterns

All sanitization logic lives in `sanitize.ts` as pure functions, independently testable with adversarial inputs.

### 10.2 VM isolation

The coding VM is a separate machine from the pug-claw VM. Compromise of the coding VM does not give access to pug-claw's secrets (Discord token, API keys).

The coding VM should run as a dedicated, low-privilege user. The SSH key and GitHub token on the coding VM grant access only to repositories the pug-claw GitHub account can reach.

### 10.3 Resource limits

For v1, no resource limits are enforced by pug-claw. The coding VM's OS-level limits apply. The task timeout warning (default: 30 minutes) alerts the user but does not automatically cancel tasks.

---

## 11. Testing strategy

### 11.1 Unit tests

#### Input sanitization (`sanitize.ts`)
- `sanitizeName` accepts valid names, rejects shell metacharacters
- `sanitizePath` accepts absolute paths, rejects relative paths and metacharacters
- `escapeForShell` correctly escapes quotes, backticks, dollar signs, etc.
- adversarial inputs: injection attempts via `$(...)`, backticks, semicolons, pipes

#### SSH execution (`ssh.ts`)
- `buildSshCommand` constructs correct `ssh user@host 'command'` strings
- `ProcessSshExecutor` handles stdout, stderr, and exit codes (integration-only)

#### tmux tools (`tmux.ts`)
- `buildTmuxCommand` constructs correct tmux commands for each operation
- `TmuxClient.start` calls `SshExecutor.exec` with correct tmux new-session command
- `TmuxClient.read` calls with correct capture-pane command, respects line count
- `TmuxClient.list` parses tmux list-sessions output via `parseTmuxSessionsList`
- all operations validated via `FakeSshExecutor` — assert the exact command string passed

#### acpx tools (`acpx.ts`)
- `buildAcpxCommand` constructs correct acpx commands for submit, status, cancel, sessions
- `parseAcpxStatus` handles running, idle, dead, and error JSON
- `parseAcpxSessionsList` handles multiple sessions with varying states
- `AcpxClient.submit` calls with `--no-wait --format json` flags
- all operations validated via `FakeSshExecutor`

#### Config (`config.ts`)
- validates required fields (vm_host, ssh_user)
- applies defaults (default_agent, poll_interval, timeout)
- rejects invalid config (missing host, invalid poll interval)
- environment variable substitution resolves `${VAR}` patterns
- missing env vars produce clear error messages

#### Monitor (`monitor.ts`)
- tracks submitted tasks in active map
- calls `StatusPoller` on each tick for each active task
- detects completion → calls notification callback with result
- detects failure → calls notification callback with error
- flags timed-out tasks → calls notification callback with timeout_warning
- removes completed/failed tasks from active map
- empty active map → poller still ticks but does nothing
- all tested with scripted `StatusPoller` and `FakeCodingNotificationCallback`

#### CodingClient (`index.ts`)
- delegates to correct sub-client for each operation
- passes through errors from sub-clients

### 11.2 Integration tests

Integration tests require a real coding VM. They are tagged and skipped unless `CODING_VM_HOST` is set.

#### SSH connectivity
- can execute a command on the VM and get output
- handles command failure (non-zero exit)

#### tmux lifecycle
- start session → list shows it → read output → send input → kill → list shows gone

#### acpx coding flow
- submit a simple prompt → status shows running → wait for completion → result contains output
- cancel a running prompt → status shows idle

#### Clone
- clone a public repo → path exists on VM → can list files

### 11.3 Standalone CLI tests

The CLI entry point is tested by running it as a subprocess and asserting on stdout/stderr/exit code. These are effectively integration tests that also verify the CLI argument parsing.

### 11.4 Test matrix summary

| Component | Test type | Dependencies | I/O |
|-----------|-----------|-------------|-----|
| `sanitize.ts` | Unit | None | None |
| `buildSshCommand` | Unit | None | None |
| `buildTmuxCommand` | Unit | None | None |
| `buildAcpxCommand` | Unit | None | None |
| `parseAcpxStatus` | Unit | None | None |
| `parseTmuxSessionsList` | Unit | None | None |
| `TmuxClient` | Unit | `FakeSshExecutor` | None |
| `AcpxClient` | Unit | `FakeSshExecutor` | None |
| `CodingClient` | Unit | `FakeSshExecutor` | None |
| `CodingTaskMonitor` | Unit | Scripted poller + FakeCb | None |
| `CodingMcpServer` | Unit | `FakeSshExecutor` | None |
| Config parsing | Unit | None | None |
| SSH connectivity | Integration | Real VM | SSH |
| tmux lifecycle | Integration | Real VM | SSH |
| acpx flow | Integration | Real VM + acpx | SSH |
| CLI e2e | Integration | Real VM | Subprocess |

---

## 12. Suggested implementation order

### PR 1: Types, config, and sanitization

- `src/coding/types.ts` — all type definitions (`ExecResult`, `CodingTask`, `CodingConfig`, `CodingStatus`, `TmuxSession`, etc.)
- `src/coding/config.ts` — Zod schema, config parsing, env var substitution
- `src/coding/sanitize.ts` — input validation and shell-escaping pure functions
- Unit tests for config parsing, validation, env var substitution
- Unit tests for all sanitization functions including adversarial inputs

### PR 2: SSH execution and CLI skeleton

- `src/coding/ssh.ts` — `SshExecutor` interface + `ProcessSshExecutor` implementation + `buildSshCommand` pure function
- `src/coding/cli.ts` — CLI skeleton with `exec` subcommand
- `FakeSshExecutor` test helper
- Unit tests for `buildSshCommand`
- Integration test: execute a command on a real VM (skip-tagged)

### PR 3: tmux tools

- `src/coding/tmux.ts` — `TmuxClient` with all operations + `buildTmuxCommand` + `parseTmuxSessionsList` pure functions
- CLI `tmux` subcommand (start, read, send, list, kill)
- Unit tests: pure functions + `TmuxClient` with `FakeSshExecutor`
- Integration test: tmux session lifecycle on real VM (skip-tagged)

### PR 4: acpx tools

- `src/coding/acpx.ts` — `AcpxClient` with all operations + `buildAcpxCommand` + `parseAcpxStatus` + `parseAcpxSessionsList` pure functions
- CLI `coding` subcommand (submit, status, result, cancel, sessions)
- CLI `clone` subcommand
- Unit tests: pure functions + `AcpxClient` with `FakeSshExecutor`
- Integration test: submit and complete a coding task on real VM (skip-tagged)

### PR 5: CodingClient and background monitor

- `src/coding/index.ts` — `CodingClient` class + `createCodingClient` factory
- `src/coding/monitor.ts` — `CodingTaskMonitor` with `StatusPoller` and notification callback injection
- `FakeCodingNotificationCallback` test helper
- Unit tests: `CodingClient` delegation with `FakeSshExecutor`
- Unit tests: monitor lifecycle with scripted `StatusPoller` and `FakeCodingNotificationCallback`

### PR 6: MCP server and agent integration

- MCP server wrapping `CodingClient` methods as tools (receives `CodingClient` via DI)
- Agent frontmatter parsing for `coding` config
- `CodingClient` construction at session creation time
- Integration with Claude driver MCP server registration
- Unit tests for MCP tool wiring with `FakeSshExecutor`

### PR 7: Built-in coder agent and docs

- `builtins/agents/coder/SYSTEM.md` — agent with coding system prompt
- Update `docs/product/roadmap.md` with coding items checked off
- User-facing documentation for coding capabilities

### PR 8: Monitor integration with frontends

- Discord frontend: notification callback that posts to channels
- TUI frontend: notification callback that displays in terminal
- Monitor lifecycle: start with pug-claw, stop on shutdown
- Integration test: end-to-end coding task with notification

---

## 13. Future considerations

### Dynamic VM provisioning

When coding workload grows, a VM manager can provision and tear down VMs on demand:

- VM templates (incus profiles or similar)
- Pool of warm VMs for fast task start
- Per-task VM isolation for untrusted workloads
- Automatic cleanup after task completion

### tmux-based coding agent fallback

For coding agents that don't support ACP, run them in tmux and interact via `tmux_read`/`tmux_send`. The infrastructure is in place — this is a higher-level orchestration pattern on top of Layer 2.

### Job framework

The coding monitor is purpose-built. A general job framework would allow any agent to spawn background tasks (coding, data processing, long-running queries). The monitor's notification callback pattern is designed to evolve into this.

### Multi-VM orchestration

Different coding tasks could target different VMs based on the required environment (Python vs. Node vs. Rust), available resources, or isolation requirements.

### Workspace management

Automated workspace lifecycle: create working directories per task, clean up after completion, manage disk space on the VM.

### Task persistence

Persist active tasks to SQLite so the monitor survives pug-claw restarts. Acpx sessions survive on the VM regardless — persistence would let the monitor pick them back up automatically.

---

## 14. Final one-line product statement

`pug-claw` coding v1 gives agents the ability to submit coding tasks to remote coding agents via acpx, manage long-running processes via tmux, and execute arbitrary commands on a dedicated coding VM — all asynchronously with background monitoring and frontend notifications.
