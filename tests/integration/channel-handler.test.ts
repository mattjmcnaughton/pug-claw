import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { ChannelHandler } from "../../src/channel-handler.ts";
import type { Logger } from "../../src/logger.ts";
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
    dataDir: "/tmp/test/data",
    logsDir: "/tmp/test/logs",
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
): { handler: ChannelHandler; driver: FakeDriver } {
  const d = driver ?? new FakeDriver();
  const config = makeConfig(configOverrides);
  const handler = new ChannelHandler(
    { fake: d },
    config,
    new Map(),
    makeResolveAgent(resolveAgentOverrides),
    noopLogger,
    "!",
  );
  return { handler, driver: d };
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

describe("handleCommand", () => {
  test("!new destroys session and returns message", async () => {
    const { handler, driver } = makeHandler();
    await handler.ensureSession("chan-1");

    const result = await handler.handleCommand("chan-1", "new", "");
    expect(result).toContain("Session reset");
    expect(driver.activeSessionCount).toBe(0);
  });

  test("!driver with no arg shows current driver", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleCommand("chan-1", "driver", "");

    expect(result).toContain("Current driver:");
    expect(result).toContain("`fake`");
  });

  test("!driver with valid arg switches driver", async () => {
    const alt = new FakeDriver({ name: "alt" });
    const config = makeConfig();
    const handler = new ChannelHandler(
      { fake: new FakeDriver(), alt },
      config,
      new Map(),
      makeResolveAgent(),
      noopLogger,
      "!",
    );

    const result = await handler.handleCommand("chan-1", "driver", "alt");
    expect(result).toContain("Driver switched to `alt`");
    expect(handler.resolveDriverName("chan-1")).toBe("alt");
  });

  test("!driver with invalid arg returns error", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleCommand("chan-1", "driver", "nope");

    expect(result).toContain("Unknown driver");
  });

  test("!model with no arg shows current model", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleCommand("chan-1", "model", "");

    expect(result).toContain("Current model:");
    expect(result).toContain("`fake-model`");
  });

  test("!model with arg switches model and resets session", async () => {
    const { handler, driver } = makeHandler();
    await handler.ensureSession("chan-1");

    const result = await handler.handleCommand("chan-1", "model", "gpt-5");
    expect(result).toContain("Model switched to `gpt-5`");
    expect(driver.activeSessionCount).toBe(0);
    expect(handler.resolveModelName("chan-1")).toBe("gpt-5");
  });

  test("!agent with no arg shows current agent", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleCommand("chan-1", "agent", "");

    expect(result).toContain("Current agent:");
    expect(result).toContain("`default`");
  });

  test("!agent with valid arg switches agent", async () => {
    createAgentDir("other");
    const { handler } = makeHandler();

    const result = await handler.handleCommand("chan-1", "agent", "other");
    expect(result).toContain("Agent switched to `other`");
    expect(handler.resolveAgentName("chan-1")).toBe("other");
  });

  test("!agent with invalid arg returns error", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleCommand(
      "chan-1",
      "agent",
      "nonexistent",
    );

    expect(result).toContain("Unknown agent");
  });

  test("!status returns driver, agent, model, session state", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleCommand("chan-1", "status", "");

    expect(result).toContain("Driver:");
    expect(result).toContain("Agent:");
    expect(result).toContain("Model:");
    expect(result).toContain("Active session: `false`");
  });

  test("!status shows active session after message", async () => {
    const { handler } = makeHandler();
    await handler.ensureSession("chan-1");

    const result = await handler.handleCommand("chan-1", "status", "");
    expect(result).toContain("Active session: `true`");
  });

  test("!help returns command list", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleCommand("chan-1", "help", "");

    expect(result).toContain("!new");
    expect(result).toContain("!driver");
    expect(result).toContain("!model");
    expect(result).toContain("!agent");
    expect(result).toContain("!skills");
    expect(result).toContain("!status");
    expect(result).toContain("!help");
  });

  test("unknown command returns null", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleCommand("chan-1", "bogus", "");

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
