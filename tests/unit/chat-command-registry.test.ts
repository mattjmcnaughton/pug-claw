import { describe, expect, test } from "bun:test";
import { ChatCommandRegistry } from "../../src/chat-commands/registry.ts";
import type {
  ChatCommandEnvironment,
  ChatCommandHandler,
  ChatCommandNode,
} from "../../src/chat-commands/types.ts";

const noopHandler: ChatCommandHandler = {
  resetSession: async () => {},
  resolveDriverName: () => "fake",
  resolveModelName: () => "fake-model",
  resolveAgentName: () => "default",
  getAvailableDriverNames: () => [],
  getAvailableModelAliases: () => ({}),
  getAvailableAgentNames: () => [],
  getAgentSkills: () => ({ agentName: "default", skills: [] }),
  getStatus: () => ({
    driverName: "fake",
    model: "fake-model",
    agentName: "default",
    hasSession: false,
  }),
  setDriverOverride: async () => false,
  setModelOverride: async (_channelId: string, modelInput: string) =>
    modelInput,
  setAgentOverride: async () => false,
};

function makeEnv(
  overrides?: Partial<ChatCommandEnvironment>,
): ChatCommandEnvironment {
  return {
    channelId: "chan-1",
    commandPrefix: "!",
    frontend: "discord",
    isOwner: true,
    handler: noopHandler,
    actions: {
      reload: async () => {},
    },
    ...overrides,
  };
}

describe("ChatCommandRegistry", () => {
  const tree: ChatCommandNode = {
    name: "root",
    description: "root",
    children: {
      alpha: {
        name: "alpha",
        description: "Alpha parent",
        children: {
          show: {
            name: "show",
            description: "Show alpha",
            execute: async () => ({ message: "alpha-show" }),
          },
        },
        execute: async (ctx, args) => ({
          message:
            args.length === 0
              ? ctx.formatHelp(["alpha"])
              : `unknown:${ctx.formatCommand(["alpha", ...args])}`,
        }),
      },
      admin: {
        name: "admin",
        description: "Owner-only command",
        ownerOnly: true,
        execute: async () => ({ message: "admin" }),
      },
      tui: {
        name: "tui",
        description: "TUI-only command",
        frontends: ["tui"],
        execute: async () => ({ message: "tui" }),
      },
      nested: {
        name: "nested",
        description: "Nested command parent",
        ownerOnly: true,
        frontends: ["discord"],
        children: {
          run: {
            name: "run",
            description: "Run nested command",
            execute: async () => ({ message: "nested-run" }),
          },
        },
      },
      help: {
        name: "help",
        description: "Show help",
        execute: async (ctx, args) => ({ message: ctx.formatHelp(args) }),
      },
    },
  };

  const registry = new ChatCommandRegistry(tree);

  test("executes nested subcommands", async () => {
    const result = await registry.execute(makeEnv(), "alpha show");
    expect(result).toEqual({ message: "alpha-show" });
  });

  test("lets parent commands decide how to handle unknown subcommands", async () => {
    const result = await registry.execute(makeEnv(), "alpha nope");
    expect(result).toEqual({ message: "unknown:!alpha nope" });
  });

  test("formats root help with top-level commands only", () => {
    const result = registry.formatHelp(makeEnv());
    expect(result).toContain("!alpha");
    expect(result).toContain("!help");
    expect(result).not.toContain("!alpha show");
  });

  test("formats command-specific help", () => {
    const result = registry.formatHelp(makeEnv(), ["alpha"]);
    expect(result).toContain("!alpha");
    expect(result).toContain("!alpha show");
    expect(result).toContain("Subcommands");
  });

  test("hides owner-only commands from non-owner help", () => {
    const result = registry.formatHelp(makeEnv({ isOwner: false }));
    expect(result).not.toContain("!admin");
  });

  test("returns owner-only error when non-owner executes protected command", async () => {
    const result = await registry.execute(makeEnv({ isOwner: false }), "admin");
    expect(result).toEqual({
      message: "Only the bot owner can use this command.",
    });
  });

  test("filters commands by frontend", async () => {
    const discordResult = await registry.execute(makeEnv(), "tui");
    const tuiResult = await registry.execute(
      makeEnv({ commandPrefix: "/", frontend: "tui" }),
      "tui",
    );

    expect(discordResult).toBeNull();
    expect(tuiResult).toEqual({ message: "tui" });
  });

  test("applies owner-only restrictions from parent commands", async () => {
    const result = await registry.execute(
      makeEnv({ isOwner: false }),
      "nested run",
    );

    expect(result).toEqual({
      message: "Only the bot owner can use this command.",
    });
  });

  test("applies frontend restrictions from parent commands", async () => {
    const discordResult = await registry.execute(makeEnv(), "nested run");
    const tuiResult = await registry.execute(
      makeEnv({ commandPrefix: "/", frontend: "tui" }),
      "nested run",
    );

    expect(discordResult).toEqual({ message: "nested-run" });
    expect(tuiResult).toBeNull();
  });
});
