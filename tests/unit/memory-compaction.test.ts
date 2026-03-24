import { describe, expect, test } from "bun:test";
import type { Logger } from "../../src/logger.ts";
import { compactMemories } from "../../src/memory/compaction.ts";
import { MemoryStore } from "../../src/memory/store.ts";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  debug: () => {},
} as unknown as Logger;

async function createStore(): Promise<MemoryStore> {
  const store = new MemoryStore(":memory:", noopLogger);
  await store.init();
  return store;
}

describe("compactMemories", () => {
  test("merges duplicate active entries into a compaction summary", async () => {
    const store = await createStore();
    await store.save({
      scope: "agent:writer",
      content: "User prefers concise responses",
      createdBy: "agent:writer",
      source: "agent",
    });
    await store.save({
      scope: "agent:writer",
      content: "User prefers concise responses",
      createdBy: "agent:writer",
      source: "agent",
    });

    const result = await compactMemories(store, "agent:writer");
    const activeEntries = await store.peek({
      scope: "agent:writer",
      status: "active",
    });
    const compactedEntries = await store.peek({
      scope: "agent:writer",
      status: "compacted",
    });

    expect(result.createdEntries).toBe(1);
    expect(result.compactedEntries).toBe(2);
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0]?.source).toBe("compaction");
    expect(compactedEntries).toHaveLength(2);

    await store.close();
  });

  test("is idempotent when run twice on the same scope", async () => {
    const store = await createStore();
    await store.save({
      scope: "global",
      content: "Production server runs Ubuntu 24.04",
      createdBy: "agent:writer",
      source: "agent",
    });
    await store.save({
      scope: "global",
      content: "Production server runs Ubuntu 24.04",
      createdBy: "agent:writer",
      source: "agent",
    });

    const first = await compactMemories(store, "global");
    const second = await compactMemories(store, "global");

    expect(first.createdEntries).toBe(1);
    expect(second.createdEntries).toBe(0);
    expect(second.compactedEntries).toBe(0);

    await store.close();
  });

  test("compacts later duplicates into an existing compaction summary", async () => {
    const store = await createStore();
    await store.save({
      scope: "global",
      content: "Production server runs Ubuntu 24.04",
      createdBy: "agent:writer",
      source: "agent",
      tags: ["infrastructure"],
    });
    await store.save({
      scope: "global",
      content: "Production server runs Ubuntu 24.04",
      createdBy: "agent:writer",
      source: "agent",
      tags: ["ops"],
    });

    const first = await compactMemories(store, "global");
    const summaryBefore = (
      await store.peek({
        scope: "global",
        status: "active",
      })
    )[0];

    await store.save({
      scope: "global",
      content: "Production server runs Ubuntu 24.04",
      createdBy: "agent:writer",
      source: "agent",
      tags: ["servers"],
    });

    const second = await compactMemories(store, "global");
    const activeEntries = await store.peek({
      scope: "global",
      status: "active",
    });
    const compactedEntries = await store.peek({
      scope: "global",
      status: "compacted",
    });

    expect(first.createdEntries).toBe(1);
    expect(second.createdEntries).toBe(0);
    expect(second.compactedEntries).toBe(1);
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0]?.id).toBe(summaryBefore?.id);
    expect(activeEntries[0]?.tags).toEqual([
      "infrastructure",
      "ops",
      "servers",
    ]);
    expect(compactedEntries).toHaveLength(3);

    await store.close();
  });
});
