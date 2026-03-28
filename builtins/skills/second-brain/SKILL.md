---
name: second-brain
description: CRUD and search (keyword + semantic) for a git-backed markdown vault
metadata:
  managed-by: pug-claw
---

# Second Brain

Read, create, update, move, and search notes in a git-backed Obsidian vault organized with the PARA method.

## Prerequisites

- `SECOND_BRAIN_VAULT_PATH` must be set — absolute path to a local git clone of the vault
- `SECOND_BRAIN_INDEX_PATH` (optional) — where to store the semantic search index. Defaults to `~/.pug-claw/data/brain-index/`
- `rg` (ripgrep) must be installed for keyword search
- `uv` must be installed to run the script

## Usage

Run commands using `uv run` with the script at `./scripts/brain.py` (relative to this skill's directory):

```bash
uv run ./scripts/brain.py <command> [options]
```

All commands output JSON with `success` (boolean) and `data` or `error` fields.

## PARA Method

The vault is organized into four top-level directories:

| Directory | Purpose | Examples |
|-----------|---------|---------|
| `projects/` | Short-term efforts with a deadline and specific outcome | "launch-website", "plan-vacation" |
| `areas/` | Ongoing responsibilities with standards to maintain | "health", "finances", "career" |
| `resources/` | Topics of interest for future reference | "kubernetes", "cooking", "book-notes" |
| `archives/` | Inactive items moved from the other three categories | Completed projects, retired areas |

When creating or moving notes, choose the PARA category based on:
- **Is it time-bound with a clear end state?** → `projects/`
- **Is it an ongoing responsibility?** → `areas/`
- **Is it reference material or a topic of interest?** → `resources/`
- **Is it no longer active?** → `archives/`

## Frontmatter Convention

All notes use YAML frontmatter:

```yaml
---
id: note-identifier
aliases: []
tags: []
---
```

- `id` — unique identifier, defaults to the filename stem
- `aliases` — alternative names for the note
- `tags` — categorization tags

Always provide `--id`, `--aliases`, and `--tags` when creating notes.

## Commands

### search

Search notes by keyword (ripgrep), semantic similarity (ChromaDB), or both.

```bash
uv run ./scripts/brain.py search "query" --mode keyword    # default, exact/keyword match
uv run ./scripts/brain.py search "query" --mode semantic   # vector similarity search
uv run ./scripts/brain.py search "query" --mode hybrid     # both combined
uv run ./scripts/brain.py search "query" --limit 5         # limit results
```

- Use `keyword` when you know the exact words
- Use `semantic` when you know the concept but not the wording
- Use `hybrid` for broad exploration
- Semantic search requires running `index` first

### read

Read a note's content by its path (relative to vault root).

```bash
uv run ./scripts/brain.py read "resources/kubernetes.md"
```

### list

List notes, optionally filtered to a PARA category or subdirectory.

```bash
uv run ./scripts/brain.py list                    # all notes
uv run ./scripts/brain.py list "projects"         # just projects
uv run ./scripts/brain.py list "areas/health"     # specific subdirectory
```

### create

Create a new note with frontmatter.

```bash
uv run ./scripts/brain.py create "resources/kubernetes-networking.md" \
  --content "Notes on K8s networking..." \
  --id "kubernetes-networking" \
  --aliases "k8s-networking" \
  --tags "kubernetes" --tags "networking"
```

If `--content` is omitted, reads body from stdin.

### update

Update a note's body, preserving existing frontmatter.

```bash
uv run ./scripts/brain.py update "resources/kubernetes.md" \
  --content "Updated content here..."
```

If `--content` is omitted, reads new body from stdin.

### move

Move a note between locations (e.g., project completed → archive).

```bash
uv run ./scripts/brain.py move "projects/launch-website.md" "archives/launch-website.md"
```

### index

Build or update the semantic search index.

```bash
uv run ./scripts/brain.py index                  # full rebuild
uv run ./scripts/brain.py index --incremental    # only changed files
```

Run `index` after creating, updating, or syncing notes to keep semantic search current. Use `--incremental` for routine updates.

### sync

Pull latest changes, commit local changes, and push.

```bash
uv run ./scripts/brain.py sync
uv run ./scripts/brain.py sync --message "add kubernetes notes"
```

## Workflow Guidelines

- After `create`, `update`, or `move` — call `sync` to push changes
- After `sync` (which may pull new notes) — call `index --incremental` to update semantic search
- Before `search --mode semantic` — ensure the index is up to date
- When a project is completed — use `move` to relocate it to `archives/`
