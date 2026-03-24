import { describe, expect, test } from "bun:test";
import type { Logger } from "../../src/logger.ts";
import { seedConfiguredMemory } from "../../src/memory/seed.ts";
import { MemoryStore } from "../../src/memory/store.ts";
import type { ResolvedConfig } from "../../src/resources.ts";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  debug: () => {},
} as unknown as Logger;

function makeConfig(globalSeeds: string[]): ResolvedConfig {
  return {
    homeDir: "/tmp/test",
    agentsDir: "/tmp/test/agents",
    skillsDir: "/tmp/test/skills",
    internalDir: "/tmp/test/internal",
    dataDir: "/tmp/test/data",
    codeDir: "/tmp/test/code",
    logsDir: "/tmp/test/logs",
    backupIncludeDirs: [],
    memory: {
      enabled: true,
      injectionBudgetTokens: 2000,
      embeddings: {
        enabled: false,
        model: "Xenova/all-MiniLM-L6-v2",
      },
      seed: {
        global: globalSeeds,
      },
    },
    defaultAgent: "default",
    defaultDriver: "claude",
    drivers: {},
    channels: {},
    schedules: {},
    secrets: {
      get: () => undefined,
      require: (key: string) => key,
    },
  };
}

describe("seedConfiguredMemory", () => {
  test("inserts missing configured global seeds", async () => {
    const store = new MemoryStore(":memory:", noopLogger);
    await store.init();

    try {
      const result = await seedConfiguredMemory(
        store,
        makeConfig([
          "Production server runs Ubuntu 24.04",
          "This repo uses Bun and Biome",
        ]),
      );
      const entries = await store.peek({
        scope: "global",
        status: "active",
      });

      expect(result).toEqual({
        configuredGlobalSeeds: 2,
        created: 2,
      });
      expect(entries).toHaveLength(2);
      expect(entries[0]?.source).toBe("system");
      expect(entries[0]?.createdBy).toBe("system:config");
      expect(entries[1]?.source).toBe("system");
      expect(entries[1]?.createdBy).toBe("system:config");
    } finally {
      await store.close();
    }
  });

  test("does not duplicate existing global seeds", async () => {
    const store = new MemoryStore(":memory:", noopLogger);
    await store.init();
    await store.save({
      scope: "global",
      content: "Production server runs Ubuntu 24.04",
      createdBy: "system:config",
      source: "system",
    });

    try {
      const result = await seedConfiguredMemory(
        store,
        makeConfig([
          "Production server runs Ubuntu 24.04",
          "Production server runs Ubuntu 24.04",
          "This repo uses Bun and Biome",
        ]),
      );
      const entries = await store.peek({
        scope: "global",
        status: "active",
      });
      const contents = entries.map((entry) => entry.content).sort();

      expect(result).toEqual({
        configuredGlobalSeeds: 3,
        created: 1,
      });
      expect(contents).toEqual([
        "Production server runs Ubuntu 24.04",
        "This repo uses Bun and Biome",
      ]);
    } finally {
      await store.close();
    }
  });
});
