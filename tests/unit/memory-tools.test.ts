import { describe, expect, test } from "bun:test";
import type { Logger } from "../../src/logger.ts";
import { MemoryStore } from "../../src/memory/store.ts";
import {
  buildMemoryToolInstructions,
  deleteMemory,
  listMemory,
  saveMemory,
  searchMemory,
  updateMemory,
} from "../../src/memory/tools.ts";
import type { MemoryToolContext } from "../../src/memory/tools.ts";

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

function makeAgentContext(store: MemoryStore): MemoryToolContext {
  return {
    memoryBackend: store,
    actor: {
      type: "agent",
      agentName: "writer",
      createdBy: "agent:writer",
      source: "agent",
    },
  };
}

describe("memory tool handlers", () => {
  test("saveMemory resolves the default agent scope", async () => {
    const store = await createStore();

    const result = await saveMemory(makeAgentContext(store), {
      content: "User prefers concise responses",
    });

    expect(result.entry.scope).toBe("agent:writer");
    expect(result.entry.source).toBe("agent");

    await store.close();
  });

  test("searchMemory searches agent, global, and user scopes by default", async () => {
    const store = await createStore();
    await store.save({
      scope: "agent:writer",
      content: "Use AP style",
      createdBy: "agent:writer",
      source: "agent",
    });
    await store.save({
      scope: "global",
      content: "Production server runs Ubuntu 24.04",
      createdBy: "agent:writer",
      source: "agent",
    });
    await store.save({
      scope: "user:default",
      content: "Timezone is America/New_York",
      createdBy: "user",
      source: "user",
    });

    const result = await searchMemory(makeAgentContext(store), {
      query: "Production Timezone AP",
      limit: 10,
    });

    expect(result.results.map((entry) => entry.entry.scope).sort()).toEqual([
      "agent:writer",
      "global",
      "user:default",
    ]);

    await store.close();
  });

  test("updateMemory allows an agent to update its own shared-scope entry", async () => {
    const store = await createStore();
    const entry = await store.save({
      scope: "global",
      content: "Old shared knowledge",
      createdBy: "agent:writer",
      source: "agent",
    });

    const result = await updateMemory(makeAgentContext(store), {
      id: entry.id,
      content: "Updated shared knowledge",
    });

    expect(result.entry?.content).toBe("Updated shared knowledge");

    await store.close();
  });

  test("updateMemory denies changes to another agent's shared-scope entry", async () => {
    const store = await createStore();
    const entry = await store.save({
      scope: "global",
      content: "Do not change me",
      createdBy: "agent:other",
      source: "agent",
    });

    await expect(
      updateMemory(makeAgentContext(store), {
        id: entry.id,
        content: "Nope",
      }),
    ).rejects.toThrow("You do not have permission to update this memory");

    await store.close();
  });

  test("deleteMemory archives instead of hard deleting", async () => {
    const store = await createStore();
    const entry = await store.save({
      scope: "agent:writer",
      content: "Archive me",
      createdBy: "agent:writer",
      source: "agent",
    });

    const result = await deleteMemory(makeAgentContext(store), {
      id: entry.id,
    });
    const archived = await store.get(entry.id);

    expect(result.archived).toBe(true);
    expect(archived?.status).toBe("archived");

    await store.close();
  });

  test("listMemory respects explicit scope and limit", async () => {
    const store = await createStore();
    await store.save({
      scope: "agent:writer",
      content: "first",
      createdBy: "agent:writer",
      source: "agent",
    });
    await store.save({
      scope: "agent:writer",
      content: "second",
      createdBy: "agent:writer",
      source: "agent",
    });

    const result = await listMemory(makeAgentContext(store), {
      scope: "agent",
      limit: 1,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.scope).toBe("agent:writer");

    await store.close();
  });
});

describe("buildMemoryToolInstructions", () => {
  test("mentions all memory tools and user-facing guidance", () => {
    const instructions = buildMemoryToolInstructions();

    expect(instructions).toContain("SaveMemory");
    expect(instructions).toContain("SearchMemory");
    expect(instructions).toContain("UpdateMemory");
    expect(instructions).toContain("DeleteMemory");
    expect(instructions).toContain("ListMemory");
    expect(instructions).toContain("Save important facts proactively");
  });
});
