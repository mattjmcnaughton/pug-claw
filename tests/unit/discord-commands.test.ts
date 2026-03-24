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
        global: [],
      },
    },
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
      isThread: () => false,
      send: mock(async (text: string) => {
        sent.push(text);
      }),
      sendTyping: mock(async () => {}),
    },
    _sent: sent,
  };
}

function makeReplyMessage(
  content: string,
  authorId: string,
  options?: {
    channelId?: string;
    messageId?: string;
    referenceMessageId?: string;
    rootMessageId?: string;
    rootContent?: string;
    chainReferenceId?: string;
    chainContent?: string;
    fetchThrows?: boolean;
  },
) {
  const sent: string[] = [];
  const channelId = options?.channelId ?? "chan-1";
  const messageId = options?.messageId ?? "msg-reply-1";
  const referenceMessageId = options?.referenceMessageId;
  const rootMessageId =
    options?.rootMessageId ?? referenceMessageId ?? "root-1";
  const rootContent = options?.rootContent ?? "root message";
  const chainReferenceId = options?.chainReferenceId;
  const chainContent = options?.chainContent ?? "intermediate message";

  const rootMessage = {
    id: rootMessageId,
    content: rootContent,
    reference: undefined,
    fetchReference: mock(async () => {
      throw new Error("no more references");
    }),
  };

  const chainedMessage = {
    id: chainReferenceId ?? "chain-1",
    content: chainContent,
    reference: { messageId: rootMessage.id },
    fetchReference: mock(async () => rootMessage),
  };

  return {
    content,
    author: { id: authorId, bot: false, tag: `user#${authorId}` },
    channelId,
    guildId: "guild-1",
    id: messageId,
    reference: referenceMessageId
      ? { messageId: referenceMessageId }
      : undefined,
    fetchReference: mock(async () => {
      if (options?.fetchThrows) {
        throw new Error("reference failed");
      }
      if (chainReferenceId) {
        return chainedMessage;
      }
      return rootMessage;
    }),
    channel: {
      id: channelId,
      name: "test-channel",
      isThread: () => false,
      send: mock(async (text: string) => {
        sent.push(text);
      }),
      sendTyping: mock(async () => {}),
    },
    _sent: sent,
  };
}

function makeThreadMessage(
  content: string,
  authorId: string,
  options?: {
    channelId?: string;
    parentId?: string;
    messageId?: string;
    starterContent?: string;
    starterFetchThrows?: boolean;
    referenceMessageId?: string;
    replyRootContent?: string;
    replyFetchThrows?: boolean;
  },
) {
  const sent: string[] = [];
  const channelId = options?.channelId ?? "thread-1";
  const parentId = options?.parentId ?? "chan-1";
  const messageId = options?.messageId ?? "thread-msg-1";
  const starterContent = options?.starterContent ?? "thread starter";
  const referenceMessageId = options?.referenceMessageId;

  const starterMessage = {
    id: `${channelId}-starter`,
    content: starterContent,
  };

  const replyRootMessage = {
    id: referenceMessageId ?? "thread-reply-root",
    content: options?.replyRootContent ?? "thread reply root",
    reference: undefined,
    fetchReference: mock(async () => {
      throw new Error("no more references");
    }),
  };

  return {
    content,
    author: { id: authorId, bot: false, tag: `user#${authorId}` },
    channelId,
    guildId: "guild-1",
    id: messageId,
    reference: referenceMessageId
      ? { messageId: referenceMessageId }
      : undefined,
    fetchReference: mock(async () => {
      if (options?.replyFetchThrows) {
        throw new Error("thread reply reference failed");
      }
      return replyRootMessage;
    }),
    channel: {
      id: channelId,
      parentId,
      name: "thread-channel",
      isThread: () => true,
      fetchStarterMessage: mock(async () => {
        if (options?.starterFetchThrows) {
          throw new Error("starter fetch failed");
        }
        return starterMessage;
      }),
      send: mock(async (text: string) => {
        sent.push(text);
      }),
      sendTyping: mock(async () => {}),
    },
    _sent: sent,
  };
}

function makeCtx(configOverrides?: Partial<ResolvedConfig>): FrontendContext & {
  driver: ReturnType<typeof makeMockDriver>;
  loggerSpies: Record<string, ReturnType<typeof mock>>;
} {
  const driver = makeMockDriver();
  const config = makeConfig(configOverrides);
  const loggerSpies = {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    fatal: mock(() => {}),
    debug: mock(() => {}),
  };
  return {
    drivers: { mock: driver },
    config,
    pluginDirs: new Map(),
    resolveAgent: () => ({
      systemPrompt: "system prompt",
      skills: [],
      memory: true,
    }),
    logger: loggerSpies as unknown as Logger,
    reloadConfig: mock(async () => ({
      config: makeConfig(configOverrides),
      pluginDirs: new Map<string, string>(),
      resolveAgent: () => ({
        systemPrompt: "reloaded system prompt",
        skills: [],
        memory: true,
      }),
    })),
    driver,
    loggerSpies,
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

describe("discord !system restart command", () => {
  test("blocked for non-owner", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!system restart", NON_OWNER_ID);
    await handler(msg);

    expect(msg.channel.send).toHaveBeenCalledTimes(1);
    expect(msg._sent[0]).toContain("Only the bot owner");
  });

  test("allowed for owner", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!system restart", OWNER_ID);

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
    const msg = makeMessage("!system restart", NON_OWNER_ID);
    await handler(msg);

    expect(msg._sent[0]).toContain("Only the bot owner");
  });
});

describe("discord !system reload command", () => {
  test("blocked for non-owner", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!system reload", NON_OWNER_ID);
    await handler(msg);

    expect(msg.channel.send).toHaveBeenCalledTimes(1);
    expect(msg._sent[0]).toContain("Only the bot owner");
  });

  test("allowed for owner and calls reloadConfig", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!system reload", OWNER_ID);
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
    const reloadMsg = makeMessage("!system reload", OWNER_ID);
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
    const msg = makeMessage("!system reload", OWNER_ID);
    await handler(msg);

    expect(msg._sent[0]).toContain("Command failed");
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

describe("discord reply handling", () => {
  test("reply message uses channel settings", async () => {
    const ctx = makeCtx({
      channels: {
        "chan-1": {
          driver: "mock",
          model: "reply-model",
          tools: ["tool-x"],
        },
      },
    });
    const handler = await startAndGetHandler(ctx);
    const msg = makeReplyMessage("hello", OWNER_ID, {
      channelId: "chan-1",
      messageId: "reply-123",
      referenceMessageId: "root-123",
      rootContent: "reply kickoff",
    });

    await handler(msg);

    expect(ctx.driver.createSession).toHaveBeenCalledTimes(1);
    const createSessionCalls = ctx.driver.createSession.mock
      .calls as unknown[][];
    const createSessionCall = createSessionCalls[0];
    expect(createSessionCall).toBeDefined();
    const createSessionInput = createSessionCall?.[0] as {
      model?: string;
      tools?: string[];
    };
    expect(createSessionInput.model).toBe("reply-model");
    expect(createSessionInput.tools).toEqual(["tool-x"]);
  });

  test("first reply preloads root content and second does not", async () => {
    const ctx = makeCtx();
    const prompts: string[] = [];
    const queryMock = mock(async (_sessionId: string, prompt: string) => {
      prompts.push(prompt);
      return { text: "ok", sessionId: "session-1" };
    });
    ctx.driver.query = queryMock as typeof ctx.driver.query;
    const handler = await startAndGetHandler(ctx);

    const first = makeReplyMessage("first", OWNER_ID, {
      channelId: "chan-1",
      messageId: "reply-first",
      referenceMessageId: "root-abc",
      rootContent: "root reply",
    });
    await handler(first);

    const second = makeReplyMessage("second", OWNER_ID, {
      channelId: "chan-1",
      messageId: "reply-second",
      referenceMessageId: "root-abc",
      rootContent: "root reply",
    });
    await handler(second);

    expect(prompts[0]).toContain("Reply root message:\nroot reply");
    expect(prompts[0]).toContain("User message:\nfirst");
    expect(prompts[1]).toBe("second");
  });

  test("reply root fetch failures do not block responses", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeReplyMessage("hello", OWNER_ID, {
      referenceMessageId: "root-fail",
      fetchThrows: true,
    });

    await handler(msg);

    expect(ctx.driver.query).toHaveBeenCalledTimes(1);
    const queryCalls = ctx.driver.query.mock.calls as unknown[][];
    const queryCall = queryCalls[0];
    expect(queryCall).toBeDefined();
    const prompt = queryCall?.[1] as string;
    expect(prompt).toBe("hello");
  });

  test("reply chain uses root message as session key and bootstrap", async () => {
    const ctx = makeCtx();
    const prompts: string[] = [];
    const queryMock = mock(async (_sessionId: string, prompt: string) => {
      prompts.push(prompt);
      return { text: "ok", sessionId: "session-1" };
    });
    ctx.driver.query = queryMock as typeof ctx.driver.query;
    const handler = await startAndGetHandler(ctx);

    const msg = makeReplyMessage("hello chain", OWNER_ID, {
      messageId: "reply-chain",
      referenceMessageId: "mid-1",
      rootMessageId: "root-1",
      chainReferenceId: "mid-1",
      chainContent: "middle",
      rootContent: "root-most",
    });
    await handler(msg);

    expect(prompts[0]).toContain("Reply root message:\nroot-most");
    expect(prompts[0]).toContain("User message:\nhello chain");
  });
});

describe("discord thread handling", () => {
  test("thread message uses parent channel settings", async () => {
    const ctx = makeCtx({
      channels: {
        "chan-1": {
          driver: "mock",
          model: "thread-model",
          tools: ["thread-tool"],
        },
      },
    });
    const handler = await startAndGetHandler(ctx);
    const msg = makeThreadMessage("hello", OWNER_ID, {
      channelId: "thread-42",
      parentId: "chan-1",
      starterContent: "thread intro",
    });

    await handler(msg);

    expect(ctx.driver.createSession).toHaveBeenCalledTimes(1);
    const createSessionCalls = ctx.driver.createSession.mock
      .calls as unknown[][];
    const createSessionCall = createSessionCalls[0];
    expect(createSessionCall).toBeDefined();
    const createSessionInput = createSessionCall?.[0] as {
      model?: string;
      tools?: string[];
    };
    expect(createSessionInput.model).toBe("thread-model");
    expect(createSessionInput.tools).toEqual(["thread-tool"]);
  });

  test("first thread message bootstraps starter and second does not", async () => {
    const ctx = makeCtx();
    const prompts: string[] = [];
    const queryMock = mock(async (_sessionId: string, prompt: string) => {
      prompts.push(prompt);
      return { text: "ok", sessionId: "session-1" };
    });
    ctx.driver.query = queryMock as typeof ctx.driver.query;
    const handler = await startAndGetHandler(ctx);

    const first = makeThreadMessage("first", OWNER_ID, {
      channelId: "thread-1",
      starterContent: "starter text",
    });
    await handler(first);

    const second = makeThreadMessage("second", OWNER_ID, {
      channelId: "thread-1",
      starterContent: "starter text",
      messageId: "thread-msg-2",
    });
    await handler(second);

    expect(prompts[0]).toContain("Thread starter message:\nstarter text");
    expect(prompts[0]).toContain("User message:\nfirst");
    expect(prompts[1]).toBe("second");
  });

  test("thread starter fetch failures do not block responses", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeThreadMessage("hello", OWNER_ID, {
      channelId: "thread-fail",
      starterFetchThrows: true,
    });

    await handler(msg);

    expect(ctx.driver.query).toHaveBeenCalledTimes(1);
    const queryCalls = ctx.driver.query.mock.calls as unknown[][];
    const queryCall = queryCalls[0];
    expect(queryCall).toBeDefined();
    const prompt = queryCall?.[1] as string;
    expect(prompt).toBe("hello");
    expect(ctx.loggerSpies.warn).toHaveBeenCalledTimes(1);
  });

  test("reply inside thread uses thread scope", async () => {
    const ctx = makeCtx();
    const prompts: string[] = [];
    const queryMock = mock(async (_sessionId: string, prompt: string) => {
      prompts.push(prompt);
      return { text: "ok", sessionId: "session-1" };
    });
    ctx.driver.query = queryMock as typeof ctx.driver.query;
    const handler = await startAndGetHandler(ctx);

    const first = makeThreadMessage("thread reply one", OWNER_ID, {
      channelId: "thread-priority",
      messageId: "thread-priority-1",
      starterContent: "thread-level context",
      referenceMessageId: "reply-root-1",
      replyRootContent: "reply context",
    });
    await handler(first);

    const second = makeThreadMessage("thread reply two", OWNER_ID, {
      channelId: "thread-priority",
      messageId: "thread-priority-2",
      starterContent: "thread-level context",
      referenceMessageId: "reply-root-2",
      replyRootContent: "different reply context",
    });
    await handler(second);

    expect(ctx.driver.createSession).toHaveBeenCalledTimes(1);
    expect(prompts[0]).toContain(
      "Thread starter message:\nthread-level context",
    );
    expect(prompts[0]).not.toContain("Reply root message:");
    expect(prompts[1]).toBe("thread reply two");
    expect(first.fetchReference).not.toHaveBeenCalled();
    expect(second.fetchReference).not.toHaveBeenCalled();
  });
});

describe("discord !memory command", () => {
  test("blocked for non-owner", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!memory show", NON_OWNER_ID);
    await handler(msg);

    expect(msg._sent[0]).toContain("Only the bot owner");
    expect(ctx.driver.query).not.toHaveBeenCalled();
  });
});

describe("discord !schedule command", () => {
  test("shows usage when no subcommand given", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!schedule", OWNER_ID);
    await handler(msg);

    expect(msg._sent[0]).toContain("Usage:");
  });

  test("shows usage when subcommand is not 'run'", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!schedule status heartbeat", OWNER_ID);
    await handler(msg);

    expect(msg._sent[0]).toContain("Usage:");
  });

  test("shows usage when schedule name is missing", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!schedule run", OWNER_ID);
    await handler(msg);

    expect(msg._sent[0]).toContain("Usage:");
  });

  test("passes schedule name through when given", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!schedule run heartbeat", OWNER_ID);
    await handler(msg);

    // No scheduler runtime, so it should report unknown schedule (not usage)
    expect(msg._sent[0]).toContain('Unknown schedule "heartbeat"');
  });

  test("blocked for non-owner", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!schedule run heartbeat", NON_OWNER_ID);
    await handler(msg);

    expect(msg._sent[0]).toContain("Only the bot owner");
  });
});

describe("discord unknown commands", () => {
  test("legacy !reload form is treated as an unknown command", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!reload", OWNER_ID);
    await handler(msg);

    expect(msg._sent[0]).toContain("Unknown command");
    expect(ctx.driver.query).not.toHaveBeenCalled();
  });

  test("legacy !schedules form is treated as an unknown command", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!schedules", OWNER_ID);
    await handler(msg);

    expect(msg._sent[0]).toContain("Unknown command");
    expect(ctx.driver.query).not.toHaveBeenCalled();
  });
});

describe("discord help text", () => {
  test("root help includes the system command namespace", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!help", OWNER_ID);
    await handler(msg);

    const helpText = msg._sent[0];
    expect(helpText).toContain("!system");
    expect(helpText).not.toContain("!reload");
  });

  test("command-specific help shows system subcommands", async () => {
    const ctx = makeCtx();
    const handler = await startAndGetHandler(ctx);
    const msg = makeMessage("!help system", OWNER_ID);
    await handler(msg);

    const helpText = msg._sent[0];
    expect(helpText).toContain("!system reload");
    expect(helpText).toContain("!system restart");
  });
});
