import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { Logger } from "../logger.ts";
import { toError } from "../resources.ts";
import {
  normalizeMemoryTags,
  validateMemoryScope,
  type EmbeddingProvider,
  type MemoryBackend,
  type MemoryEntry,
  type MemoryEntryPatch,
  type MemoryFilter,
  type MemoryScope,
  type MemorySearchQuery,
  type MemorySearchResult,
  type MemorySource,
  type MemoryStats,
  type MemoryStatus,
  type NewMemoryEntry,
} from "./types.ts";

interface MemoryRow {
  id: string;
  scope: string;
  content: string;
  tags: string;
  source: MemorySource;
  created_by: string;
  status: MemoryStatus;
  created_at: string;
  updated_at: string;
  accessed_at: string;
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  validateMemoryScope(row.scope);
  return {
    id: row.id,
    scope: row.scope,
    content: row.content,
    tags: JSON.parse(row.tags) as string[],
    source: row.source,
    createdBy: row.created_by,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accessedAt: row.accessed_at,
  };
}

function makeMemoryId(): string {
  return `mem_${randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextTimestamp(after?: string): string {
  const now = Date.now();
  const afterTime = after ? new Date(after).getTime() : 0;
  return new Date(Math.max(now, afterTime + 1)).toISOString();
}

function includesAllTags(entryTags: string[], filterTags?: string[]): boolean {
  if (!filterTags || filterTags.length === 0) {
    return true;
  }

  const normalizedEntryTags = new Set(
    entryTags.map((tag) => tag.toLowerCase()),
  );
  return filterTags.every((tag) => normalizedEntryTags.has(tag.toLowerCase()));
}

function countKeywordMatches(text: string, query: string): number {
  if (!query.trim()) {
    return 0;
  }

  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase().trim();

  let matches = 0;
  let index = 0;
  while (true) {
    const nextIndex = normalizedText.indexOf(normalizedQuery, index);
    if (nextIndex === -1) {
      break;
    }
    matches += 1;
    index = nextIndex + normalizedQuery.length;
  }

  return matches;
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export class MemoryStore implements MemoryBackend {
  private db: Database;
  private embeddingsReady = false;
  private vectorSearchEnabled = false;
  private fallbackEmbeddings = new Map<string, number[]>();

  constructor(
    dbPath: string,
    private logger: Logger,
    private embeddingProvider: EmbeddingProvider | null = null,
  ) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath, { create: true });
  }

  async init(): Promise<void> {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
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
    `);

    if (!this.embeddingProvider) {
      return;
    }

    try {
      await this.embeddingProvider.init();
      this.embeddingsReady = true;
      const sqliteVec = await import("sqlite-vec");
      sqliteVec.load(this.db);
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
          memory_id TEXT PRIMARY KEY,
          embedding float[384]
        );
      `);
      this.vectorSearchEnabled = true;
    } catch (err) {
      this.vectorSearchEnabled = false;
      this.logger.warn({ err: toError(err) }, "memory_embeddings_disabled");
    }

    await this.reindex();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async save(entry: NewMemoryEntry): Promise<MemoryEntry> {
    validateMemoryScope(entry.scope);
    const timestamp = nowIso();
    const saved: MemoryEntry = {
      id: makeMemoryId(),
      scope: entry.scope,
      content: entry.content,
      tags: normalizeMemoryTags(entry.tags),
      source: entry.source,
      createdBy: entry.createdBy,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      accessedAt: timestamp,
    };

    this.db
      .query(
        `
          INSERT INTO memories (
            id,
            scope,
            content,
            tags,
            source,
            created_by,
            status,
            created_at,
            updated_at,
            accessed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        saved.id,
        saved.scope,
        saved.content,
        JSON.stringify(saved.tags),
        saved.source,
        saved.createdBy,
        saved.status,
        saved.createdAt,
        saved.updatedAt,
        saved.accessedAt,
      );

    await this.syncEmbedding(saved);

    return saved;
  }

  async update(
    id: string,
    patch: MemoryEntryPatch,
  ): Promise<MemoryEntry | null> {
    const current = await this.getWithoutAccessUpdate(id);
    if (!current) {
      return null;
    }

    const updated: MemoryEntry = {
      ...current,
      content: patch.content ?? current.content,
      tags: patch.tags ? normalizeMemoryTags(patch.tags) : current.tags,
      status: patch.status ?? current.status,
      updatedAt: nextTimestamp(current.updatedAt),
    };

    this.db
      .query(
        `
          UPDATE memories
          SET content = ?, tags = ?, status = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        updated.content,
        JSON.stringify(updated.tags),
        updated.status,
        updated.updatedAt,
        id,
      );

    if (patch.content !== undefined) {
      await this.syncEmbedding(updated);
    }

    return updated;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const entry = await this.getWithoutAccessUpdate(id);
    if (!entry) {
      return null;
    }

    const accessedAt = nowIso();
    this.touchAccessedAt([id], accessedAt);
    return {
      ...entry,
      accessedAt,
    };
  }

  async delete(id: string): Promise<boolean> {
    this.deleteEmbedding(id);
    const result = this.db
      .query("DELETE FROM memories WHERE id = ?")
      .run(id) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  async archive(id: string): Promise<boolean> {
    const updated = await this.update(id, { status: "archived" });
    return updated !== null;
  }

  async peek(filter: MemoryFilter): Promise<MemoryEntry[]> {
    return this.listWithoutAccessUpdate({
      ...filter,
      status: filter.status ?? "active",
    });
  }

  async list(filter: MemoryFilter): Promise<MemoryEntry[]> {
    const entries = await this.peek(filter);
    if (entries.length === 0) {
      return [];
    }

    const accessedAt = nowIso();
    this.touchAccessedAt(
      entries.map((entry) => entry.id),
      accessedAt,
    );

    return entries.map((entry) => ({
      ...entry,
      accessedAt,
    }));
  }

  async search(query: MemorySearchQuery): Promise<MemorySearchResult[]> {
    const keywordResults = this.searchKeyword(query);
    const semanticResults = await this.searchSemantic(query);
    const merged = new Map<string, MemorySearchResult>();

    for (const result of [...keywordResults, ...semanticResults]) {
      const existing = merged.get(result.entry.id);
      if (!existing) {
        merged.set(result.entry.id, result);
        continue;
      }

      merged.set(result.entry.id, {
        entry: result.entry,
        score: Math.min(1, Math.max(existing.score, result.score) + 0.05),
        matchType: "hybrid",
      });
    }

    const limitedResults = [...merged.values()]
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.matchType !== right.matchType) {
          return left.matchType === "hybrid" ? -1 : 1;
        }
        return right.entry.updatedAt.localeCompare(left.entry.updatedAt);
      })
      .slice(0, query.limit ?? 10);

    if (limitedResults.length === 0) {
      return [];
    }

    const accessedAt = nowIso();
    this.touchAccessedAt(
      limitedResults.map((result) => result.entry.id),
      accessedAt,
    );

    return limitedResults.map((result) => ({
      ...result,
      entry: {
        ...result.entry,
        accessedAt,
      },
    }));
  }

  async listScopes(): Promise<string[]> {
    const rows = this.db
      .query("SELECT DISTINCT scope FROM memories ORDER BY scope ASC")
      .all() as Array<{ scope: string }>;
    return rows.map((row) => row.scope);
  }

  async count(filter: MemoryFilter): Promise<number> {
    return this.listWithoutAccessUpdate(filter).length;
  }

  async stats(): Promise<MemoryStats> {
    const totalEntries = this.db
      .query("SELECT COUNT(*) AS count FROM memories")
      .get() as { count: number };
    const statusCounts = this.db
      .query(
        "SELECT status, COUNT(*) AS count FROM memories GROUP BY status ORDER BY status ASC",
      )
      .all() as Array<{ status: MemoryStatus; count: number }>;
    const scopeCounts = this.db
      .query(
        "SELECT scope, COUNT(*) AS count FROM memories GROUP BY scope ORDER BY scope ASC",
      )
      .all() as Array<{ scope: string; count: number }>;

    return {
      totalEntries: totalEntries.count,
      activeEntries:
        statusCounts.find((row) => row.status === "active")?.count ?? 0,
      archivedEntries:
        statusCounts.find((row) => row.status === "archived")?.count ?? 0,
      compactedEntries:
        statusCounts.find((row) => row.status === "compacted")?.count ?? 0,
      entriesByScope: Object.fromEntries(
        scopeCounts.map((row) => [row.scope, row.count]),
      ),
    };
  }

  async exportMarkdown(scope: MemoryScope): Promise<string> {
    validateMemoryScope(scope);
    const entries = this.listWithoutAccessUpdate({
      scope,
      status: "active",
    });
    const sections = new Map<string, string[]>();

    for (const entry of entries) {
      const sectionNames = entry.tags.length > 0 ? entry.tags : ["General"];
      for (const sectionName of sectionNames) {
        const existing = sections.get(sectionName) ?? [];
        existing.push(
          `- ${entry.content} (saved ${entry.createdAt.slice(0, 10)})`,
        );
        sections.set(sectionName, existing);
      }
    }

    const orderedSections = [...sections.keys()].sort((left, right) => {
      if (left === "General") {
        return 1;
      }
      if (right === "General") {
        return -1;
      }
      return left.localeCompare(right);
    });

    const lines = [`# Memory: ${scope}`];
    for (const sectionName of orderedSections) {
      lines.push("", `## ${sectionName}`);
      for (const line of sections.get(sectionName) ?? []) {
        lines.push(line);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  async reindex(): Promise<number> {
    if (!this.embeddingsReady || !this.embeddingProvider) {
      return 0;
    }

    const entries = this.listWithoutAccessUpdate({});
    this.fallbackEmbeddings.clear();
    if (this.vectorSearchEnabled) {
      this.db.query("DELETE FROM memory_embeddings").run();
    }
    if (entries.length === 0) {
      return 0;
    }

    const embeddings = await this.embeddingProvider.embedBatch(
      entries.map((entry) => entry.content),
    );
    for (const [index, entry] of entries.entries()) {
      const embedding = embeddings[index];
      if (!embedding) {
        continue;
      }
      this.upsertEmbedding(entry.id, embedding);
    }

    return entries.length;
  }

  private async getWithoutAccessUpdate(
    id: string,
  ): Promise<MemoryEntry | null> {
    const row = this.db
      .query("SELECT * FROM memories WHERE id = ? LIMIT 1")
      .get(id) as MemoryRow | null;
    return row ? rowToEntry(row) : null;
  }

  private searchKeyword(query: MemorySearchQuery): MemorySearchResult[] {
    const text = query.text?.trim() ?? "";
    if (!text) {
      return [];
    }
    const queryTerms = text.split(/\s+/).filter(Boolean);
    const entries = this.listWithoutAccessUpdate({
      scope: query.scope,
      status: query.status ?? "active",
    });

    const results: MemorySearchResult[] = [];
    for (const entry of entries) {
      const matchCount = queryTerms.reduce((total, term) => {
        return (
          total +
          countKeywordMatches(entry.content, term) +
          countKeywordMatches(entry.tags.join(" "), term)
        );
      }, 0);
      if (matchCount === 0) {
        continue;
      }

      results.push({
        entry,
        score: Math.min(1, 0.4 + matchCount * 0.2),
        matchType: "keyword",
      });
    }

    return results;
  }

  private async searchSemantic(
    query: MemorySearchQuery,
  ): Promise<MemorySearchResult[]> {
    if (!this.embeddingsReady || !this.embeddingProvider) {
      return [];
    }

    const embedding =
      query.embedding ??
      (query.text ? await this.embeddingProvider.embed(query.text) : undefined);
    if (!embedding) {
      return [];
    }

    if (this.vectorSearchEnabled) {
      const rows = this.db
        .query(
          `
            SELECT memory_id, distance
            FROM memory_embeddings
            WHERE embedding MATCH ?
            ORDER BY distance
            LIMIT ?
          `,
        )
        .all(new Float32Array(embedding), query.limit ?? 10) as Array<{
        memory_id: string;
        distance: number;
      }>;

      const results: MemorySearchResult[] = [];
      for (const row of rows) {
        const entry = await this.getWithoutAccessUpdate(row.memory_id);
        if (!entry) {
          continue;
        }
        if (query.scope && entry.scope !== query.scope) {
          continue;
        }
        if ((query.status ?? "active") !== entry.status) {
          continue;
        }

        results.push({
          entry,
          score: 1 / (1 + row.distance),
          matchType: "semantic",
        });
      }

      return results;
    }

    const entries = this.listWithoutAccessUpdate({
      scope: query.scope,
      status: query.status ?? "active",
    });
    const missingEntries = entries.filter(
      (entry) => !this.fallbackEmbeddings.has(entry.id),
    );
    if (missingEntries.length > 0) {
      const missingEmbeddings = await this.embeddingProvider.embedBatch(
        missingEntries.map((entry) => entry.content),
      );
      for (const [index, entry] of missingEntries.entries()) {
        const missingEmbedding = missingEmbeddings[index];
        if (!missingEmbedding) {
          continue;
        }
        this.fallbackEmbeddings.set(entry.id, missingEmbedding);
      }
    }

    const fallbackResults: MemorySearchResult[] = [];
    for (const entry of entries) {
      const entryEmbedding = this.fallbackEmbeddings.get(entry.id);
      if (!entryEmbedding) {
        continue;
      }
      const similarity = cosineSimilarity(embedding, entryEmbedding);
      if (similarity <= 0) {
        continue;
      }
      fallbackResults.push({
        entry,
        score: similarity,
        matchType: "semantic",
      });
    }

    return fallbackResults
      .sort((left, right) => right.score - left.score)
      .slice(0, query.limit ?? 10);
  }

  private listWithoutAccessUpdate(filter: MemoryFilter): MemoryEntry[] {
    if (filter.scope) {
      validateMemoryScope(filter.scope);
    }

    const conditions: string[] = [];
    const values: Array<string | number> = [];

    if (filter.scope) {
      conditions.push("scope = ?");
      values.push(filter.scope);
    }
    if (filter.status) {
      conditions.push("status = ?");
      values.push(filter.status);
    }
    if (filter.source) {
      conditions.push("source = ?");
      values.push(filter.source);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .query(
        `
          SELECT *
          FROM memories
          ${whereClause}
          ORDER BY updated_at DESC, created_at DESC
        `,
      )
      .all(...values) as MemoryRow[];

    return rows
      .map((row) => rowToEntry(row))
      .filter((entry) => includesAllTags(entry.tags, filter.tags))
      .slice(
        filter.offset ?? 0,
        (filter.offset ?? 0) + (filter.limit ?? rows.length),
      );
  }

  private async syncEmbedding(entry: MemoryEntry): Promise<void> {
    if (!this.embeddingsReady || !this.embeddingProvider) {
      return;
    }
    const embedding = await this.embeddingProvider.embed(entry.content);
    this.upsertEmbedding(entry.id, embedding);
  }

  private upsertEmbedding(id: string, embedding: number[]): void {
    this.fallbackEmbeddings.set(id, embedding);
    if (!this.vectorSearchEnabled) {
      return;
    }
    this.db
      .query(
        "INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding) VALUES (?, ?)",
      )
      .run(id, new Float32Array(embedding));
  }

  private deleteEmbedding(id: string): void {
    this.fallbackEmbeddings.delete(id);
    if (!this.vectorSearchEnabled) {
      return;
    }
    this.db.query("DELETE FROM memory_embeddings WHERE memory_id = ?").run(id);
  }

  private touchAccessedAt(ids: string[], accessedAt: string): void {
    for (const id of ids) {
      this.db
        .query("UPDATE memories SET accessed_at = ? WHERE id = ?")
        .run(accessedAt, id);
    }
  }
}
