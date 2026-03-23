import { describe, expect, test } from "bun:test";
import type { Logger } from "../../src/logger.ts";
import { MemoryStore } from "../../src/memory/store.ts";
import type { EmbeddingProvider, MemoryStatus } from "../../src/memory/types.ts";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  debug: () => {},
} as unknown as Logger;

function makeVector(...values: number[]): number[] {
  return [...values, ...new Array(384 - values.length).fill(0)];
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  constructor(private vectors: Record<string, number[]>) {}

  async init(): Promise<void> {}

  async embed(text: string): Promise<number[]> {
    return this.vectors[text] ?? makeVector(0, 0, 0);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }

  dimensions(): number {
    return 384;
  }
}

class FailingEmbeddingProvider implements EmbeddingProvider {
  async init(): Promise<void> {
    throw new Error("embedding init failed");
  }

  async embed(): Promise<number[]> {
    return makeVector(0, 0, 0);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => makeVector(0, 0, 0));
  }

  dimensions(): number {
    return 384;
  }
}

async function createStore(
  embeddingProvider?: EmbeddingProvider,
): Promise<MemoryStore> {
  const store = new MemoryStore(":memory:", noopLogger, embeddingProvider ?? null);
  await store.init();
  return store;
}

async function saveMemory(
  store: MemoryStore,
  overrides?: Partial<{
    scope: "agent:writer" | "global" | "user:default";
    content: string;
    tags: string[];
    createdBy: string;
    source: "agent" | "user" | "system" | "compaction";
  }>,
) {
  return store.save({
    scope: overrides?.scope ?? "agent:writer",
    content: overrides?.content ?? "User prefers concise responses",
    tags: overrides?.tags ?? ["preferences"],
    createdBy: overrides?.createdBy ?? "agent:writer",
    source: overrides?.source ?? "agent",
  });
}

describe("MemoryStore", () => {
  test("save and get persist structured memory entries", async () => {
    const store = await createStore();

    const saved = await saveMemory(store);
    const loaded = await store.get(saved.id);

    expect(saved.id.startsWith("mem_")).toBe(true);
    expect(loaded).not.toBeNull();
    expect(loaded?.content).toBe("User prefers concise responses");
    expect(loaded?.status).toBe("active");
    expect(loaded?.tags).toEqual(["preferences"]);

    await store.close();
  });

  test("update replaces content and tags", async () => {
    const store = await createStore();
    const saved = await saveMemory(store);

    const updated = await store.update(saved.id, {
      content: "User prefers direct answers",
      tags: ["preferences", "style"],
    });

    expect(updated?.content).toBe("User prefers direct answers");
    expect(updated?.tags).toEqual(["preferences", "style"]);
    expect(updated?.updatedAt).not.toBe(saved.updatedAt);

    await store.close();
  });

  test("archive soft deletes while delete hard deletes", async () => {
    const store = await createStore();
    const saved = await saveMemory(store);

    expect(await store.archive(saved.id)).toBe(true);
    expect((await store.get(saved.id))?.status).toBe("archived");
    expect(await store.delete(saved.id)).toBe(true);
    expect(await store.get(saved.id)).toBeNull();

    await store.close();
  });

  test("list filters by scope, status, and tags", async () => {
    const store = await createStore();
    await saveMemory(store, { scope: "agent:writer", tags: ["preferences"] });
    const archived = await saveMemory(store, {
      scope: "global",
      content: "Production server runs Ubuntu 24.04",
      tags: ["infrastructure"],
    });
    await store.archive(archived.id);
    await saveMemory(store, {
      scope: "global",
      content: "Use AP style for blog posts",
      tags: ["style"],
    });

    const activeGlobal = await store.list({
      scope: "global",
      status: "active",
    });
    const tagged = await store.list({ tags: ["preferences"] });

    expect(activeGlobal).toHaveLength(1);
    expect(activeGlobal[0]?.content).toContain("AP style");
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.scope).toBe("agent:writer");

    await store.close();
  });

  test("keyword search matches content and tags", async () => {
    const store = await createStore();
    await saveMemory(store, {
      content: "Production server runs Ubuntu 24.04",
      scope: "global",
      tags: ["infrastructure"],
    });
    await saveMemory(store, {
      content: "User prefers concise responses",
      tags: ["preferences"],
    });

    const serverResults = await store.search({ text: "Ubuntu" });
    const tagResults = await store.search({ text: "preferences" });

    expect(serverResults).toHaveLength(1);
    expect(serverResults[0]?.matchType).toBe("keyword");
    expect(serverResults[0]?.entry.scope).toBe("global");
    expect(tagResults).toHaveLength(1);
    expect(tagResults[0]?.entry.content).toContain("concise");

    await store.close();
  });

  test("get, list, and search update accessedAt", async () => {
    const store = await createStore();
    const saved = await saveMemory(store);

    const initialAccessedAt = (await store.get(saved.id))?.accessedAt;
    const listed = await store.list({ scope: saved.scope });
    const afterList = listed[0]?.accessedAt;
    const searched = await store.search({ text: "concise" });
    const afterSearch = searched[0]?.entry.accessedAt;

    expect(initialAccessedAt).toBeDefined();
    expect(afterList).toBeDefined();
    expect(afterSearch).toBeDefined();
    expect(new Date(afterList ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(initialAccessedAt ?? 0).getTime(),
    );
    expect(new Date(afterSearch ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(afterList ?? 0).getTime(),
    );

    await store.close();
  });

  test("count, listScopes, and stats summarize the store", async () => {
    const store = await createStore();
    await saveMemory(store, { scope: "agent:writer" });
    const archived = await saveMemory(store, { scope: "global" });
    const compacted = await saveMemory(store, { scope: "user:default" });
    await store.archive(archived.id);
    await store.update(compacted.id, { status: "compacted" });

    expect(await store.count({})).toBe(3);
    expect(await store.listScopes()).toEqual([
      "agent:writer",
      "global",
      "user:default",
    ]);

    const stats = await store.stats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.activeEntries).toBe(1);
    expect(stats.archivedEntries).toBe(1);
    expect(stats.compactedEntries).toBe(1);
    expect(stats.entriesByScope.global).toBe(1);

    await store.close();
  });

  test("exportMarkdown groups active entries by tag section", async () => {
    const store = await createStore();
    await saveMemory(store, {
      scope: "agent:writer",
      content: "User prefers concise responses",
      tags: ["Preferences"],
    });
    await saveMemory(store, {
      scope: "agent:writer",
      content: "Suggest outlines before full drafts",
      tags: [],
    });

    const markdown = await store.exportMarkdown("agent:writer");

    expect(markdown).toContain("# Memory: agent:writer");
    expect(markdown).toContain("## Preferences");
    expect(markdown).toContain("## General");
    expect(markdown).toContain("User prefers concise responses");
    expect(markdown).toContain("Suggest outlines before full drafts");

    await store.close();
  });

  test("invalid scopes are rejected", async () => {
    const store = await createStore();

    await expect(
      store.save({
        scope: "team:ops" as "agent:writer",
        content: "invalid",
        createdBy: "user",
        source: "user",
      }),
    ).rejects.toThrow('Invalid memory scope: "team:ops"');

    await store.close();
  });

  test("list defaults to active status when no status filter is provided", async () => {
    const store = await createStore();
    await saveMemory(store);
    const archived = await saveMemory(store, {
      content: "old preference",
    });
    await store.archive(archived.id);

    const listed = await store.list({ scope: "agent:writer" });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("active");

    await store.close();
  });

  test("search defaults to active status when no status filter is provided", async () => {
    const store = await createStore();
    await saveMemory(store, { content: "current preference" });
    const archived = await saveMemory(store, {
      content: "archived preference",
    });
    await store.archive(archived.id);

    const results = await store.search({ text: "preference" });

    expect(results).toHaveLength(1);
    expect(results[0]?.entry.content).toBe("current preference");

    await store.close();
  });

  test("semantic search finds related entries when embeddings are enabled", async () => {
    const store = await createStore(
      new FakeEmbeddingProvider({
        "Ubuntu host": makeVector(1, 0, 0),
        "linux server": makeVector(1, 0, 0),
      }),
    );
    await saveMemory(store, {
      content: "Ubuntu host",
      scope: "global",
    });

    const results = await store.search({ text: "linux server" });

    expect(results).toHaveLength(1);
    expect(results[0]?.matchType).toBe("semantic");
    expect(results[0]?.entry.content).toBe("Ubuntu host");

    await store.close();
  });

  test("hybrid search prefers results matched by both keyword and semantic search", async () => {
    const store = await createStore(
      new FakeEmbeddingProvider({
        "Ubuntu host": makeVector(1, 0, 0),
        ubuntu: makeVector(1, 0, 0),
        unrelated: makeVector(0, 1, 0),
      }),
    );
    await saveMemory(store, {
      content: "Ubuntu host",
      scope: "global",
    });

    const results = await store.search({ text: "ubuntu" });

    expect(results).toHaveLength(1);
    expect(results[0]?.matchType).toBe("hybrid");

    await store.close();
  });

  test("reindex regenerates embeddings for existing memories", async () => {
    const store = await createStore(
      new FakeEmbeddingProvider({
        "stored memory": makeVector(1, 0, 0),
        stored: makeVector(1, 0, 0),
      }),
    );
    await saveMemory(store, {
      content: "stored memory",
    });

    const count = await store.reindex();
    const results = await store.search({ text: "stored" });

    expect(count).toBe(1);
    expect(results[0]?.matchType).toBe("hybrid");

    await store.close();
  });

  test("falls back to keyword search when embeddings fail to initialize", async () => {
    const store = await createStore(new FailingEmbeddingProvider());
    await saveMemory(store, {
      content: "keyword only search still works",
    });

    const results = await store.search({ text: "keyword" });

    expect(results).toHaveLength(1);
    expect(results[0]?.matchType).toBe("keyword");

    await store.close();
  });
});
