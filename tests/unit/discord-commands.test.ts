import { describe, expect, mock, test } from "bun:test";
import type { FrontendContext } from "../../src/frontends/types.ts";
import type { Logger } from "../../src/logger.ts";
import type { ResolvedConfig } from "../../src/resources.ts";

// Capture the messageCreate handler registered by DiscordFrontend.start()
let messageCreateHandler: ((message: unknown) => Promise<void>) | null = null;

// Mock discord.js before importing the frontend
mock.module("discord.js", () => ({
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 3,
  },
  Client: class MockClient {
    user = { tag: "test-bot#1234", id: "bot-id" };
    guilds = { cache: { map: () => [] } };

    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "messageCreate") {
        messageCreateHandler = handler as typeof messageCreateHandler;
      }
    }

    async login() {
      return "mock-token";
    }
  },
}));

// Import after mocking
const { DiscordFrontend } = await import("../../src/frontends/discord.ts");

const OWNER_ID = "owner-123";
const NON_OWNER_ID = "rando-456";

function makeConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    homeDir: "/tmp/test",
    agentsDir: "/tmp/test/agents",
    skillsDir: "/tmp/test/skills",
    dataDir: "/tmp/test/data",
    logsDir: "/tmp/test/logs",
    defaultAgent: "default",
    defaultDriver: "mock",
    drivers: {},
    channels: {},
    schedules: {},
    discord: { guildId: "guild-1", ownerId: OWNER_ID },
    secrets: {
      get: () => undefined,
      require: (k: string) => k,
    },
    ...overrides,
  };
}

function makeMockDriver() {
  return {
    name: "mock",
    availableModels: {},
    defaultModel: "mock-model",
    createSession: mock(async () => "session-1"),
    query: mock(async () => ({ text: "hi", sessionId: "session-1" })),
    destroySession: mock(async () => {}),
  };
}

function makeMessage(content: string, authorId: string) {
  const sent: string[] = [];
  return {
    content,
    author: { id: authorId, bot: false, tag: `user#${authorId}` },
    channelId: "chan-1",
    guildId: "guild-1",
    id: "msg-1",
    channel: {
      name: "test-channel",
      send: mock(async (text: string) => {
        sent.push(text);
      }),
      sendTyping: mock(async () => {}),
    },
    _sent: sent,
  };
}

function makeCtx(
  configOverrides?: Partial<ResolvedConfig>,
): FrontendContext & { driver: ReturnType<typeof makeMockDriver> } {
  const driver = makeMockDriver();
  const config = makeConfig(configOverrides);
  return {
    drivers: { mock: driver },
    config,
    pluginDirs: new Map(),
    resolveAgent: () => ({
      systemPrompt: "system prompt",
      skills: [],
    }),
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      debug: () => {},
    } as unknown as Logger,
    reloadConfig: mock(async () => ({
      config: makeConfig(configOverrides),
      pluginDirs: new Map<string, string>(),
      resolveAgent: () => ({
        systemPrompt: "reloaded system prompt",
        skills: [],
      }),
    })),
    driver,
  };
}

async function startAndGetHandler(
  ctx: FrontendContext,
): Promise<(message: unknown) => Promise<void>> {
  messageCreateHandler = null;
  // start() awaits client.login() which is mocked, then the frontend
  // registers handlers synchronously. We don't want to block on the
  // infinite keepalive, so we don't await the full promise.
  const frontend = new DiscordFrontend();
  frontend.start(ctx);
  // Give the event loop a tick for the synchronous handler registration
  await new Promise((r) => setTimeout(r, 10));
  if (!messageCreateHandler) throw new Error("messageCreate handler not set");
  return messageCreateHandler;
}

describe("discord message filtering", () => {
  test("ignores bot messages", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("hello", OWNER_ID);
    msg.author.bot = true;
    await handler(msg);

    expect(msg.channel.send).not.toHaveBeenCalled();
    expect(ctx.driver.query).not.toHaveBeenCalled();
  });

  test("ignores messages from wrong guild", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("hello", OWNER_ID);
    msg.guildId = "other-guild";
    await handler(msg);

    expect(msg.channel.send).not.toHaveBeenCalled();
    expect(ctx.driver.query).not.toHaveBeenCalled();
  });

  test("processes messages when no guildId filter is configured", async () => {
    const ctx = makeCtx({ discord: undefined });
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("hello", OWNER_ID);
    msg.guildId = "any-guild";
    await handler(msg);

    expect(ctx.driver.query).toHaveBeenCalledTimes(1);
  });
});

describe("discord message chunking", () => {
  test("chunks long responses at 2000 characters", async () => {
    const ctx = makeCtx();
    const longText = "x".repeat(4500);
    ctx.driver.query = mock(async () => ({
      text: longText,
      sessionId: "session-1",
    }));
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("hello", OWNER_ID);
    await handler(msg);

    // 4500 chars should be split into 3 messages: 2000 + 2000 + 500
    expect(msg._sent).toHaveLength(3);
    expect(msg._sent[0]).toHaveLength(2000);
    expect(msg._sent[1]).toHaveLength(2000);
    expect(msg._sent[2]).toHaveLength(500);
  });

  test("sends (no response) for empty response", async () => {
    const ctx = makeCtx();
    ctx.driver.query = mock(async () => ({
      text: "   ",
      sessionId: "session-1",
    }));
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("hello", OWNER_ID);
    await handler(msg);

    expect(msg._sent).toContain("(no response)");
  });
});

describe("discord !restart command", () => {
  test("blocked for non-owner", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!restart", NON_OWNER_ID);
    await handler(msg);

    expect(msg.channel.send).toHaveBeenCalledTimes(1);
    expect(msg._sent[0]).toContain("Only the bot owner");
  });

  test("allowed for owner", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!restart", OWNER_ID);

    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = mock(((code: number) => {
      exitCode = code;
    }) as typeof process.exit);

    try {
      await handler(msg);
      expect(msg._sent[0]).toBe("Restarting...");
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });

  test("blocked when ownerId is not configured", async () => {
    const ctx = makeCtx({ discord: undefined });
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!restart", NON_OWNER_ID);
    await handler(msg);

    expect(msg._sent[0]).toContain("Only the bot owner");
  });
});

describe("discord !reload command", () => {
  test("blocked for non-owner", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!reload", NON_OWNER_ID);
    await handler(msg);

    expect(msg.channel.send).toHaveBeenCalledTimes(1);
    expect(msg._sent[0]).toContain("Only the bot owner");
  });

  test("allowed for owner and calls reloadConfig", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!reload", OWNER_ID);
    await handler(msg);

    expect(ctx.reloadConfig).toHaveBeenCalledTimes(1);
    expect(msg._sent[0]).toContain("reloaded");
  });

  test("destroys active sessions on reload", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);

    // Send a normal message first to create a session
    const chatMsg = makeMessage("hello", OWNER_ID);
    await handler(chatMsg);
    expect(ctx.driver.createSession).toHaveBeenCalledTimes(1);

    // Now reload
    const reloadMsg = makeMessage("!reload", OWNER_ID);
    await handler(reloadMsg);

    expect(ctx.driver.destroySession).toHaveBeenCalled();

    // Next message should create a new session
    const chatMsg2 = makeMessage("hello again", OWNER_ID);
    await handler(chatMsg2);
    expect(ctx.driver.createSession).toHaveBeenCalledTimes(2);
  });

  test("reports error when reloadConfig fails", async () => {
    const ctx = makeCtx();
    ctx.reloadConfig = mock(async () => {
      throw new Error("bad config");
    });
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!reload", OWNER_ID);
    await handler(msg);

    expect(msg._sent[0]).toContain("Reload failed");
    expect(msg._sent[0]).toContain("bad config");
  });
});

describe("discord query event callback", () => {
  test("driver.query is called with an onEvent callback", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("hello", OWNER_ID);
    await handler(msg);

    expect(ctx.driver.query).toHaveBeenCalledTimes(1);
    const callArgs = ctx.driver.query.mock.calls[0] as unknown[];
    expect(callArgs[0]).toBe("session-1");
    expect(callArgs[1]).toBe("hello");
    expect(typeof callArgs[2]).toBe("function");
  });

  test("sendTyping is called during query execution", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("hello", OWNER_ID);
    await handler(msg);

    expect(msg.channel.sendTyping).toHaveBeenCalled();
  });
});

describe("discord help text", () => {
  test("includes reload and restart commands", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!help", OWNER_ID);
    await handler(msg);

    const helpText = msg._sent[0];
    expect(helpText).toContain("!reload");
    expect(helpText).toContain("!restart");
  });
});
