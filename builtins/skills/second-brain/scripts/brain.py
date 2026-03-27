# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "chromadb",
#   "sentence-transformers",
#   "typer",
#   "pyyaml",
# ]
# ///
"""Second brain CLI — CRUD and search for a git-backed markdown vault."""

import hashlib
import json
import os
import subprocess
import sys
from enum import Enum
from pathlib import Path
from typing import Optional

import typer
import yaml

app = typer.Typer(pretty_exceptions_enable=False)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


def get_vault_path() -> Path:
    raw = os.environ.get("SECOND_BRAIN_VAULT_PATH")
    if not raw:
        _fail("SECOND_BRAIN_VAULT_PATH not set")
    p = Path(raw).expanduser().resolve()
    if not p.is_dir():
        _fail(f"Vault path does not exist: {p}")
    return p


def get_index_path() -> Path:
    raw = os.environ.get("SECOND_BRAIN_INDEX_PATH")
    if raw:
        return Path(raw).expanduser().resolve()
    return Path.home() / ".pug-claw" / "data" / "brain-index"


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------


def _ok(data: object) -> None:
    print(json.dumps({"success": True, "data": data}, indent=2, default=str))


def _fail(message: str) -> None:
    print(json.dumps({"success": False, "error": message}, indent=2))
    raise typer.Exit(1)


# ---------------------------------------------------------------------------
# Frontmatter
# ---------------------------------------------------------------------------


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter. Returns (metadata, body)."""
    if not content.startswith("---"):
        return {}, content
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content
    try:
        meta = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        meta = {}
    body = parts[2].lstrip("\n")
    return meta, body


def build_frontmatter(
    note_id: str,
    aliases: list[str] | None = None,
    tags: list[str] | None = None,
) -> str:
    meta = {"id": note_id, "aliases": aliases or [], "tags": tags or []}
    return "---\n" + yaml.dump(meta, sort_keys=False) + "---\n"


# ---------------------------------------------------------------------------
# File iteration (skip hidden dirs like .git, .obsidian)
# ---------------------------------------------------------------------------


def iter_notes(vault: Path) -> list[Path]:
    """List markdown files tracked by git (respects .gitignore)."""
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=vault,
        capture_output=True,
        text=True,
    )
    notes = []
    for entry in result.stdout.split("\0"):
        if not entry or not entry.endswith(".md"):
            continue
        p = vault / entry
        if p.is_file():
            notes.append(p)
    return sorted(notes)


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def chunk_markdown(content: str, source_file: str) -> list[dict]:
    """Split markdown into chunks on ``## `` headings."""
    lines = content.split("\n")
    chunks: list[dict] = []
    heading = "(preamble)"
    current: list[str] = []

    for line in lines:
        if line.startswith("## "):
            if current:
                text = "\n".join(current).strip()
                if text:
                    chunks.append(
                        {"text": text, "source_file": source_file, "heading": heading}
                    )
            heading = line.lstrip("# ").strip()
            current = [line]
        else:
            current.append(line)

    if current:
        text = "\n".join(current).strip()
        if text:
            chunks.append(
                {"text": text, "source_file": source_file, "heading": heading}
            )

    return chunks


def file_hash(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


# ---------------------------------------------------------------------------
# ChromaDB (lazy import — only loaded for semantic operations)
# ---------------------------------------------------------------------------


def _get_collection():  # noqa: ANN202
    import chromadb
    from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

    index_path = get_index_path()
    index_path.mkdir(parents=True, exist_ok=True)

    client = chromadb.PersistentClient(path=str(index_path / "chromadb"))
    ef = SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")
    return client.get_or_create_collection(name="second-brain", embedding_function=ef)


def _load_manifest() -> dict:
    manifest_file = get_index_path() / "manifest.json"
    if manifest_file.exists():
        return json.loads(manifest_file.read_text())
    return {}


def _save_manifest(manifest: dict) -> None:
    index_path = get_index_path()
    index_path.mkdir(parents=True, exist_ok=True)
    (index_path / "manifest.json").write_text(json.dumps(manifest, indent=2))


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


class SearchMode(str, Enum):
    keyword = "keyword"
    semantic = "semantic"
    hybrid = "hybrid"


@app.command()
def search(
    query: str = typer.Argument(..., help="Search query"),
    mode: SearchMode = typer.Option(SearchMode.keyword, help="Search mode"),
    limit: int = typer.Option(10, help="Max results"),
) -> None:
    """Search notes by keyword, semantic similarity, or both."""
    vault = get_vault_path()
    results: list[dict] = []

    if mode in (SearchMode.keyword, SearchMode.hybrid):
        results.extend(_keyword_search(vault, query))

    if mode in (SearchMode.semantic, SearchMode.hybrid):
        results.extend(_semantic_search(query, limit))

    _ok(results[:limit])


def _keyword_search(vault: Path, query: str) -> list[dict]:
    try:
        proc = subprocess.run(
            ["rg", "--json", "--max-count", "3", "--ignore-case", query, str(vault)],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        _fail("ripgrep (rg) not found — install it to use keyword search")

    seen: dict[str, dict] = {}
    for line in proc.stdout.strip().split("\n"):
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("type") != "match":
            continue
        data = entry["data"]
        file_path = data["path"]["text"]
        try:
            rel = str(Path(file_path).relative_to(vault))
        except ValueError:
            continue
        # Skip hidden dirs
        if any(part.startswith(".") for part in Path(rel).parts):
            continue
        line_text = data["lines"]["text"].strip()
        if rel not in seen:
            seen[rel] = {"file": rel, "matches": [], "source": "keyword"}
        seen[rel]["matches"].append(
            {"line": data["line_number"], "text": line_text}
        )
    return list(seen.values())


def _semantic_search(query: str, limit: int) -> list[dict]:
    collection = _get_collection()
    if collection.count() == 0:
        _fail("Semantic index is empty. Run 'index' first.")

    qr = collection.query(query_texts=[query], n_results=limit)
    results: list[dict] = []
    for i, doc_id in enumerate(qr["ids"][0]):
        meta = qr["metadatas"][0][i]
        dist = qr["distances"][0][i] if qr["distances"] else None
        snippet = (qr["documents"][0][i] or "")[:200] if qr["documents"] else ""
        results.append(
            {
                "file": meta["source_file"],
                "heading": meta.get("heading", ""),
                "snippet": snippet,
                "distance": round(dist, 4) if dist is not None else None,
                "source": "semantic",
            }
        )
    return results


# ---------------------------------------------------------------------------


@app.command()
def read(
    path: str = typer.Argument(..., help="Relative path to note"),
) -> None:
    """Read a note's content."""
    vault = get_vault_path()
    fp = vault / path
    if not fp.is_file():
        _fail(f"Note not found: {path}")
    content = fp.read_text()
    meta, body = parse_frontmatter(content)
    _ok({"path": path, "frontmatter": meta, "body": body, "raw": content})


# ---------------------------------------------------------------------------


@app.command("list")
def list_notes(
    directory: Optional[str] = typer.Argument(None, help="Subdirectory to list"),
) -> None:
    """List notes, optionally filtered to a subdirectory."""
    vault = get_vault_path()
    search_dir = vault / directory if directory else vault
    if not search_dir.is_dir():
        _fail(f"Directory not found: {directory}")

    notes = []
    for md in iter_notes(vault):
        try:
            md.relative_to(search_dir)
        except ValueError:
            continue
        rel = str(md.relative_to(vault))
        content = md.read_text()
        meta, _ = parse_frontmatter(content)
        notes.append({"path": rel, "id": meta.get("id"), "tags": meta.get("tags", [])})

    _ok(notes)


# ---------------------------------------------------------------------------


@app.command()
def create(
    path: str = typer.Argument(..., help="Relative path for new note"),
    content: Optional[str] = typer.Option(None, help="Note body (reads stdin if omitted)"),
    id: Optional[str] = typer.Option(None, help="Frontmatter id"),
    aliases: Optional[list[str]] = typer.Option(None, help="Frontmatter aliases"),
    tags: Optional[list[str]] = typer.Option(None, help="Frontmatter tags"),
) -> None:
    """Create a new note with frontmatter."""
    vault = get_vault_path()
    fp = vault / path
    if fp.exists():
        _fail(f"Note already exists: {path}")

    body = content if content is not None else sys.stdin.read()
    note_id = id or fp.stem
    fm = build_frontmatter(note_id, aliases, tags)

    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(fm + "\n" + body)

    _ok({"path": path, "id": note_id})


# ---------------------------------------------------------------------------


@app.command()
def update(
    path: str = typer.Argument(..., help="Relative path to note"),
    content: Optional[str] = typer.Option(None, help="New body (reads stdin if omitted)"),
) -> None:
    """Update a note's body, preserving existing frontmatter."""
    vault = get_vault_path()
    fp = vault / path
    if not fp.is_file():
        _fail(f"Note not found: {path}")

    body = content if content is not None else sys.stdin.read()
    existing = fp.read_text()
    meta, _ = parse_frontmatter(existing)

    if meta:
        fm = build_frontmatter(
            meta.get("id", fp.stem),
            meta.get("aliases"),
            meta.get("tags"),
        )
        fp.write_text(fm + "\n" + body)
    else:
        fp.write_text(body)

    _ok({"path": path})


# ---------------------------------------------------------------------------


@app.command()
def move(
    source: str = typer.Argument(..., help="Source path (relative to vault)"),
    destination: str = typer.Argument(..., help="Destination path (relative to vault)"),
) -> None:
    """Move a note to a new location."""
    vault = get_vault_path()
    src = vault / source
    dst = vault / destination
    if not src.is_file():
        _fail(f"Source not found: {source}")
    if dst.exists():
        _fail(f"Destination already exists: {destination}")

    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    _ok({"from": source, "to": destination})


# ---------------------------------------------------------------------------


@app.command()
def index(
    incremental: bool = typer.Option(False, help="Only re-index changed files"),
) -> None:
    """Build or rebuild the semantic search index."""
    vault = get_vault_path()
    collection = _get_collection()
    manifest = _load_manifest() if incremental else {}
    new_manifest: dict[str, str] = {}

    indexed = 0
    skipped = 0
    removed = 0

    notes = iter_notes(vault)
    current_files: set[str] = set()

    for md in notes:
        rel = str(md.relative_to(vault))
        current_files.add(rel)
        content = md.read_text()
        h = file_hash(content)
        new_manifest[rel] = h

        if incremental and manifest.get(rel) == h:
            skipped += 1
            continue

        # Remove stale chunks for this file
        old = collection.get(where={"source_file": rel})
        if old["ids"]:
            collection.delete(ids=old["ids"])

        chunks = chunk_markdown(content, rel)
        if chunks:
            collection.add(
                ids=[f"{rel}::{i}" for i in range(len(chunks))],
                documents=[c["text"] for c in chunks],
                metadatas=[
                    {"source_file": c["source_file"], "heading": c["heading"]}
                    for c in chunks
                ],
            )
        indexed += 1

    # Purge files that no longer exist on disk
    if incremental:
        for old_file in set(manifest.keys()) - current_files:
            old = collection.get(where={"source_file": old_file})
            if old["ids"]:
                collection.delete(ids=old["ids"])
            removed += 1

    _save_manifest(new_manifest)

    _ok(
        {
            "indexed": indexed,
            "skipped": skipped,
            "removed": removed,
            "total_files": len(notes),
            "total_chunks": collection.count(),
        }
    )


# ---------------------------------------------------------------------------


@app.command()
def sync(
    message: str = typer.Option("sync: update notes", help="Commit message"),
) -> None:
    """Pull latest, commit local changes, and push."""
    vault = get_vault_path()
    report: dict[str, object] = {}

    # Check if a remote is configured
    has_remote = subprocess.run(
        ["git", "remote"],
        cwd=vault,
        capture_output=True,
        text=True,
    )
    remote_configured = bool(has_remote.stdout.strip())

    # Pull
    if remote_configured:
        pull = subprocess.run(
            ["git", "pull", "--rebase"],
            cwd=vault,
            capture_output=True,
            text=True,
        )
        report["pull"] = pull.stdout.strip() or pull.stderr.strip()
        if pull.returncode != 0:
            _fail(f"git pull failed: {pull.stderr.strip()}")
    else:
        report["pull"] = "skipped (no remote)"

    # Stage
    subprocess.run(["git", "add", "."], cwd=vault, capture_output=True)

    # Anything to commit?
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=vault,
        capture_output=True,
        text=True,
    )
    if not status.stdout.strip():
        report["commit"] = "nothing to commit"
        report["push"] = "skipped"
        _ok(report)
        return

    # Commit
    commit = subprocess.run(
        ["git", "commit", "-m", message],
        cwd=vault,
        capture_output=True,
        text=True,
    )
    report["commit"] = commit.stdout.strip()

    # Push
    if remote_configured:
        push = subprocess.run(
            ["git", "push"],
            cwd=vault,
            capture_output=True,
            text=True,
        )
        report["push"] = push.stdout.strip() or push.stderr.strip()
        if push.returncode != 0:
            _fail(f"git push failed: {push.stderr.strip()}")
    else:
        report["push"] = "skipped (no remote)"

    _ok(report)


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app()
