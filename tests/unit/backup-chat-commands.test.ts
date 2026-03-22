import { describe, expect, test } from "bun:test";
import { ChatCommandRegistry } from "../../src/chat-commands/registry.ts";
import { createChatCommandTree } from "../../src/chat-commands/tree.ts";
import type {
  ChatCommandEnvironment,
  ChatCommandHandler,
} from "../../src/chat-commands/types.ts";

const noopHandler: ChatCommandHandler = {
  resetSession: async () => {},
  resolveDriverName: () => "claude",
  resolveModelName: () => "claude-sonnet",
  resolveAgentName: () => "default",
  getAvailableDriverNames: () => [],
  getAvailableModelAliases: () => ({}),
  getAvailableAgentNames: () => [],
  getAgentSkills: () => ({ agentName: "default", skills: [] }),
  getStatus: () => ({
    driverName: "claude",
    model: "claude-sonnet",
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
      reload: async () => undefined,
      exportBackup: async () => "backup exported",
      dryRunBackup: async () => "backup dry run",
    },
    ...overrides,
  };
}

describe("backup chat commands", () => {
  const registry = new ChatCommandRegistry(createChatCommandTree());

  test("help includes the backup namespace", () => {
    const help = registry.formatHelp(makeEnv());
    expect(help).toContain("!backup");
  });

  test("backup export delegates to frontend actions", async () => {
    const result = await registry.execute(makeEnv(), "backup export");
    expect(result).toEqual({ message: "backup exported" });
  });

  test("backup dryrun delegates to frontend actions", async () => {
    const result = await registry.execute(makeEnv(), "backup dryrun");
    expect(result).toEqual({ message: "backup dry run" });
  });

  test("backup commands show an unavailable message when actions are missing", async () => {
    const result = await registry.execute(
      makeEnv({
        actions: {
          reload: async () => undefined,
        },
      }),
      "backup export",
    );

    expect(result).toEqual({
      message: "Backup commands are not available.",
    });
  });
});
