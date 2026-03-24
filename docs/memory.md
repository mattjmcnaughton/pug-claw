# Memory

pug-claw supports persistent memory that survives across sessions.

This document describes how memory is stored, injected into prompts, exposed through tools and commands, and constrained by scope and permissions.

## What memory is for

Memory is for durable context that should survive beyond a single session, such as:

- user preferences
- project conventions
- recurring facts
- stable environment details
- corrections that the agent should remember later

Memory is **not** the same as session context:

- **Session context** lives only inside the current driver session
- **Memory** is persisted in the runtime database and can be reused in future sessions

## Storage

Memory is stored in the runtime SQLite database:

- `internal/pug-claw.sqlite`

The backend tracks:

- `id`
- `scope`
- `content`
- `tags`
- `source`
- `createdBy`
- `status`
- `createdAt`
- `updatedAt`
- `accessedAt`

Entry statuses are:

- `active` — normal memory entries
- `archived` — soft-deleted entries

## Configuration

Relevant config lives under `memory`:

```json
{
  "memory": {
    "enabled": true,
    "injection_budget_tokens": 2000,
    "embeddings": {
      "enabled": false,
      "model": "Xenova/all-MiniLM-L6-v2"
    }
  }
}
```

Meaning:

- `memory.enabled`
  - global kill switch for the memory system
  - when `false`, pug-claw does not initialize the memory store or embedding provider
  - interactive and scheduled runs do not receive injected memory or memory tool access
  - memory commands remain in the command tree, but report that memory is not available
- `memory.injection_budget_tokens`
  - approximate token budget for the injected memory block
- `memory.embeddings.enabled`
  - enables semantic / hybrid search support
- `memory.embeddings.model`
  - embedding model used by the Hugging Face embedding provider

## Scopes

pug-claw supports three memory scopes:

- `agent:<name>`
- `user:default`
- `global`

### `agent:<name>`

Agent-private memory for a specific agent.

Examples:

- `agent:default`
- `agent:writer`
- `agent:researcher`

This is the default scope for most memory writes.

### `user:default`

Shared user-level memory.

Use this for facts about the user that should be available across agents.

### `global`

Shared system-level memory.

Use this for durable facts that should be available across agents and not tied to a single user preference.

## Agent opt-in / opt-out

Agents can control session-level memory behavior through frontmatter in `SYSTEM.md`:

```yaml
memory: true
```

or:

```yaml
memory: false
```

When `memory: false`:

- no prompt memory is injected for that agent
- no memory tool context is attached for that agent during normal interactive or scheduled runs

This does **not** delete stored entries for that agent. It only disables automatic runtime use of memory for that agent.

## Prompt injection

When memory is enabled globally and for the resolved agent, pug-claw builds a memory block and appends it to the driver system prompt pipeline.

Injection behavior:

- active entries only
- pulls from:
  - `agent:<current-agent>`
  - `user:default`
  - `global`
- scope priority is:
  1. agent memory
  2. user memory
  3. global memory
- within a scope, more recently accessed entries are favored
- the memory block is constrained by `memory.injection_budget_tokens`

The injected block is intentionally labeled as untrusted retrieved context, not instructions.

### Important implementation detail

Prompt injection uses `peek()` instead of normal `get()` / `list()` access, so building the prompt does **not** update `accessedAt`.

Normal reads such as `get`, `list`, and `search` do update `accessedAt`.

## Memory tools in agent runs

When memory is enabled for a run, drivers may expose these tools to the agent:

- `SaveMemory`
- `SearchMemory`
- `UpdateMemory`
- `DeleteMemory`
- `ListMemory`

The system prompt also includes guidance telling agents to:

- proactively save durable facts and preferences
- avoid storing transient or obvious information
- use `ListMemory` when asked what they remember
- use `UpdateMemory` / `DeleteMemory` when asked to correct or remove memory

## Tool scope rules

### Save

`SaveMemory` accepts optional scope values:

- `agent`
- `user`
- `global`

Default write scope is `agent:<current-agent>`.

### Search

Default `SearchMemory` behavior searches across:

- `agent:<current-agent>`
- `user:default`
- `global`

Explicit scope narrows the search to one of those scope families.

### List

`ListMemory` lists a single scope.

Default list scope is `agent:<current-agent>`.

### Update / Delete

Updates and deletes are permission-checked.

An agent may always modify:

- entries in its own `agent:<name>` scope

For shared scopes (`user:default` and `global`):

- an agent may modify only entries it originally created
- agents cannot mutate another agent's shared-scope entries

This prevents one agent from silently rewriting another agent's shared memory.

## Memory commands

See also: [`docs/commands.md`](./commands.md)

User-facing commands:

- `memory show [scope]`
- `memory search <query>`
- `memory remember <text>`
- `memory forget <id>`
- `memory export [scope]`
- `memory stats`
- `memory reindex`

Frontend access:

- **Discord:** owner only
- **TUI:** available directly

Command behavior:

- `memory show [scope]`
  - defaults to the current agent scope
- `memory search <query>`
  - searches across agent, user, and global scopes
- `memory remember <text>`
  - saves into the current agent scope
- `memory forget <id>`
  - archives a memory entry; short unique ID prefixes are accepted
- `memory export [scope]`
  - exports one scope as markdown
- `memory stats`
  - shows counts by status and scope, plus embedding configuration status
- `memory reindex`
  - rebuilds embeddings when embedding support is available

## Search behavior

Memory search combines:

- keyword search
- semantic search, when embeddings are enabled

If both match the same entry, pug-claw promotes it as a hybrid result.

### Embedding fallback behavior

There are two fallback paths:

1. If the embedding provider initializes successfully but `sqlite-vec` cannot be loaded:
   - embeddings are still generated
   - semantic search falls back to in-process cosine similarity
2. If embedding initialization fails entirely:
   - semantic search is disabled
   - search falls back to keyword-only behavior

In both failure cases, pug-claw logs `memory_embeddings_disabled` and continues running.

## Reindexing

`memory reindex` regenerates embeddings for existing entries.

Use it when:

- changing embedding behavior
- recovering from embedding/index drift
- enabling embeddings for an existing store

If embeddings are unavailable, the command reports that reindexing is not available.

## Scheduler behavior

For scheduled agents:

- memory injection follows the same rules as interactive sessions
- memory tools are available only when memory is enabled globally and for that agent

## Future work

Memory compaction is deferred to a later roadmap item.

## Operational notes

A few important things to remember:

- Memory is persistent. Resetting a session does not erase stored memory.
- `archive` is the normal deletion path exposed to users and tools.
- Prompt injection uses only active entries.
- When `memory.enabled: false`, memory commands report that memory is not available.

## When to add memory

Good candidates:

- stable user preferences
- naming conventions
- repo-specific habits
- recurring environment facts
- corrections the user explicitly wants remembered

Bad candidates:

- one-off transient requests
- obvious facts already present in the current prompt
- low-value chatter
- speculative or uncertain information

## Related files

Core implementation:

- `src/memory/store.ts`
- `src/memory/injection.ts`
- `src/memory/tools.ts`
- `src/memory/actions.ts`
- `src/memory/embeddings.ts`

Runtime integration:

- `src/channel-handler.ts`
- `src/scheduler/runner.ts`
- `src/drivers/claude.ts`
- `src/drivers/pi.ts`
- `src/main.ts`

Tests:

- `tests/unit/memory-injection.test.ts`
- `tests/unit/memory-store.test.ts`
- `tests/unit/memory-tools.test.ts`
- `tests/integration/channel-handler.test.ts`
- `tests/integration/scheduler-runtime.test.ts`
