# Backup & Restore v1 — PRD + Technical Design

## Status

Draft — awaiting review.

---

## 1. Summary

Add backup and restore capabilities to `pug-claw`:

1. **Directory refactor**: Split the current monolithic `~/.pug-claw/` layout into clearly separated concerns — user config, internal runtime state, user workspace data, and logs.
2. **Export/import commands**: Produce a single compressed backup artifact from configurable directories, and restore from it.
3. **Chat command**: Trigger backups via `!backup export` from Discord/TUI.

This is a **two-phase** effort:

- **Phase A**: Directory refactor (prerequisite, standalone value)
- **Phase B**: Backup/restore feature

---

## 2. Product goals

### Goals

- Clean separation between user content, pug-claw internals, and user workspace data
- Single-command backup of all important state into a portable archive
- Restore from backup on a fresh machine or after data loss
- Configurable inclusion of workspace directories (data, code, logs)
- Versioned backup format that survives future schema changes
- Chat command for convenience (`!backup export`)

### Non-goals for v1

- No incremental/differential backups
- No automated scheduled backups (can be done via system cron or a pug-claw schedule)
- No remote backup targets (S3, etc.)
- No encryption of the backup archive
- No secrets in backups — `.env` is **always** excluded
- No backup of in-flight session state (sessions are ephemeral today)
- No interactive restore (full overwrite or nothing)
- No `!backup import` via chat (import is a CLI-only operation — requires process restart)

---

## 3. Directory refactor

### 3.1 Current layout

Everything lives under `PUG_CLAW_HOME` (`~/.pug-claw/`):

```
~/.pug-claw/
├── config.json
├── config.last-good.json
├── .env
├── agents/
├── skills/
├── plugins/           # auto-generated, regeneratable
├── data/
│   ├── pug-claw.sqlite
│   └── locks/
└── logs/
```

Problems:

- `data/` mixes pug-claw runtime state (`pug-claw.sqlite`, `locks/`) with user workspace data (custom DBs, files created by agents)
- `plugins/` is regeneratable but lives alongside precious user content
- No recognized location for agent-generated code projects
- Unclear what to back up vs. skip

### 3.2 Proposed layout

```
~/.pug-claw/                          # PUG_CLAW_HOME — user config and content
├── config.json
├── config.last-good.json
├── .env
├── agents/
├── skills/
│
├── internal/                         # PUG_CLAW_INTERNAL_DIR — pug-claw runtime
│   ├── pug-claw.sqlite
│   ├── locks/
│   └── plugins/
│
├── data/                             # PUG_CLAW_DATA_DIR — user workspace data
│   └── (user/agent-created files, DBs, etc.)
│
├── code/                             # PUG_CLAW_CODE_DIR — agent-generated code
│   └── (code projects created by agents)
│
└── logs/                             # PUG_CLAW_LOGS_DIR — all logs
    ├── system/
    └── schedules/
```

### 3.3 New environment variables and config paths

| Env var | Config key | Default (relative to HOME) | Purpose |
|---------|-----------|---------------------------|---------|
| `PUG_CLAW_HOME` | `--home` | `~/.pug-claw` | Root config directory |
| `PUG_CLAW_INTERNAL_DIR` | `paths.internal_dir` | `internal` | Pug-claw runtime state |
| `PUG_CLAW_DATA_DIR` | `paths.data_dir` | `data` | User workspace data |
| `PUG_CLAW_CODE_DIR` | `paths.code_dir` | `code` | Agent-generated code |
| `PUG_CLAW_LOGS_DIR` | `paths.logs_dir` | `logs` | All logs |
| `PUG_CLAW_AGENTS_DIR` | `paths.agents_dir` | `agents` | Agents (unchanged) |
| `PUG_CLAW_SKILLS_DIR` | `paths.skills_dir` | `skills` | Skills (unchanged) |

Resolution precedence is unchanged: CLI flag > env var > config file > default.

### 3.4 What moves where

| Current location | New location | Notes |
|-----------------|-------------|-------|
| `data/pug-claw.sqlite` | `internal/pug-claw.sqlite` | Runtime DB |
| `data/locks/` | `internal/locks/` | Scheduler lock |
| `plugins/` | `internal/plugins/` | Auto-generated |
| `data/` (user files) | `data/` | Stays, but now exclusively user workspace |
| `logs/` | `logs/` | Unchanged path, now has its own env var and config key |

### 3.5 Migration

On startup, if the old layout is detected (e.g., `data/pug-claw.sqlite` exists and `internal/` does not):

- Automatically migrate: create `internal/`, move runtime files
- Log the migration
- Do **not** move any user files from `data/` — they stay

`pug-claw init` should create all new directories.

### 3.6 Config schema changes

```typescript
const PathsConfigSchema = z.object({
  agents_dir: z.string().optional(),
  skills_dir: z.string().optional(),
  internal_dir: z.string().optional(),  // NEW
  data_dir: z.string().optional(),
  code_dir: z.string().optional(),      // NEW
  logs_dir: z.string().optional(),      // NEW (was only env var before)
});
```

`ResolvedConfig` gains:

```typescript
interface ResolvedConfig {
  // existing
  homeDir: string;
  agentsDir: string;
  skillsDir: string;
  dataDir: string;
  logsDir: string;
  // new
  internalDir: string;
  codeDir: string;
}
```

### 3.7 Constants changes

```typescript
// New in Paths
INTERNAL_DIR: "internal",
CODE_DIR: "code",

// New in EnvVars
INTERNAL_DIR: "PUG_CLAW_INTERNAL_DIR",
CODE_DIR: "PUG_CLAW_CODE_DIR",
```

`RUNTIME_DB_FILE`, `LOCKS_DIR`, `SCHEDULER_LOCK_DIR`, and `PLUGINS_DIR` remain as relative names — their parent changes from `dataDir` to `internalDir`.

---

## 4. Backup format

### 4.1 Archive structure

A `.tar.gz` file with a top-level `pug-claw-backup/` directory:

```
pug-claw-backup/
├── manifest.json
├── home/
│   ├── config.json
│   ├── config.last-good.json
│   ├── agents/
│   └── skills/
├── internal/
│   └── pug-claw.sqlite
├── data/                        # only if data_dir in backup.include_dirs
│   └── ...
├── code/                        # only if code_dir in backup.include_dirs
│   └── ...
└── logs/                        # only if logs_dir in backup.include_dirs
    └── ...
```

### 4.2 Manifest

```json
{
  "format_version": "1",
  "pug_claw_version": "0.1.0",
  "created_at": "2026-03-21T14:30:00Z",
  "hostname": "my-server",
  "sections": {
    "home": { "included": true },
    "internal": { "included": true },
    "data": { "included": true },
    "code": { "included": false },
    "logs": { "included": false }
  },
}

```

`format_version` is a simple integer string. Bumped when the archive structure changes in a backward-incompatible way.

### 4.3 What is always included

- `config.json` and `config.last-good.json`
- All agents (both user-created and builtins)
- All skills (both user-created and builtins)
- `pug-claw.sqlite` (schedule run history)

### 4.4 What is always excluded

- `.env` (secrets) — **never** included in any backup
- `internal/locks/` — ephemeral runtime state
- `internal/plugins/` — regeneratable on startup

### 4.5 What is excluded by default (opt-in)

- `data/` contents — opt-in via config or `--include data`
- `code/` contents — opt-in via config or `--include code`
- `logs/` contents — opt-in via config or `--include logs`

### 4.6 Configurable backup directories

Users declare which workspace directories to include in backups:

```json
{
  "backup": {
    "include_dirs": ["data_dir", "code_dir"]
  }
}
```

Values are keys from the `paths` config. CLI `--include` flags override/extend this.

---

## 5. CLI commands

### 5.1 `pug-claw export`

```
pug-claw export [options]

Options:
  --output <path>         Output file path (default: ./pug-claw-backup-{timestamp}.tar.gz)
  --include <dir>         Include optional directory (repeatable: data, code, logs)
  --home <path>           Override PUG_CLAW_HOME
```

Behavior:

- Resolves config to find all directory paths
- Builds archive from resolved paths
- Writes manifest
- Prints summary: what was included, archive size, output path

### 5.2 `pug-claw import`

```
pug-claw import <path> [options]

Options:
  --home <path>           Override PUG_CLAW_HOME (target directory)
  --dry-run               Show what would be restored without writing
  --force                 Overwrite existing files without prompting
```

Behavior:

1. Read and validate manifest
2. Check `format_version` compatibility
3. Show summary of what will be restored
4. Prompt for confirmation (unless `--force`)
5. Restore files to target directories
6. Run `init --builtins-only` to ensure builtins are current
7. Print summary

### 5.3 Import safety

- Import requires pug-claw to **not** be running (check for scheduler lock, warn if found)
- If target directories already contain files, prompt before overwriting (unless `--force`)
- On format version mismatch: refuse with a clear error and suggest upgrading pug-claw

---

## 6. Chat commands

### 6.1 Command tree

```
backup
├── export          — Create a backup archive
└── dryrun          — Show what a backup would include and approximate size
```

### 6.2 `!backup export`

- Creates a backup using the same logic as `pug-claw export`
- Uses config defaults for which directories to include
- Outputs the file path where the archive was written
- On Discord: posts the file path (does not upload the archive — it may be too large)

### 6.3 `!backup dryrun`

Shows what a backup would include without creating the archive:

- All configured directory paths and whether each would be included
- Approximate size of each included directory
- Total estimated archive size

---

## 7. Versioning strategy

### 7.1 Backup format version

- Simple integer: `"1"`, `"2"`, etc.
- Stored in `manifest.json` as `format_version`
- Bumped when the archive structure changes incompatibly
- Import checks this first and refuses unknown versions

### 7.2 Pug-claw version

- `manifest.json` records `pug_claw_version` from `VERSION` constant
- Informational — not used for compatibility checks in v1
- Enables future migration logic if needed

### 7.3 Config schema version

- Not adding an explicit schema version field to `config.json` in v1
- Zod validation already catches incompatibilities
- Import validates config against current schema after restore

---

## 8. Technical architecture

### 8.1 New source files

#### Phase A (directory refactor)

- Changes to `src/constants.ts` — new path and env var constants
- Changes to `src/resources.ts` — new config schema fields, resolution for `internalDir` and `codeDir`
- Changes to `src/commands/init.ts` — create new directories, migration logic
- Changes to `src/scheduler/runtime.ts` — use `internalDir` instead of `dataDir`
- Changes to `src/main.ts` — export all resolved paths as env vars. After this change, `startFrontend()` must set every resolved directory path into `process.env`:
  - `PUG_CLAW_HOME` (already exported)
  - `PUG_CLAW_AGENTS_DIR` (already exported)
  - `PUG_CLAW_SKILLS_DIR` (already exported)
  - `PUG_CLAW_DATA_DIR` (already exported)
  - `PUG_CLAW_LOGS_DIR` (already exported)
  - `PUG_CLAW_INTERNAL_DIR` (new)
  - `PUG_CLAW_CODE_DIR` (new)

#### Phase B (backup/restore)

- `src/backup/types.ts` — manifest schema, backup options types
- `src/backup/manifest.ts` — manifest creation and validation
- `src/backup/export.ts` — archive creation logic
- `src/backup/import.ts` — archive extraction and restore logic
- `src/commands/export.ts` — CLI command registration
- `src/commands/import.ts` — CLI command registration
- Changes to `src/chat-commands/tree.ts` — `backup` command group

### 8.2 Archive creation

Use Node.js built-in `node:zlib` for gzip and a tar library (or `tar` npm package) for archive creation.

Steps:

1. Resolve all directory paths from config
2. Determine inclusion set (config defaults + CLI overrides)
3. Create temporary staging directory
4. Copy included files with relative paths preserved
5. Generate `manifest.json`
6. Create `.tar.gz` from staging directory
7. Clean up staging directory
8. Report summary

### 8.3 SQLite backup safety

Do **not** copy `pug-claw.sqlite` directly — it may be in use with WAL mode.

Use SQLite's `VACUUM INTO` or the `.backup` API:

```typescript
import { Database } from "bun:sqlite";

const db = new Database(sourcePath, { readonly: true });
const backupPath = resolve(stagingDir, "internal", Paths.RUNTIME_DB_FILE);
db.run(`VACUUM INTO '${backupPath}'`);
db.close();
```

This produces a self-contained copy safe for archiving.

### 8.4 Migration logic (Phase A)

In `src/commands/init.ts` or a new `src/migration.ts`:

```typescript
function migrateToInternalDir(homeDir: string, internalDir: string): void {
  const oldDbPath = resolve(homeDir, "data", Paths.RUNTIME_DB_FILE);
  const oldLocksDir = resolve(homeDir, "data", Paths.LOCKS_DIR);
  const oldPluginsDir = resolve(homeDir, Paths.PLUGINS_DIR);

  if (existsSync(oldDbPath) && !existsSync(resolve(internalDir, Paths.RUNTIME_DB_FILE))) {
    mkdirSync(internalDir, { recursive: true });
    renameSync(oldDbPath, resolve(internalDir, Paths.RUNTIME_DB_FILE));
    logger.info({ from: oldDbPath, to: internalDir }, "migrated_runtime_db");
  }
  // Similar for locks and plugins
}
```

Called at startup in `main.ts`, before any runtime components initialize.

---

## 9. Testing strategy

### 9.1 Unit tests

#### Directory refactor

- `resolveConfigPaths` returns correct `internalDir` and `codeDir`
- Env var override works for `PUG_CLAW_INTERNAL_DIR`, `PUG_CLAW_CODE_DIR`
- Config file override works for `paths.internal_dir`, `paths.code_dir`, `paths.logs_dir`
- Default paths resolve relative to `homeDir`

#### Backup

- Manifest generation includes correct sections and metadata
- Format version validation rejects unknown versions
- Inclusion logic respects config + CLI overrides
- Secrets are never included

### 9.2 Integration tests

#### Directory refactor

- `init` creates all expected directories
- Migration moves files from old layout to new layout
- Migration is idempotent (running twice is safe)
- Scheduler runtime uses `internalDir` for DB and locks

#### Backup

- Export creates valid `.tar.gz` with expected structure
- Export never includes `.env`
- Export without optional dirs excludes them
- Import restores files to correct locations
- Import with `--dry-run` makes no changes
- Import refuses on format version mismatch
- Round-trip: export then import produces identical state

### 9.3 Test helpers

- Temporary home directory with known file structure
- Helper to create a minimal valid backup archive for import tests

---

## 10. Suggested implementation order

### PR 1: Constants and config schema (Phase A)

- Add `INTERNAL_DIR`, `CODE_DIR` to `Paths` and `EnvVars`
- Add `internal_dir`, `code_dir`, `logs_dir` to `PathsConfigSchema`
- Add `internalDir`, `codeDir` to `ResolvedConfig` and `ResolvedConfigPaths`
- Update `resolveConfigPaths` to resolve new paths
- Update tests

### PR 2: Runtime migration (Phase A)

- Move SQLite DB, locks, and plugins to `internalDir`
- Update `scheduler/runtime.ts` to use `internalDir`
- Update `init` to create new directories
- Add migration logic for existing installations
- Update `main.ts` to export new env vars
- Update tests

### PR 3: Backup export (Phase B)

- `src/backup/` module (types, manifest, export)
- `pug-claw export` CLI command
- Configurable `backup.include_dirs` in config schema
- SQLite safe copy via `VACUUM INTO`
- Tests

### PR 4: Backup import (Phase B)

- `src/backup/import.ts`
- `pug-claw import` CLI command
- Format version validation
- Dry-run support
- Confirmation prompts
- Tests

### PR 5: Chat commands and polish (Phase B)

- `!backup export` and `!backup dryrun` chat commands
- Docs updates
- Roadmap updates


---

## 12. Final one-line product statement

`pug-claw` backup v1 separates runtime internals from user workspace data, then provides single-command export/import of all important state into a versioned, compressed archive with configurable directory inclusion.
