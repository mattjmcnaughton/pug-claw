import {
  exportMemoryForCommand,
  parseMemoryScopeInput,
  renderMemoryEntries,
  renderMemorySearchResults,
  renderMemoryStats,
  resolveMemoryIdPrefix,
} from "./chat.ts";
import { searchMemory } from "./tools.ts";
import type { MemoryBackend, MemoryScope } from "./types.ts";
import { toError, type ResolvedConfig } from "../resources.ts";

interface MemoryCommandActionOptions {
  memoryBackend?: MemoryBackend;
  config: ResolvedConfig;
  resolveAgentName: (channelId: string) => string;
  getAvailableAgentNames: () => string[];
}

function resolveWritableScope(
  currentAgentName: string,
  scopeInput: string,
  availableAgentNames: string[],
): MemoryScope {
  const scope = parseMemoryScopeInput(currentAgentName, scopeInput);
  if (!scope.startsWith("agent:")) {
    return scope;
  }

  const agentName = scope.slice("agent:".length);
  if (!availableAgentNames.includes(agentName)) {
    throw new Error(`Unknown agent \`${agentName}\`.`);
  }

  return scope;
}

export function buildMemoryCommandActions(options: MemoryCommandActionOptions) {
  const { memoryBackend, config, resolveAgentName, getAvailableAgentNames } =
    options;

  const saveMemoryToScope = async (scope: MemoryScope, text: string) => {
    if (!memoryBackend) {
      return "Memory commands are not available.";
    }
    const entry = await memoryBackend.save({
      scope,
      content: text,
      createdBy: "user",
      source: "user",
    });
    return `Saved to ${scope} memory: \`${entry.id}\``;
  };

  return {
    showMemory: async (channelId: string, scopeInput?: string) => {
      if (!memoryBackend) {
        return "Memory commands are not available.";
      }
      const scope = parseMemoryScopeInput(
        resolveAgentName(channelId),
        scopeInput,
      );
      const entries = await memoryBackend.list({
        scope,
        limit: 20,
      });
      return renderMemoryEntries(scope, entries);
    },
    searchMemory: async (channelId: string, query: string) => {
      if (!memoryBackend) {
        return "Memory commands are not available.";
      }
      const agentName = resolveAgentName(channelId);
      const result = await searchMemory(
        {
          memoryBackend,
          actor: {
            type: "agent",
            agentName,
            createdBy: `agent:${agentName}`,
            source: "agent",
            canManageAllScopes: true,
          },
        },
        {
          query,
          limit: 10,
        },
      );
      return renderMemorySearchResults(query, result.results);
    },
    rememberMemory: async (channelId: string, text: string) => {
      if (!memoryBackend) {
        return "Memory commands are not available.";
      }

      const scope = resolveWritableScope(
        resolveAgentName(channelId),
        "agent",
        getAvailableAgentNames(),
      );
      return saveMemoryToScope(scope, text);
    },
    rememberScopedMemory: async (
      channelId: string,
      scopeInput: string,
      text: string,
    ) => {
      if (!memoryBackend) {
        return "Memory commands are not available.";
      }

      try {
        const scope = resolveWritableScope(
          resolveAgentName(channelId),
          scopeInput,
          getAvailableAgentNames(),
        );
        return saveMemoryToScope(scope, text);
      } catch (err) {
        return toError(err).message;
      }
    },
    forgetMemory: async (_channelId: string, idOrPrefix: string) => {
      if (!memoryBackend) {
        return "Memory commands are not available.";
      }
      const resolved = await resolveMemoryIdPrefix(memoryBackend, idOrPrefix);
      if (!resolved.ok) {
        if (resolved.reason === "ambiguous") {
          return [
            `Ambiguous memory ID prefix \`${idOrPrefix}\`. Matches:`,
            ...resolved.matches.map((match) => `- \`${match}\``),
          ].join("\n");
        }
        return `No active memory found for \`${idOrPrefix}\`.`;
      }

      const entry = await memoryBackend.get(resolved.id);
      if (!entry) {
        return `No active memory found for \`${idOrPrefix}\`.`;
      }
      await memoryBackend.archive(entry.id);
      return `Archived: "${entry.content}"`;
    },
    exportMemory: async (channelId: string, scopeInput?: string) => {
      if (!memoryBackend) {
        return "Memory commands are not available.";
      }
      const scope = parseMemoryScopeInput(
        resolveAgentName(channelId),
        scopeInput,
      );
      return exportMemoryForCommand(memoryBackend, config.internalDir, scope);
    },
    memoryStats: async () => {
      if (!memoryBackend) {
        return "Memory commands are not available.";
      }
      const stats = await memoryBackend.stats();
      const embeddingsLine = config.memory.embeddings.enabled
        ? `\n\nEmbeddings: enabled (${config.memory.embeddings.model})`
        : `\n\nEmbeddings: disabled (${config.memory.embeddings.model})`;
      return `${renderMemoryStats(stats)}${embeddingsLine}`;
    },
    reindexMemory: async () => {
      if (!memoryBackend?.reindex) {
        return "Memory reindex is not available.";
      }
      if (!config.memory.embeddings.enabled) {
        return `Memory embeddings are disabled (${config.memory.embeddings.model}). Enable memory.embeddings.enabled to reindex.`;
      }
      const count = await memoryBackend.reindex();
      return `Reindexed embeddings for ${count} memory entries.`;
    },
  };
}
