import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ChannelHandler } from "../../src/channel-handler.ts";
import { Paths } from "../../src/constants.ts";
import type { Logger } from "../../src/logger.ts";
import { buildMemoryCommandActions } from "../../src/memory/actions.ts";
import { MemoryStore } from "../../src/memory/store.ts";
import { ChatCommandRegistry } from "../../src/chat-commands/registry.ts";
import { createChatCommandTree } from "../../src/chat-commands/tree.ts";
import type {
  ChatCommandEnvironment,
  ChatCommandResult,
} from "../../src/chat-commands/types.ts";
import type { ResolvedConfig } from "../../src/resources.ts";
import type { ResolvedAgent } from "../../src/skills.ts";
import { FakeDriver } from "../fakes/fake-driver.ts";

// --- Helpers ---

let tmpDir: string;

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `ch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  debug: () => {},
} as unknown as Logger;

function makeConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    homeDir: "/tmp/test",
    agentsDir: resolve(tmpDir, "agents"),
    skillsDir: resolve(tmpDir, "skills"),
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
    },
    defaultAgent: "default",
    defaultDriver: "fake",
    drivers: {},
    channels: {},
    schedules: {},
    secrets: {
      get: () => undefined,
      require: (k: string) => k,
    },
    ...overrides,
  };
}

function makeResolveAgent(
  overrides?: Partial<ResolvedAgent>,
): (agentDir: string) => ResolvedAgent {
  return () => ({
    systemPrompt: "test system prompt",
    skills: [],
    memory: true,
    ...overrides,
  });
}

/** Create a minimal agent directory with SYSTEM.md so resolveAgentDir finds it. */
function createAgentDir(name: string, systemMd = "test prompt"): void {
  const dir = resolve(tmpDir, "agents", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "SYSTEM.md"), systemMd);
}

function makeHandler(
  driver?: FakeDriver,
  configOverrides?: Partial<ResolvedConfig>,
  resolveAgentOverrides?: Partial<ResolvedAgent>,
  memoryStore?: MemoryStore,
): { handler: ChannelHandler; driver: FakeDriver } {
  const d = driver ?? new FakeDriver();
  const config = makeConfig(configOverrides);
  const handler = new ChannelHandler(
    { fake: d },
    config,
    new Map(),
    makeResolveAgent(resolveAgentOverrides),
    noopLogger,
    memoryStore,
  );
  return { handler, driver: d };
}

function makeCommandEnv(
  handler: ChannelHandler,
  overrides?: Partial<ChatCommandEnvironment>,
): ChatCommandEnvironment {
  return {
    channelId: "chan-1",
    commandPrefix: "!",
    frontend: "discord",
    isOwner: true,
    handler,
    actions: {
      reload: async () => undefined,
    },
    ...overrides,
  };
}

async function runCommand(
  handler: ChannelHandler,
  raw: string,
  overrides?: Partial<ChatCommandEnvironment>,
): Promise<ChatCommandResult | null> {
  const registry = new ChatCommandRegistry(createChatCommandTree());
  return registry.execute(makeCommandEnv(handler, overrides), raw);
}

// --- Tests ---

beforeEach(() => {
  tmpDir = makeTmpDir();
  // Create default agent so resolution works
  createAgentDir("default");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("session lifecycle", () => {
  test("first message creates a session", async () => {
    const { handler, driver } = makeHandler();
    const response = await handler.handleMessage("chan-1", "hello");

    expect(response).toBe("fake response");
    expect(driver.createdSessions).toHaveLength(1);
    expect(driver.activeSessionCount).toBe(1);
  });

  test("subsequent messages reuse the existing session", async () => {
    const { handler, driver } = makeHandler();
    await handler.handleMessage("chan-1", "hello");
    await handler.handleMessage("chan-1", "world");

    expect(driver.createdSessions).toHaveLength(1);
  });

  test("ensureSession returns the same session ID", async () => {
    const { handler } = makeHandler();
    const id1 = await handler.ensureSession("chan-1");
    const id2 = await handler.ensureSession("chan-1");

    expect(id1).toBe(id2);
  });

  test("destroySession clears the session", async () => {
    const { handler, driver } = makeHandler();
    await handler.ensureSession("chan-1");
    expect(driver.activeSessionCount).toBe(1);

    await handler.destroySession("chan-1");
    expect(driver.activeSessionCount).toBe(0);

    // Next ensureSession creates a new one
    await handler.ensureSession("chan-1");
    expect(driver.createdSessions).toHaveLength(2);
  });

  test("destroyAllSessions clears all channels", async () => {
    const { handler, driver } = makeHandler();
    await handler.ensureSession("chan-1");
    await handler.ensureSession("chan-2");
    expect(driver.activeSessionCount).toBe(2);

    await handler.destroyAllSessions();
    expect(driver.activeSessionCount).toBe(0);
  });
});

describe("memory injection", () => {
  test("injects memory into the created session prompt", async () => {
    const memoryStore = new MemoryStore(":memory:", noopLogger);
    await memoryStore.init();
    await memoryStore.save({
      scope: "agent:default",
      content: "User prefers concise responses",
      createdBy: "agent:default",
      source: "agent",
    });
    await memoryStore.save({
      scope: "global",
      content: "Production server runs Ubuntu 24.04",
      createdBy: "agent:default",
      source: "agent",
    });

    try {
      const { handler, driver } = makeHandler(
        undefined,
        undefined,
        undefined,
        memoryStore,
      );
      await handler.ensureSession("chan-1");

      const systemPrompt =
        driver.createdSessions[0]?.options.systemPrompt ?? "";
      expect(systemPrompt).toContain("# Memory");
      expect(systemPrompt).toContain("User prefers concise responses");
      expect(systemPrompt).toContain("Production server runs Ubuntu 24.04");
      expect(systemPrompt).toContain(
        "Use SaveMemory to remember new information",
      );
    } finally {
      await memoryStore.close();
    }
  });

  test("does not inject memory when the agent opts out", async () => {
    const memoryStore = new MemoryStore(":memory:", noopLogger);
    await memoryStore.init();
    await memoryStore.save({
      scope: "agent:default",
      content: "This should stay hidden",
      createdBy: "agent:default",
      source: "agent",
    });

    try {
      const { handler, driver } = makeHandler(
        undefined,
        undefined,
        { memory: false },
        memoryStore,
      );
      await handler.ensureSession("chan-1");

      const systemPrompt =
        driver.createdSessions[0]?.options.systemPrompt ?? "";
      expect(systemPrompt).not.toContain("# Memory");
      expect(systemPrompt).not.toContain("This should stay hidden");
    } finally {
      await memoryStore.close();
    }
  });
});

describe("channel isolation", () => {
  test("different channels get independent sessions", async () => {
    const { handler, driver } = makeHandler();
    await handler.handleMessage("chan-1", "hello");
    await handler.handleMessage("chan-2", "world");

    expect(driver.createdSessions).toHaveLength(2);
    expect(driver.createdSessions[0]?.id).not.toBe(
      driver.createdSessions[1]?.id,
    );
  });

  test("destroying one channel does not affect another", async () => {
    const { handler, driver } = makeHandler();
    await handler.ensureSession("chan-1");
    await handler.ensureSession("chan-2");

    await handler.destroySession("chan-1");
    expect(driver.activeSessionCount).toBe(1);
  });

  test("scoped session can inherit parent channel settings", async () => {
    const parentDriver = new FakeDriver({ name: "parent" });
    const fallbackDriver = new FakeDriver({ name: "fake" });
    const config = makeConfig({
      channels: {
        "parent-chan": {
          driver: "parent",
          model: "parent-model",
          agent: "parent-agent",
          tools: ["tool-a"],
        },
      },
    });

    const handler = new ChannelHandler(
      { fake: fallbackDriver, parent: parentDriver },
      config,
      new Map(),
      makeResolveAgent(),
      noopLogger,
    );

    await handler.handleMessage("reply:root-1", "hello", undefined, {
      settingsChannelId: "parent-chan",
    });

    const created = parentDriver.createdSessions[0];
    expect(created).toBeDefined();
    expect(created?.options.model).toBe("parent-model");
    expect(created?.options.tools).toEqual(["tool-a"]);
    expect(fallbackDriver.createdSessions).toHaveLength(0);
  });

  test("scoped session inherits parent runtime overrides", async () => {
    createAgentDir("parent-agent");
    const parentDriver = new FakeDriver({ name: "parent" });
    const fallbackDriver = new FakeDriver({ name: "fake" });
    const config = makeConfig({
      channels: {
        "parent-chan": {
          driver: "fake",
          model: "config-model",
          agent: "default",
          tools: ["tool-a"],
        },
      },
    });

    const handler = new ChannelHandler(
      { fake: fallbackDriver, parent: parentDriver },
      config,
      new Map(),
      makeResolveAgent(),
      noopLogger,
    );

    await handler.setDriverOverride("parent-chan", "parent");
    await handler.setModelOverride("parent-chan", "runtime-model");
    await handler.setAgentOverride("parent-chan", "parent-agent");

    await handler.handleMessage("reply:root-2", "hello", undefined, {
      settingsChannelId: "parent-chan",
    });

    const created = parentDriver.createdSessions[0];
    expect(created).toBeDefined();
    expect(created?.options.model).toBe("runtime-model");
    expect(fallbackDriver.createdSessions).toHaveLength(0);
    expect(handler.resolveAgentName("reply:root-2", "parent-chan")).toBe(
      "parent-agent",
    );
  });

  test("scoped session injects memory for the parent agent", async () => {
    const memoryStore = new MemoryStore(":memory:", noopLogger);
    await memoryStore.init();
    await memoryStore.save({
      scope: "agent:parent-agent",
      content: "Parent agent memory",
      createdBy: "agent:parent-agent",
      source: "agent",
    });

    try {
      const parentDriver = new FakeDriver({ name: "parent" });
      const fallbackDriver = new FakeDriver({ name: "fake" });
      const config = makeConfig({
        channels: {
          "parent-chan": {
            driver: "parent",
            agent: "parent-agent",
          },
        },
      });

      const handler = new ChannelHandler(
        { fake: fallbackDriver, parent: parentDriver },
        config,
        new Map(),
        makeResolveAgent(),
        noopLogger,
        memoryStore,
      );

      await handler.handleMessage("reply:root-3", "hello", undefined, {
        settingsChannelId: "parent-chan",
      });

      const systemPrompt =
        parentDriver.createdSessions[0]?.options.systemPrompt ?? "";
      expect(systemPrompt).toContain("# Memory");
      expect(systemPrompt).toContain("Parent agent memory");
      expect(fallbackDriver.createdSessions).toHaveLength(0);
    } finally {
      await memoryStore.close();
    }
  });

  test("bootstrap prompt is prepended only on first message", async () => {
    const { handler, driver } = makeHandler();
    let firstPrompt = "";
    let secondPrompt = "";

    driver.query = async (sessionId, prompt) => {
      if (!firstPrompt) {
        firstPrompt = prompt;
      } else {
        secondPrompt = prompt;
      }
      return { text: "ok", sessionId };
    };

    await handler.handleMessage(
      "reply:root-1",
      "first user message",
      undefined,
      {
        bootstrapPrompt: "Reply root message:\nroot text",
      },
    );
    await handler.handleMessage(
      "reply:root-1",
      "second user message",
      undefined,
      {
        bootstrapPrompt: "Reply root message:\nroot text",
      },
    );

    expect(firstPrompt).toContain("Reply root message:");
    expect(firstPrompt).toContain("root text");
    expect(firstPrompt).toContain("User message:\nfirst user message");
    expect(secondPrompt).toBe("second user message");
  });
});

describe("resolution", () => {
  test("resolveDriverName returns global default", () => {
    const { handler } = makeHandler();
    expect(handler.resolveDriverName("chan-1")).toBe("fake");
  });

  test("resolveDriverName uses channel config override", () => {
    const { handler } = makeHandler(undefined, {
      channels: { "chan-1": { driver: "other" } },
      drivers: {},
    });
    // "other" driver doesn't exist, but resolveDriverName just returns the name
    expect(handler.resolveDriverName("chan-1")).toBe("other");
  });

  test("resolveAgentName returns global default", () => {
    const { handler } = makeHandler();
    expect(handler.resolveAgentName("chan-1")).toBe("default");
  });

  test("resolveAgentName uses channel config override", () => {
    const { handler } = makeHandler(undefined, {
      channels: { "chan-1": { agent: "custom" } },
    });
    expect(handler.resolveAgentName("chan-1")).toBe("custom");
  });

  test("resolveModelName returns driver default", () => {
    const { handler } = makeHandler();
    expect(handler.resolveModelName("chan-1")).toBe("fake-model");
  });

  test("resolveModelName uses agent frontmatter", () => {
    const { handler } = makeHandler(undefined, undefined, {
      model: "agent-model",
    });
    expect(handler.resolveModelName("chan-1")).toBe("agent-model");
  });
});

describe("chat commands", () => {
  test("!driver show shows current driver", async () => {
    const { handler } = makeHandler();
    const result = await runCommand(handler, "driver show");

    expect(result?.message).toContain("Current driver:");
    expect(result?.message).toContain("`fake`");
  });

  test("!driver set switches driver", async () => {
    const alt = new FakeDriver({ name: "alt" });
    const config = makeConfig();
    const handler = new ChannelHandler(
      { fake: new FakeDriver(), alt },
      config,
      new Map(),
      makeResolveAgent(),
      noopLogger,
    );

    const result = await runCommand(handler, "driver set alt");
    expect(result?.message).toContain("Driver switched to `alt`");
    expect(handler.resolveDriverName("chan-1")).toBe("alt");
  });

  test("legacy !driver alt form is no longer supported", async () => {
    const alt = new FakeDriver({ name: "alt" });
    const config = makeConfig();
    const handler = new ChannelHandler(
      { fake: new FakeDriver(), alt },
      config,
      new Map(),
      makeResolveAgent(),
      noopLogger,
    );

    const result = await runCommand(handler, "driver alt");
    expect(result?.message).toBe("Unknown command `!driver alt`.");
    expect(handler.resolveDriverName("chan-1")).toBe("fake");
  });

  test("!driver set with invalid arg returns error", async () => {
    const { handler } = makeHandler();
    const result = await runCommand(handler, "driver set nope");

    expect(result?.message).toContain("Unknown driver");
  });

  test("!model show shows current model", async () => {
    const { handler } = makeHandler();
    const result = await runCommand(handler, "model show");

    expect(result?.message).toContain("Current model:");
    expect(result?.message).toContain("`fake-model`");
  });

  test("!model set switches model and resets session", async () => {
    const { handler, driver } = makeHandler();
    await handler.ensureSession("chan-1");

    const result = await runCommand(handler, "model set gpt-5");
    expect(result?.message).toContain("Model switched to `gpt-5`");
    expect(driver.activeSessionCount).toBe(0);
    expect(handler.resolveModelName("chan-1")).toBe("gpt-5");
  });

  test("!agent show shows current agent", async () => {
    const { handler } = makeHandler();
    const result = await runCommand(handler, "agent show");

    expect(result?.message).toContain("Current agent:");
    expect(result?.message).toContain("`default`");
  });

  test("!agent set switches agent", async () => {
    createAgentDir("other");
    const { handler } = makeHandler();

    const result = await runCommand(handler, "agent set other");
    expect(result?.message).toContain("Agent switched to `other`");
    expect(handler.resolveAgentName("chan-1")).toBe("other");
  });

  test("!agent set with invalid arg returns error", async () => {
    const { handler } = makeHandler();
    const result = await runCommand(handler, "agent set nonexistent");

    expect(result?.message).toContain("Unknown agent");
  });

  test("!agent skills lists current agent skills", async () => {
    const skillDir = resolve(
      tmpDir,
      "agents",
      "default",
      "skills",
      "local-skill",
    );
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      resolve(skillDir, Paths.SKILL_MD),
      "---\nname: local-skill\ndescription: Local skill\n---\nUse it.",
    );
    const { handler } = makeHandler();

    const result = await runCommand(handler, "agent skills");
    expect(result?.message).toContain("Skills for agent `default`");
    expect(result?.message).toContain("local-skill");
  });

  test("!session status returns driver, agent, model, session state", async () => {
    const { handler } = makeHandler();
    const result = await runCommand(handler, "session status");

    expect(result?.message).toContain("Driver:");
    expect(result?.message).toContain("Agent:");
    expect(result?.message).toContain("Model:");
    expect(result?.message).toContain("Active session: `false`");
  });

  test("!memory remember and !memory show manage memory entries", async () => {
    const memoryStore = new MemoryStore(":memory:", noopLogger);
    await memoryStore.init();
    const { handler } = makeHandler(
      undefined,
      undefined,
      undefined,
      memoryStore,
    );
    const memoryActions = buildMemoryCommandActions({
      memoryBackend: memoryStore,
      config: makeConfig(),
      resolveAgentName: (channelId: string) =>
        handler.resolveAgentName(channelId),
    });

    try {
      const rememberResult = await runCommand(
        handler,
        "memory remember Use AP style",
        {
          actions: {
            reload: async () => undefined,
            ...memoryActions,
          },
        },
      );
      const showResult = await runCommand(handler, "memory show", {
        actions: {
          reload: async () => undefined,
          ...memoryActions,
        },
      });

      expect(rememberResult?.message).toContain(
        "Saved to agent:default memory",
      );
      expect(showResult?.message).toContain("**Memory: agent:default**");
      expect(showResult?.message).toContain("Use AP style");
    } finally {
      await memoryStore.close();
    }
  });

  test("!memory forget accepts a unique short prefix", async () => {
    const memoryStore = new MemoryStore(":memory:", noopLogger);
    await memoryStore.init();
    const entry = await memoryStore.save({
      scope: "agent:default",
      content: "Forget me",
      createdBy: "user",
      source: "user",
    });
    const { handler } = makeHandler(
      undefined,
      undefined,
      undefined,
      memoryStore,
    );
    const memoryActions = buildMemoryCommandActions({
      memoryBackend: memoryStore,
      config: makeConfig(),
      resolveAgentName: (channelId: string) =>
        handler.resolveAgentName(channelId),
    });

    try {
      const prefix = entry.id.slice(0, 12);
      const result = await runCommand(handler, `memory forget ${prefix}`, {
        actions: {
          reload: async () => undefined,
          ...memoryActions,
        },
      });

      expect(result?.message).toContain('Archived: "Forget me"');
    } finally {
      await memoryStore.close();
    }
  });

  test("!memory forget returns a disambiguation message for ambiguous prefixes", async () => {
    const memoryStore = new MemoryStore(":memory:", noopLogger);
    await memoryStore.init();
    const first = await memoryStore.save({
      scope: "agent:default",
      content: "first",
      createdBy: "user",
      source: "user",
    });
    const second = await memoryStore.save({
      scope: "agent:default",
      content: "second",
      createdBy: "user",
      source: "user",
    });
    const { handler } = makeHandler(
      undefined,
      undefined,
      undefined,
      memoryStore,
    );
    const memoryActions = buildMemoryCommandActions({
      memoryBackend: memoryStore,
      config: makeConfig(),
      resolveAgentName: (channelId: string) =>
        handler.resolveAgentName(channelId),
    });

    try {
      const result = await runCommand(handler, "memory forget mem_", {
        actions: {
          reload: async () => undefined,
          ...memoryActions,
        },
      });

      expect(result?.message).toContain("Ambiguous memory ID prefix");
      expect(result?.message).toContain(first.id);
      expect(result?.message).toContain(second.id);
    } finally {
      await memoryStore.close();
    }
  });

  test("!memory stats returns formatted counts", async () => {
    const memoryStore = new MemoryStore(":memory:", noopLogger);
    await memoryStore.init();
    await memoryStore.save({
      scope: "agent:default",
      content: "one",
      createdBy: "user",
      source: "user",
    });
    const { handler } = makeHandler(
      undefined,
      undefined,
      undefined,
      memoryStore,
    );
    const memoryActions = buildMemoryCommandActions({
      memoryBackend: memoryStore,
      config: makeConfig(),
      resolveAgentName: (channelId: string) =>
        handler.resolveAgentName(channelId),
    });

    try {
      const result = await runCommand(handler, "memory stats", {
        actions: {
          reload: async () => undefined,
          ...memoryActions,
        },
      });

      expect(result?.message).toContain("**Memory Stats**");
      expect(result?.message).toContain("agent:default");
      expect(result?.message).toContain("Embeddings: disabled");
    } finally {
      await memoryStore.close();
    }
  });

  test("!memory reindex explains when embeddings are disabled", async () => {
    const memoryStore = new MemoryStore(":memory:", noopLogger);
    await memoryStore.init();
    await memoryStore.save({
      scope: "agent:default",
      content: "one",
      createdBy: "user",
      source: "user",
    });
    const { handler } = makeHandler(
      undefined,
      undefined,
      undefined,
      memoryStore,
    );
    const memoryActions = buildMemoryCommandActions({
      memoryBackend: memoryStore,
      config: makeConfig(),
      resolveAgentName: (channelId: string) =>
        handler.resolveAgentName(channelId),
    });

    try {
      const result = await runCommand(handler, "memory reindex", {
        actions: {
          reload: async () => undefined,
          ...memoryActions,
        },
      });

      expect(result?.message).toContain("Memory embeddings are disabled");
      expect(result?.message).toContain("Enable memory.embeddings.enabled");
    } finally {
      await memoryStore.close();
    }
  });

  test("!memory compact merges duplicate entries", async () => {
    const memoryStore = new MemoryStore(":memory:", noopLogger);
    await memoryStore.init();
    await memoryStore.save({
      scope: "agent:default",
      content: "Use AP style",
      createdBy: "user",
      source: "user",
    });
    await memoryStore.save({
      scope: "agent:default",
      content: "Use AP style",
      createdBy: "user",
      source: "user",
    });
    const { handler } = makeHandler(
      undefined,
      undefined,
      undefined,
      memoryStore,
    );
    const memoryActions = buildMemoryCommandActions({
      memoryBackend: memoryStore,
      config: makeConfig(),
      resolveAgentName: (channelId: string) =>
        handler.resolveAgentName(channelId),
    });

    try {
      const result = await runCommand(handler, "memory compact agent", {
        actions: {
          reload: async () => undefined,
          ...memoryActions,
        },
      });
      const activeEntries = await memoryStore.peek({
        scope: "agent:default",
        status: "active",
      });

      expect(result?.message).toContain("Compacted 2 entries into 1 summaries");
      expect(activeEntries).toHaveLength(1);
      expect(activeEntries[0]?.source).toBe("compaction");
    } finally {
      await memoryStore.close();
    }
  });

  test("!session status shows active session after message", async () => {
    const { handler } = makeHandler();
    await handler.ensureSession("chan-1");

    const result = await runCommand(handler, "session status");
    expect(result?.message).toContain("Active session: `true`");
  });

  test("!session new resets the current session", async () => {
    const { handler, driver } = makeHandler();
    await handler.ensureSession("chan-1");

    const result = await runCommand(handler, "session new");
    expect(result?.message).toContain("Session reset");
    expect(driver.activeSessionCount).toBe(0);
  });

  test("!system reload triggers frontend action", async () => {
    const { handler } = makeHandler();
    let reloaded = false;

    const result = await runCommand(handler, "system reload", {
      actions: {
        reload: async () => {
          reloaded = true;
          return undefined;
        },
      },
    });

    expect(reloaded).toBe(true);
    expect(result?.message).toContain("reloaded");
  });

  test("!system restart returns restart action", async () => {
    const { handler } = makeHandler();
    const result = await runCommand(handler, "system restart");

    expect(result).toEqual({ message: "Restarting...", action: "restart" });
  });

  test("!system quit is only available in the TUI", async () => {
    const { handler } = makeHandler();
    const discordResult = await runCommand(handler, "system quit");
    const tuiResult = await runCommand(handler, "system quit", {
      commandPrefix: "/",
      frontend: "tui",
    });

    expect(discordResult).toBeNull();
    expect(tuiResult).toEqual({ message: "Quitting...", action: "quit" });
  });

  test("!system reload is blocked for non-owner discord users", async () => {
    const { handler } = makeHandler();
    const result = await runCommand(handler, "system reload", {
      isOwner: false,
    });

    expect(result?.message).toBe("Only the bot owner can use this command.");
  });

  test("!help driver shows command-specific help", async () => {
    const { handler } = makeHandler();
    const result = await runCommand(handler, "help driver");

    expect(result?.message).toContain("!driver");
    expect(result?.message).toContain("!driver set <name>");
    expect(result?.message).toContain("!driver show");
  });

  test("!help returns top-level command list", async () => {
    const { handler } = makeHandler();
    const result = await runCommand(handler, "help");

    expect(result?.message).toContain("!agent");
    expect(result?.message).toContain("!driver");
    expect(result?.message).toContain("!model");
    expect(result?.message).toContain("!memory");
    expect(result?.message).toContain("!session");
    expect(result?.message).toContain("!system");
    expect(result?.message).toContain("!help");
    expect(result?.message).not.toContain("!new");
  });

  test("unknown command returns null", async () => {
    const { handler } = makeHandler();
    const result = await runCommand(handler, "bogus");

    expect(result).toBeNull();
  });
});

describe("reload", () => {
  test("reload destroys all sessions and updates config", async () => {
    const { handler, driver } = makeHandler();
    await handler.ensureSession("chan-1");
    await handler.ensureSession("chan-2");

    const newConfig = makeConfig({ defaultAgent: "reloaded" });
    await handler.reload(newConfig, new Map(), makeResolveAgent());

    expect(driver.activeSessionCount).toBe(0);
    expect(handler.resolveAgentName("chan-1")).toBe("reloaded");
  });
});

describe("error handling", () => {
  test("handleMessage returns error message on query failure", async () => {
    const driver = new FakeDriver();
    driver.queryError = new Error("query boom");
    const { handler } = makeHandler(driver);

    const result = await handler.handleMessage("chan-1", "hello");
    expect(result).toContain("query boom");
  });

  test("handleMessage returns error message on session creation failure", async () => {
    const driver = new FakeDriver();
    driver.createSessionError = new Error("session boom");
    const { handler } = makeHandler(driver);

    const result = await handler.handleMessage("chan-1", "hello");
    expect(result).toContain("session boom");
  });
});

describe("scripted responses", () => {
  test("FakeDriver returns scripted response based on prompt", async () => {
    const driver = new FakeDriver();
    driver.onPrompt("weather", "It's sunny!");
    const { handler } = makeHandler(driver);

    const result = await handler.handleMessage("chan-1", "What's the weather?");
    expect(result).toBe("It's sunny!");
  });
});
