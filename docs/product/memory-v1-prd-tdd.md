# Memory v1 — PRD + Technical Design

## Status

Draft — awaiting review.

---

## 1. Summary

Add a memory system to `pug-claw` that gives agents and the platform durable, structured knowledge that persists across sessions.

Memory is distinct from:

- **Config** (`config.json`) — operator-controlled settings
- **Identity** (`SYSTEM.md`) — agent character, instructions, static knowledge
- **Skills** (`SKILL.md` + scripts) — agent capabilities

Memory is **learned knowledge**: facts, preferences, patterns, and context discovered during the day-to-day life of an agent or the platform. It is written by agents autonomously during conversations, by users via chat commands, and refined by background compaction jobs.

Key capabilities:

1. **Three memory scopes**: agent-level, global (cross-agent), and user-level (single user for v1)
2. **Pluggable backend interface** with a SQLite-based first implementation
3. **Optional semantic search** via `@huggingface/transformers` (local embeddings) + `sqlite-vec` (indexed KNN search)
4. **System prompt injection + tool-based retrieval** for surfacing memories to agents
5. **Agent-driven read/write/edit/delete** — agents learn autonomously and can manage their own memory via conversation
6. **User commands** for viewing, searching, adding, removing, exporting, and compacting memory
7. **Background compaction** via scheduled agent runs (nightly cron)
8. **Real-time learning** — agents save memories during conversations as they encounter important information

---

## 2. Product goals

### Goals

- Agents remember important facts, preferences, and patterns across sessions
- Global memory stores cross-agent knowledge (e.g., "the user prefers concise responses")
- Users can explicitly tell agents to remember or forget things
- Users can inspect and manage all memory via chat commands
- Agents can read, write, search, update, and delete their own memories — including via natural conversation ("what's in your memory?", "update that memory about deploy keys")
- Memory is injected into agent context automatically (compact summary in system prompt)
- Agents can retrieve deeper memory via tools when needed
- Background compaction keeps memory clean and relevant over time
- Pluggable backend architecture supports future storage options
- Optional semantic search provides intelligent retrieval when available
- Memory export to human-readable markdown format

### Non-goals for v1

- No multi-user memory (single user assumed; multi-user is a roadmap item)
- No cross-instance memory sync (single pug-claw instance assumed)
- No memory encryption at rest
- No per-memory access control / permissions
- No memory import from external sources (only from pug-claw backup)
- No conversation logging or summarization (separate roadmap item)
- No memory-aware agent routing ("send this to the agent who knows about X")
- No real-time memory sharing notifications between agents

---

## 3. Memory model

### 3.1 Scopes

| Scope | Key | Description | Example |
|-------|-----|-------------|---------|
| Agent | `agent:<name>` | Per-agent knowledge. Only this agent reads/writes it. | "User prefers Python over TypeScript for scripts" |
| Global | `global` | Shared across all agents. Any agent can read; writes go to global scope. | "The production server runs Ubuntu 24.04" |
| User | `user:default` | Knowledge about the user. Readable by all agents. | "User's name is Matt. Timezone is America/New_York" |

For v1, there is a single user (`default`). The scope key format supports future multi-user expansion (`user:<user_id>`).

### 3.1.1 Permissions

Permissions are enforced by the memory tool/runtime layer, not left as a prompt-only convention.

- Agents may read memories in their own agent scope, `global`, and `user:default`.
- Agents may always create, update, archive, and delete memories in their own agent scope.
- Agents may create memories in shared scopes (`global`, `user:default`).
- In shared scopes, agents may update, archive, or delete only entries they originally created.
- User-facing memory commands are not subject to agent-origin restrictions and may inspect or manage any scope supported by the command.
- System processes, including compaction, may manage all scopes.

### 3.2 Memory entry

Each memory is a discrete entry stored in a structured backend. Entries are rendered as a single document for system prompt injection (hybrid model).

```typescript
interface MemoryEntry {
  id: string;               // mem_<uuid>
  scope: MemoryScope;       // "agent:<name>" | "global" | "user:default"
  content: string;          // The memory content (plain text or markdown)
  tags: string[];           // Optional categorization tags
  source: MemorySource;     // How it was created
  createdBy: string;        // "agent:<name>" | "user" | "system:<name>"
  status: MemoryStatus;     // "active" | "archived" | "compacted"
  createdAt: string;        // ISO timestamp
  updatedAt: string;        // ISO timestamp
  accessedAt: string;       // ISO timestamp (last explicit retrieval)
}

type MemoryScope = `agent:${string}` | "global" | `user:${string}`;

type MemorySource =
  | "agent"       // Agent saved autonomously during conversation
  | "user"        // User explicitly saved via !memory remember
  | "compaction"  // Created by background compaction
  | "system";     // Created by pug-claw itself (e.g., during init)

type MemoryStatus =
  | "active"      // Normal, included in retrieval
  | "archived"    // Soft-deleted, excluded from retrieval but not removed
  | "compacted";  // Replaced by a compaction summary, kept for audit
```

### 3.3 Memory lifecycle

```
Created (active)
  ├─ Agent saves autonomously during conversation
  ├─ User saves via !memory remember
  └─ Compaction creates summary entries

Updated
  ├─ Agent edits via UpdateMemory tool
  ├─ User asks agent to update memory in conversation
  └─ Compaction rewrites/merges entries

Archived (soft-deleted)
  ├─ User forgets via !memory forget
  ├─ Agent archives via DeleteMemory tool
  └─ Compaction archives redundant/stale entries

Compacted
  └─ Background compaction marks originals as "compacted"
      after merging into a new summary entry
```

Active entries are surfaced to agents. Archived and compacted entries are excluded from retrieval but remain in storage for auditability.

### 3.4 Access tracking

`accessedAt` records the last time a memory was explicitly retrieved through backend read operations such as `get()`, `list()`, or `search()`.

`accessedAt` is **not** updated when memories are passively included in system prompt injection, exported, counted, or scanned for internal maintenance operations.

This prevents prompt injection from artificially keeping the same memories "hot" and ensures `accessedAt` reflects deliberate retrieval.

---

## 4. Backend interface

### 4.1 MemoryBackend

The `MemoryBackend` interface is the central abstraction. All consumers — injection, tools, chat commands, compaction — program against this interface, never against a concrete implementation.

```typescript
interface MemoryBackend {
  init(): Promise<void>;
  close(): Promise<void>;

  // CRUD
  save(entry: NewMemoryEntry): Promise<MemoryEntry>;
  update(id: string, patch: MemoryEntryPatch): Promise<MemoryEntry | null>;
  get(id: string): Promise<MemoryEntry | null>;
  delete(id: string): Promise<boolean>;  // Hard delete
  archive(id: string): Promise<boolean>; // Soft delete (set status = archived)

  // Retrieval
  list(filter: MemoryFilter): Promise<MemoryEntry[]>;
  search(query: MemorySearchQuery): Promise<MemorySearchResult[]>;

  // Bulk
  listScopes(): Promise<string[]>;
  count(filter: MemoryFilter): Promise<number>;
  stats(): Promise<MemoryStats>;

  // Export
  exportMarkdown(scope: MemoryScope): Promise<string>;
}

interface NewMemoryEntry {
  scope: MemoryScope;
  content: string;
  tags?: string[];
  source: MemorySource;
  createdBy: string;
}

interface MemoryEntryPatch {
  content?: string;
  tags?: string[];
  status?: MemoryStatus;
}

interface MemoryFilter {
  scope?: MemoryScope;
  status?: MemoryStatus;
  source?: MemorySource;
  tags?: string[];
  limit?: number;
  offset?: number;
}

interface MemorySearchQuery {
  text?: string;           // Keyword search
  embedding?: number[];    // Semantic search vector
  scope?: MemoryScope;
  status?: MemoryStatus;
  limit?: number;
}

interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;           // Relevance score (0-1)
  matchType: "keyword" | "semantic" | "hybrid";
}

interface MemoryStats {
  totalEntries: number;
  activeEntries: number;
  archivedEntries: number;
  compactedEntries: number;
  entriesByScope: Record<string, number>;
}
```

### 4.2 SQLite backend (v1 implementation)

The first backend uses the existing runtime SQLite DB (`internal/pug-claw.sqlite`).

#### Schema

```sql
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',  -- JSON array
  source TEXT NOT NULL,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accessed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_scope_status
  ON memories(scope, status);

CREATE INDEX IF NOT EXISTS idx_memories_status_updated
  ON memories(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_scope_accessed
  ON memories(scope, accessed_at DESC);

-- Vector search table (created only when embeddings enabled)
-- Managed by sqlite-vec extension
CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding float[384]
);
```

#### Keyword search

Uses SQLite `LIKE` matching against content and tags. When embeddings are disabled or unavailable, keyword search is the only retrieval mode.

When embeddings are enabled, keyword search remains part of hybrid retrieval so exact wording, tags, names, and phrases still rank well.

#### Semantic search via sqlite-vec

When embeddings are enabled, vector search uses the `sqlite-vec` extension — a lightweight, dependency-free SQLite extension for KNN search. It is loaded via the `sqlite-vec` npm package at store initialization:

```typescript
import * as sqliteVec from "sqlite-vec";
sqliteVec.load(db);
```

A `vec0` virtual table stores embeddings alongside the main `memories` table:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding float[384]
);
```

KNN search is a single SQL query:

```sql
SELECT memory_id, distance
FROM memory_embeddings
WHERE embedding MATCH ?
ORDER BY distance
LIMIT ?
```

This gives indexed, SIMD-accelerated vector search with no in-process loops or brute-force scanning. It scales well beyond v1 needs.

**Platform note**: On macOS, the system SQLite may not allow extensions. `Database.setCustomSQLite()` may be needed for local development. On Linux (the production target), this is not an issue.

#### Markdown export

`exportMarkdown(scope)` renders all active entries for a scope as a markdown document:

```markdown
# Memory: agent:writer

## Facts
- User prefers concise responses (saved 2026-03-20)
- Blog posts should use AP style (saved 2026-03-15)

## Preferences
- Always use dark mode examples in code screenshots (saved 2026-03-18)
```

Tags are used as section headers. Entries without tags go under a "General" section.

---

## 5. Embedding system

### 5.1 Overview

Semantic search is **optional** and **gracefully degraded**. When embeddings are unavailable, fail to initialize, or are disabled, all search falls back to keyword matching. No feature is blocked by the absence of embeddings.

When embeddings are enabled and available, memory search uses **hybrid retrieval**:

- keyword search over content and tags
- semantic KNN search over content embeddings

Results from both methods are merged, deduplicated by memory ID, and ranked together. Entries matched by both methods are returned as `matchType: "hybrid"` and should rank ahead of single-mode matches when scores are otherwise similar.

Embedding initialization failures should log a warning and degrade to keyword-only search rather than fail startup.

### 5.2 Embedding provider

Use `@huggingface/transformers` with the `all-MiniLM-L6-v2` model:

- Pure JS/WASM — no native dependencies, no external services
- ~25MB model download, cached locally in `internal/models/`
- 384-dimensional embeddings
- Runs in-process on CPU
- Suitable for a 16GB RAM Linux machine with no GPU

### 5.3 Configuration

```json
{
  "memory": {
    "embeddings": {
      "enabled": false,
      "model": "Xenova/all-MiniLM-L6-v2"
    }
  }
}
```

Embeddings are **disabled by default** for zero-config simplicity. When enabled, the model is downloaded on first use.

### 5.4 Embedding lifecycle

- **Embedding input**: In v1, embeddings are generated from `content` only. Tags participate in keyword search and filtering, but are not embedded.
- **On save**: If embeddings enabled, generate embedding from content and store with entry
- **On update**: If content changed, regenerate embedding
- **On search**: Generate embedding from query, run semantic KNN search, and merge with keyword results
- **Backfill**: `!memory reindex` regenerates embeddings for all entries (useful after enabling embeddings or changing model)

### 5.5 Embedding interface

```typescript
interface EmbeddingProvider {
  init(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions(): number;
}
```

The v1 implementation uses `@huggingface/transformers`. The interface supports future providers (Ollama, OpenAI API, etc.).

---

## 6. Agent integration

### 6.1 Agent tools

Agents interact with memory via built-in tools. These are **not** skills (they don't live in `SKILL.md` directories). They are built-in tools provided by pug-claw at session creation time, similar to how `Read`, `Glob`, `Grep`, and `Bash` are registered as allowed tools.

#### SaveMemory

```
Save a piece of information to memory for future reference.

Parameters:
  content: string   — The fact, preference, or pattern to remember
  scope?: string    — "agent" (default), "global", or "user"
  tags?: string[]   — Optional categorization tags
```

When scope is `"agent"`, the tool automatically resolves to the current agent's scope (`agent:<current_agent_name>`).

#### SearchMemory

```
Search memory for relevant information.

Parameters:
  query: string     — What to search for
  scope?: string    — "agent" (default, searches agent + global + user), "global", or "user"
  limit?: number    — Max results (default: 10)
```

When scope is `"agent"` or omitted, searches the agent's own memory, global memory, and user memory. Returns results ranked by relevance.

#### UpdateMemory

```
Update an existing memory entry.

Parameters:
  id: string        — Memory entry ID
  content?: string  — New content (replaces existing)
  tags?: string[]   — New tags (replaces existing)
```

#### DeleteMemory

```
Archive a memory entry (soft delete).

Parameters:
  id: string        — Memory entry ID
```

#### ListMemory

```
List memory entries, optionally filtered.

Parameters:
  scope?: string    — "agent" (default), "global", or "user"
  limit?: number    — Max results (default: 20)
```

#### Tool permission model

Memory tools enforce scope permissions rather than relying only on prompt instructions.

- Agents may read from their own scope, `global`, and `user:default`.
- Agents may always modify entries in their own scope.
- Agents may create entries in `global` and `user:default`.
- In shared scopes, agents may update/archive/delete only entries whose `createdBy` matches the current agent scope.
- System-managed sessions may be granted broader access explicitly (for example, the compactor agent).

### 6.2 System prompt injection

At session creation, a compact memory summary is injected into the agent's system prompt. This gives agents immediate awareness of key knowledge without needing to call tools.

#### Injection strategy

1. Retrieve the **most recently accessed** active entries for each relevant scope (agent, global, user)
2. Render as a compact block appended to the system prompt
3. Limit total injection to a configurable token budget (default: ~2000 tokens / ~500 words)
4. Prioritize by: recency of access > recency of creation > scope (agent > user > global)

`accessedAt` here reflects deliberate retrieval through `get()`, `list()`, or `search()`, not passive prompt injection.

#### Token estimation

Use a simple heuristic (1 token ≈ 4 characters) to avoid adding a tokenizer dependency. The budget is a soft limit — the injection logic truncates entries to fit.

#### Injected format

```markdown
# Memory

## Your Memory (agent:writer)
- User prefers concise, direct responses
- Blog posts should follow AP style guidelines
- Always suggest outlines before full drafts

## About the User
- Name: Matt
- Timezone: America/New_York
- Prefers dark mode code examples

## Shared Knowledge
- Production server: Ubuntu 24.04 on a Hetzner VPS
- Deploy process: git push to main triggers CI/CD
```

#### Injection instructions

The system prompt also includes brief instructions telling the agent about its memory capabilities:

```
You have persistent memory that survives across sessions. Important facts, preferences,
and patterns from past conversations are shown above. You can also:
- Use SaveMemory to remember new information
- Use SearchMemory to find specific memories
- Use UpdateMemory to correct or refine memories
- Use DeleteMemory to remove outdated information
- Use ListMemory to browse all memories
Save important facts proactively — preferences, corrections, project context, recurring patterns.
Do not save transient or obvious information.
When the user asks "what's in your memory?" or "what do you remember?", use ListMemory.
When the user asks to update or remove a memory, use UpdateMemory or DeleteMemory.
```

### 6.3 Autonomous learning

Agents save memories autonomously during conversations. The system prompt instructions tell agents to save facts proactively. Users have full override power:

- `!memory show` to inspect what agents have saved
- `!memory forget <id>` to remove unwanted entries
- Conversational editing: "update that memory about deploy keys" or "forget what you saved about my old server"

### 6.4 Per-agent opt-out

Agents can opt out of memory via frontmatter in `SYSTEM.md`:

```yaml
---
memory: false
---
```

When `memory: false`, the agent:
- Does not get automatic memory injected into its system prompt
- Does not participate in normal conversational memory behavior
- In ordinary interactive sessions, does not get memory tools

System-managed sessions may explicitly grant memory tools to agents with `memory: false` when needed for specialized workflows such as compaction.

This is useful for stateless utility agents where memory would be noise.

---

## 7. Chat commands

### 7.1 Command tree

All commands live under the `memory` namespace, following the existing hierarchical convention (no top-level shortcuts).

```
memory
├── show [scope]         — Show memory entries (default: current agent)
├── search <query>       — Search memory across all scopes
├── remember <text>      — Save to current agent's memory
├── forget <id>          — Archive a memory entry
├── export [scope]       — Export memory as markdown
├── stats                — Entry counts and sizes per scope
├── compact [scope]      — Trigger manual compaction
└── reindex              — Regenerate embeddings for all entries
```

### 7.1.1 Command scope syntax

Commands that accept a scope use a user-facing syntax:

- `agent` — the current agent's scope
- `agent:<name>` — a specific agent scope
- `global` — the shared global scope
- `user` — the default user scope (`user:default`)
- `user:default` — explicit form of the default user scope

Internally, scopes are stored as `agent:<name>`, `global`, and `user:<id>`.

### 7.2 `!memory show [scope]`

Shows active memory entries for the specified scope (defaults to the current agent).

```
**Memory: agent:writer** (12 entries)

1. `mem_a1b2...` User prefers concise responses [preferences] (Mar 20)
2. `mem_c3d4...` Blog posts should use AP style [writing, style] (Mar 15)
3. `mem_e5f6...` Always suggest outlines before full drafts [workflow] (Mar 18)
...
```

### 7.3 `!memory search <query>`

Searches across all scopes the current agent has access to. Uses hybrid keyword + semantic search when embeddings are enabled and available, and keyword-only search otherwise.

```
**Memory search: "coding style"** (3 results)

1. [agent:writer] `mem_a1b2...` User prefers Python over TypeScript (0.87)
2. [global] `mem_g7h8...` Code examples should use 2-space indent (0.82)
3. [user:default] `mem_i9j0...` Prefers dark mode screenshots (0.71)
```

### 7.4 `!memory remember <text>`

Saves a memory entry to the current agent's scope with source `user`.

```
> !memory remember The deploy key is stored in 1Password under "Production SSH"

Saved to agent:writer memory: `mem_k1l2...`
```

### 7.5 `!memory forget <id>`

Archives a memory entry (soft delete). Accepts a full ID or a unique short prefix.

If the prefix matches multiple entries, the command does not choose one automatically. It returns a disambiguation message listing matching IDs so the user can retry with a longer prefix.

```
> !memory forget mem_a1b2

Archived: "User prefers concise responses"
```

### 7.6 `!memory export [scope]`

Exports memory as markdown. Posts the content inline for short exports, or writes to a file and reports the path for larger exports.

### 7.7 `!memory stats`

```
**Memory Stats**

Total: 47 entries (42 active, 3 archived, 2 compacted)

By scope:
  agent:default        8 entries
  agent:writer        15 entries
  agent:pug-claw-mgr   6 entries
  global               10 entries
  user:default          8 entries

Embeddings: enabled (all-MiniLM-L6-v2, 47/47 indexed)
```

### 7.8 `!memory compact [scope]`

Triggers a manual compaction run for the specified scope (or all scopes). Uses the same compaction logic as the background cron job. See section 8 for compaction details.

### 7.9 `!memory reindex`

Regenerates embeddings for all memory entries. Useful after enabling embeddings or changing the embedding model.

---

## 8. Compaction

### 8.1 Overview

Compaction is an agent-driven process that reviews memory entries and produces a cleaner, more useful memory set. It can be triggered two ways:

- **Background**: Nightly scheduled run via the existing cron/scheduler system
- **Real-time**: Manual trigger via `!memory compact`

Both use the same compaction logic.

### 8.2 What compaction does

The compaction agent has **full CRUD** over memory entries:

1. **Merge duplicates**: Combine entries that say the same thing in different ways
2. **Resolve contradictions**: When entries conflict, keep the most recent or create a reconciled entry
3. **Summarize clusters**: Group related entries and produce a concise summary
4. **Archive stale entries**: Mark entries that are clearly outdated
5. **Rewrite for clarity**: Improve entry wording for better retrieval
6. **Delete redundant entries**: Remove entries fully subsumed by a summary

### 8.3 Compaction agent

Compaction uses a fresh agent session with a specialized built-in agent (`memory-compactor`). The compaction flow:

1. Retrieves all active entries for the target scope(s)
2. Passes them to the compaction agent as part of its prompt
3. The agent analyzes entries and uses memory tools (SaveMemory, UpdateMemory, DeleteMemory) to make changes
4. Each original entry that gets merged is marked `compacted`
5. New summary entries are created with source `compaction`

### 8.4 Compaction schedule

Configured as a standard pug-claw schedule in `config.json`:

```json
{
  "schedules": {
    "memory-compact": {
      "description": "Nightly memory compaction",
      "cron": "0 3 * * *",
      "agent": "memory-compactor",
      "prompt": "Review and compact all memory scopes. Merge duplicates, resolve contradictions, archive stale entries, and improve clarity.",
      "enabled": true
    }
  }
}
```

### 8.5 Real-time vs background

| Aspect | Real-time (during conversations) | Background (compaction) |
|--------|----------------------------------|------------------------|
| When | During conversations, on every turn | Nightly cron or manual `!memory compact` |
| Who writes | Any agent or user | Dedicated compaction agent |
| Operations | Save, update, delete individual entries | Merge, summarize, archive, rewrite batches |
| Goal | Capture new knowledge | Maintain quality and reduce noise |

---

## 9. Configuration

### 9.1 Config schema

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

### 9.2 Config fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `memory.enabled` | boolean | `true` | Master switch for the memory system |
| `memory.injection_budget_tokens` | number | `2000` | Max tokens for system prompt memory injection |
| `memory.embeddings.enabled` | boolean | `false` | Enable semantic search via local embeddings |
| `memory.embeddings.model` | string | `"Xenova/all-MiniLM-L6-v2"` | HuggingFace model ID for embeddings |

---

## 10. Prerequisite refactoring

Before implementing memory, one targeted refactor is recommended. It reduces the scope and risk of the memory implementation itself.

### 10.1 Extract unified system prompt builder

**Problem**: System prompt construction is currently **duplicated across both drivers**. `resolveClaudeSessionOptions()` (`src/drivers/claude.ts:28-59`) and `buildPiSystemPrompt()` in the Pi driver independently perform the same pipeline:

```
base systemPrompt → +skills catalog → +environment block
```

Memory adds another step to this pipeline. Without a refactor, memory injection logic must be added to both drivers independently — same code in two places with inconsistency risk.

**Solution**: Extract a `buildFinalSystemPrompt()` function into a new `src/prompt.ts`:

```typescript
function buildFinalSystemPrompt(base: string, options: {
  skills?: SkillSummary[];
  memoryBlock?: string;
  pluginHint?: boolean;
}): string
```

Both drivers call this function instead of rolling their own prompt assembly. Memory injection has exactly one place to live.

**Steps**:

1. Create `src/prompt.ts` with `buildFinalSystemPrompt()`
2. Move `appendSkillCatalog()` and `buildEnvironmentBlock()` from `src/skills.ts` into `src/prompt.ts` (or have `prompt.ts` call them)
3. Update Claude driver's `resolveClaudeSessionOptions()` to use `buildFinalSystemPrompt()`
4. Update Pi driver's `buildPiSystemPrompt()` to use `buildFinalSystemPrompt()`
5. Add `memoryBlock?: string` parameter for memory injection
6. Update tests

This refactor has standalone value (DRY, single responsibility) and should be done in its own PR before memory work begins.

### 10.2 Why other refactors are not prerequisites

- **ChannelHandler**: Memory backend is passed to the `ChannelHandler` constructor alongside `drivers`, following the existing pattern. No structural refactor needed — just add a constructor parameter.
- **ChatCommandActions**: The interface is already designed for extension. Memory actions are added as optional methods, same as `exportBackup` and `listSchedules`. No refactor needed.
- **FrontendContext**: Rather than bloating this with a memory backend, the memory backend is passed to `ChannelHandler` directly and captured in frontend action closures. This follows how scheduler and backup were integrated. No refactor needed.
- **DriverOptions**: An optional `memoryBlock?: string` (pre-rendered string) is simpler than passing a full `MemoryBackend` through the driver interface. The channel handler renders the memory block and passes it as a string. No interface change needed beyond adding the field to `buildFinalSystemPrompt()`.

---

## 11. Technical architecture

### 11.1 New source files

```
src/memory/
├── types.ts           — MemoryEntry, MemoryScope, MemoryBackend interface, EmbeddingProvider interface
├── store.ts           — SQLite backend implementation
├── embeddings.ts      — HuggingFace EmbeddingProvider implementation
├── injection.ts       — System prompt memory injection logic (pure function)
└── tools.ts           — Memory tool definitions and handlers (pure functions over MemoryBackend)

src/prompt.ts          — Unified system prompt builder (prerequisite refactor)

builtins/agents/memory-compactor/
└── SYSTEM.md          — Built-in compaction agent
```

### 11.2 Integration points

#### Constants (`src/constants.ts`)

```typescript
// New in Paths
MODELS_DIR: "models",  // Cache dir for embedding models (under internal/)
```

#### Config schema (`src/resources.ts`)

Add `MemoryConfigSchema`:

```typescript
const EmbeddingsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  model: z.string().optional(),
});

const MemoryConfigSchema = z.object({
  enabled: z.boolean().optional(),
  injection_budget_tokens: z.number().optional(),
  embeddings: EmbeddingsConfigSchema.optional(),
});
```

Add to `ResolvedConfig`:

```typescript
interface ResolvedConfig {
  // ... existing fields ...
  memory: ResolvedMemoryConfig;
}

interface ResolvedMemoryConfig {
  enabled: boolean;
  injectionBudgetTokens: number;
  embeddings: {
    enabled: boolean;
    model: string;
  };
}
```

#### Agent frontmatter (`src/agents.ts`)

Add optional `memory` field to `AgentFrontmatterSchema` and `AgentMeta`:

```typescript
interface AgentMeta {
  // ... existing fields ...
  memory?: boolean;  // Default: true. Set false to disable automatic memory injection and normal conversational memory behavior for this agent.
}
```

#### Session creation (`src/channel-handler.ts`)

Modify `ensureSession()` to:

1. Check if memory is enabled (globally and for this agent)
2. If enabled, call `buildMemoryBlock()` to render the memory summary string
3. Pass the rendered string to the unified prompt builder via `buildFinalSystemPrompt()`

The `MemoryBackend` is passed to `ChannelHandler` as a constructor parameter, alongside the existing `drivers`, `config`, `pluginDirs`, and `resolveAgentFn` parameters.

#### Scheduler integration

The scheduler runner (`src/scheduler/runner.ts`) also creates driver sessions directly. Scheduled runs should use the same final session assembly pipeline as interactive sessions, including optional memory injection and memory tool registration, rather than routing through `ChannelHandler`.

Memory availability for scheduled runs follows the same rules as interactive sessions:

- if global memory is disabled, no memory is injected and no memory tools are registered
- if an agent has `memory: false`, no automatic memory is injected
- memory-enabled agents receive memory tools by default
- system-managed sessions may explicitly grant memory tools when needed

#### Startup (`src/main.ts`)

On startup:

1. Initialize the memory store (create tables if needed, reuse existing runtime DB)
2. If embeddings enabled, initialize the embedding provider (download model on first use). If initialization fails, log a warning and continue in keyword-only mode.
3. Pass the memory backend to `ChannelHandler` constructor
4. Capture memory backend in frontend action closures for chat commands

### 11.3 Memory ID format

Use a prefixed UUID: `mem_<uuid>`

Example: `mem_550e8400-e29b-41d4-a716-446655440000`

### 11.4 Embedding storage and search

Embeddings are stored in a `vec0` virtual table via the `sqlite-vec` extension. Vectors are passed as `Float32Array` buffers. KNN search is handled entirely by `sqlite-vec` using SIMD-accelerated distance computation — no application-level loops.

The `sqlite-vec` npm package (`bun add sqlite-vec`) provides the extension binary and a `load()` function compatible with `bun:sqlite`. It is loaded once during store `init()`.

---

## 12. Design for testability

This section documents the testability decisions made during design. The goal is that every layer of the memory system is independently testable with fast, deterministic tests.

### 12.1 Interface-first design

All major components are defined as interfaces, not concrete classes:

| Interface | Purpose | Test fake |
|-----------|---------|-----------|
| `MemoryBackend` | Storage abstraction | `FakeMemoryBackend` — in-memory array, tracks all calls |
| `EmbeddingProvider` | Embedding generation | `FakeEmbeddingProvider` — returns deterministic vectors |

This mirrors the existing `FakeDriver` pattern in `tests/fakes/fake-driver.ts`. Test fakes are first-class artifacts, not afterthoughts.

### 12.2 Pure functions for hot paths

The two highest-traffic code paths are **pure functions** with no I/O or side effects:

- **`buildMemoryBlock(entries, budgetTokens)`** — takes memory entries and a budget, returns a string. No backend calls, no file access. Trivially unit-testable with fixed inputs.
- **Memory tool handlers** — each handler is a function that takes a `MemoryBackend` and tool arguments, returns a result. No driver coupling. Testable in isolation.

### 12.3 SQLite store uses in-memory DB for tests

The `MemoryStore` (SQLite backend) accepts a database path. Tests pass `":memory:"` for an in-memory database — no temp files, instant setup/teardown. This follows the existing pattern used by `SchedulerStore` in `tests/`.

### 12.4 No globals or singletons

The `MemoryBackend` is **injected** into every consumer (ChannelHandler, tool handlers, chat command actions), never imported as a module-level singleton. This means:

- Tests construct their own backend instances
- No shared mutable state between tests
- No module-level initialization to stub out

### 12.5 Embedding provider is optional and mockable

The `EmbeddingProvider` is a separate interface injected into the `MemoryStore`. Tests that don't care about semantic search pass `null` or a `FakeEmbeddingProvider` that returns fixed 384-dim vectors. This means:

- Unit tests never download a real model
- Semantic search logic is testable with deterministic similarity scores
- Fallback-to-keyword behavior is testable by passing `null`

### 12.6 Test matrix

| Layer | What to test | Test type | Approach |
|-------|-------------|-----------|----------|
| `MemoryStore` | CRUD, list, search, stats, export | Unit | In-memory SQLite (`":memory:"`) |
| `buildMemoryBlock()` | Token budgets, priority ordering, markdown formatting | Unit | Pure function with fixed entry arrays |
| Tool handlers | SaveMemory, SearchMemory, UpdateMemory, DeleteMemory, ListMemory | Unit | `FakeMemoryBackend`, assert calls and return values |
| Chat commands | All `!memory` subcommands | Unit | `FakeMemoryBackend` + existing command registry test patterns |
| sqlite-vec search | KNN ranking correctness | Unit | In-memory SQLite + sqlite-vec loaded, fixed vectors with known distances |
| System prompt injection | Memory block appears in final prompt | Integration | `FakeDriver` + real `MemoryStore`, assert prompt content |
| End-to-end flow | Save → new session → memory in prompt | Integration | Temp dir + real SQLite + `FakeDriver` |
| Embedding fallback | Search works with embeddings enabled, disabled, and initialization failure | Integration | Real `MemoryStore`, `FakeEmbeddingProvider` vs `null` |
| Agent opt-out | `memory: false` in ordinary sessions → no injection, no tools unless explicitly granted | Unit | Mock agent with `memory: false`, assert prompt has no memory block |

### 12.7 FakeMemoryBackend specification

```typescript
class FakeMemoryBackend implements MemoryBackend {
  entries: MemoryEntry[] = [];
  saveCalls: NewMemoryEntry[] = [];
  searchCalls: MemorySearchQuery[] = [];
  // Tracks all method calls for assertions

  // Supports scripted responses:
  searchResults: MemorySearchResult[] = [];  // What search() returns
  saveError?: Error;                          // Inject errors
}
```

This follows the `FakeDriver` pattern: tracks inputs for assertion, supports scripted outputs for controlled testing.

---

## 13. Built-in agents

### 13.1 Memory compactor agent

A new built-in agent at `builtins/agents/memory-compactor/`:

```yaml
---
name: memory-compactor
description: Reviews and compacts memory entries for quality and relevance
allowed-skills: []
memory: false
---
```

The compactor agent sets `memory: false` so it does **not** get automatic memory injection (that would be circular). Its session is created by the platform with explicit access to memory tools, allowing it to list, read, and modify entries. Its system prompt contains detailed instructions for:

- Identifying duplicate entries
- Resolving contradictions (prefer newer, or reconcile)
- Grouping related entries into summaries
- Archiving clearly stale information
- Rewriting unclear entries for better retrieval
- Being conservative — when in doubt, keep the entry

---

## 14. Backup integration

Memory lives in the runtime SQLite DB (`internal/pug-claw.sqlite`), which is already included in backups via `VACUUM INTO`. No additional backup logic is needed.

The `!memory export` command provides human-readable markdown export as a complement — backups preserve the full structured data, exports provide a readable view.

---

## 15. Testing strategy

### 15.1 Unit tests

#### Memory store
- CRUD operations (save, get, update, delete, archive)
- List with filters (scope, status, tags)
- Keyword search returns matching entries
- Shared-scope permission enforcement uses `createdBy`
- `accessedAt` updates on `get`, `list`, and `search`, but not prompt injection
- Stats computation returns correct counts
- Markdown export formatting (tags as sections, entries as bullets)
- Scope validation rejects invalid scope strings
- ID prefix matching for `!memory forget` short IDs
- Ambiguous short IDs return a disambiguation error

#### Embeddings and vector search
- Embedding generation produces correct dimensions
- sqlite-vec KNN search returns entries in correct distance order
- Hybrid search merges keyword and semantic matches correctly
- Graceful fallback when embeddings disabled or initialization fails (returns keyword results)
- Batch embedding processes multiple texts
- Virtual table insert/delete stays in sync with main memories table

#### Injection
- Token budget enforcement (entries truncated to fit)
- Priority ordering (recent access > recent creation > scope)
- Correct markdown formatting with scope headers
- Empty memory produces no injection block
- Agent opt-out (`memory: false`) produces no injection

#### Tool handlers
- SaveMemory creates entry with correct scope resolution (`"agent"` → `"agent:<name>"`)
- SearchMemory searches correct scopes (agent + global + user when scope is `"agent"`)
- UpdateMemory patches entry content and tags
- DeleteMemory archives entry (does not hard-delete)
- Shared-scope update/delete is denied when `createdBy` does not match the current agent
- ListMemory respects scope and limit

#### Chat commands
- All `!memory` subcommands parse arguments correctly
- Scope arguments parse `agent`, `agent:<name>`, `global`, `user`, and `user:default`
- `!memory remember` creates entry with source `user`
- `!memory forget` accepts full ID and unique short prefix
- `!memory forget` returns disambiguation text for ambiguous prefixes
- `!memory show` filters by scope
- `!memory stats` returns formatted output
- Unknown subcommands return help text

### 15.2 Integration tests

#### End-to-end memory flow
- Agent saves memory → memory persists in store → new session sees it in system prompt
- User `!memory remember` → entry created → `!memory show` displays it
- `!memory forget` → entry archived → no longer in system prompt injection
- `!memory search` returns relevant results (keyword and semantic)

#### Compaction
- Compaction agent can list all entries for a scope
- Compaction agent can merge entries (save new + mark old as compacted)
- Compaction is idempotent (running twice on same data produces same result)

#### Embedding integration
- Search with embeddings enabled returns hybrid keyword + semantic results
- Search with embeddings disabled falls back to keyword
- Embedding initialization failure logs and falls back to keyword without failing startup
- `!memory reindex` regenerates all embeddings
- Enabling embeddings on existing entries triggers backfill

#### Prompt builder integration
- `buildFinalSystemPrompt()` correctly orders: base → skills → memory → environment
- Memory block absent when memory disabled
- Memory block absent for agents with `memory: false`
- Scheduled runs receive memory injection and memory tools under the same policy as interactive sessions

### 15.3 Test helpers

- `FakeMemoryBackend` — in-memory implementation tracking all calls (see section 12.7)
- `FakeEmbeddingProvider` — returns deterministic vectors for reproducible similarity scores
- In-memory SQLite via `":memory:"` for store tests
- Existing `FakeDriver`, `noopLogger`, temp dir patterns reused from current test suite

---

## 16. Suggested implementation order

### PR 0: Prerequisite refactor — unified prompt builder

- Create `src/prompt.ts` with `buildFinalSystemPrompt()`
- Move prompt assembly out of Claude and Pi drivers
- Both drivers call `buildFinalSystemPrompt()` instead of rolling their own
- Update driver tests
- **No functional changes** — pure refactor

### PR 1: Memory store and types

- `src/memory/types.ts` — all type definitions (MemoryEntry, MemoryBackend, EmbeddingProvider, etc.)
- `src/memory/store.ts` — SQLite backend implementation
- Config schema additions (`memory` section in `resources.ts`)
- DB table creation in store init
- Agent frontmatter `memory` field in `agents.ts`
- Unit tests for store CRUD, list, keyword search, stats, export

### PR 2: System prompt injection

- `src/memory/injection.ts` — `buildMemoryBlock()` pure function
- Integration with `src/prompt.ts` (`buildFinalSystemPrompt()` gains `memoryBlock` parameter)
- Integration with `src/channel-handler.ts` (`ensureSession()` builds and passes memory block)
- Integration with `src/scheduler/runner.ts` (scheduled runs use the same memory injection policy)
- Pass `MemoryBackend` to `ChannelHandler` constructor
- Token budget enforcement
- Memory initialization in `src/main.ts`
- Unit tests for injection logic
- Integration test: memory appears in agent system prompt via `FakeDriver`

### PR 3: Agent memory tools

- `src/memory/tools.ts` — tool definitions and handlers
- Claude driver integration (register memory tools in session)
- Pi driver integration
- Shared-scope permission enforcement using `createdBy`
- System prompt instructions for memory tool usage
- Unit tests for tool handlers with `FakeMemoryBackend`
- Integration test: agent can save/search/update/delete memory

### PR 4: Chat commands

- `!memory show`, `!memory search`, `!memory remember`, `!memory forget`, `!memory export`, `!memory stats`
- Updates to `src/chat-commands/tree.ts` and `src/chat-commands/types.ts`
- Frontend action wiring in Discord and TUI frontends
- Tests for all commands following existing command registry test patterns

### PR 5: Embeddings and vector search (optional semantic search)

- `src/memory/embeddings.ts` — `EmbeddingProvider` interface + `@huggingface/transformers` implementation
- `sqlite-vec` extension loading and `memory_embeddings` virtual table creation
- Embedding generation on save/update, insert into virtual table
- Semantic search via `sqlite-vec` KNN query in store `search()` method
- `!memory reindex` command (regenerate embeddings + rebuild virtual table)
- Config: `memory.embeddings.enabled`, `memory.embeddings.model`
- Unit tests with `FakeEmbeddingProvider` + in-memory SQLite with sqlite-vec loaded
- Integration tests for semantic vs keyword fallback

### PR 6: Compaction and built-in agent

- `builtins/agents/memory-compactor/SYSTEM.md` — compactor agent
- `!memory compact` command implementation
- Example schedule config for nightly compaction in docs
- Integration tests for compaction flow
- Documentation updates

---

## 17. Future considerations

### Multi-user memory

When user identity is implemented (Phase 0 roadmap item), memory scopes expand:

- `user:default` → `user:<user_id>`
- Agents see memory for the current user
- Cross-user memory requires explicit sharing

### Additional backends

The `MemoryBackend` interface supports future implementations:

- **PostgreSQL** — for production deployments with multiple instances
- **File-based** — markdown files on disk for git-friendly workflows
- **Remote API** — for centralized memory services

### Vector search scaling

`sqlite-vec` handles v1 scale well. For very large memory stores (> 100K entries), options include:

- `sqlite-vec` ANN (DiskANN) support (in development upstream)
- Dedicated vector DB (Pinecone, Qdrant, etc.) via a new `MemoryBackend` implementation

### Memory-aware routing

Route messages to the agent whose memory is most relevant to the query. Requires semantic search across all agent memories.

---

## 18. Final one-line product statement

`pug-claw` memory v1 gives agents and the platform persistent, structured knowledge across sessions — with pluggable backends, optional semantic search, autonomous agent learning, user chat commands, and background compaction to keep memory clean and relevant.
