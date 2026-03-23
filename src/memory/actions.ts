import {
  exportMemoryForCommand,
  parseMemoryScopeInput,
  renderMemoryEntries,
  renderMemorySearchResults,
  renderMemoryStats,
  resolveMemoryIdPrefix,
} from "./chat.ts";
import { searchMemory } from "./tools.ts";
import type { MemoryBackend } from "./types.ts";
import type { ResolvedConfig } from "../resources.ts";

interface MemoryCommandActionOptions {
  memoryBackend?: MemoryBackend;
  config: ResolvedConfig;
  resolveAgentName: (channelId: string) => string;
}

export function buildMemoryCommandActions(
  options: MemoryCommandActionOptions,
) {
  const { memoryBackend, config, resolveAgentName } = options;

  return {
    showMemory: async (channelId: string, scopeInput?: string) => {
      if (!memoryBackend) {
        return "Memory commands are not available.";
      }
      const scope = parseMemoryScopeInput(resolveAgentName(channelId), scopeInput);
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
      const result = await searchMemory(
        {
          memoryBackend,
          actor: {
            type: "agent",
            agentName: resolveAgentName(channelId),
            createdBy: `agent:${resolveAgentName(channelId)}`,
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
      const scope = `agent:${resolveAgentName(channelId)}` as const;
      const entry = await memoryBackend.save({
        scope,
        content: text,
        createdBy: "user",
        source: "user",
      });
      return `Saved to ${scope} memory: \`${entry.id}\``;
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
      const scope = parseMemoryScopeInput(resolveAgentName(channelId), scopeInput);
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
  };
}
