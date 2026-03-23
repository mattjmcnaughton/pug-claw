import { Defaults } from "../constants.ts";
import type { MemoryBackend, MemoryEntry, MemoryScope } from "./types.ts";

export interface MemoryCompactionResult {
  scopes: string[];
  createdEntries: number;
  compactedEntries: number;
}

function normalizeContent(content: string): string {
  return content.trim().toLowerCase();
}

function mergeTags(entries: MemoryEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => entry.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export async function compactMemories(
  memoryBackend: MemoryBackend,
  scope?: MemoryScope,
): Promise<MemoryCompactionResult> {
  const scopes = scope ? [scope] : await memoryBackend.listScopes();
  let createdEntries = 0;
  let compactedEntries = 0;

  for (const currentScope of scopes) {
    const entries = await memoryBackend.peek({
      scope: currentScope as MemoryScope,
      status: "active",
    });
    const groups = new Map<string, MemoryEntry[]>();
    const compactionEntries = new Map<string, MemoryEntry>();

    for (const entry of entries) {
      const key = normalizeContent(entry.content);
      if (entry.source === "compaction") {
        compactionEntries.set(key, entry);
        continue;
      }

      const existing = groups.get(key) ?? [];
      existing.push(entry);
      groups.set(key, existing);
    }

    for (const [key, group] of groups.entries()) {
      if (group.length === 0) {
        continue;
      }

      const existingCompactionEntry = compactionEntries.get(key);
      if (existingCompactionEntry) {
        const mergedTags = mergeTags([existingCompactionEntry, ...group]);
        if (
          JSON.stringify(mergedTags) !==
          JSON.stringify(existingCompactionEntry.tags)
        ) {
          await memoryBackend.update(existingCompactionEntry.id, {
            tags: mergedTags,
          });
        }
      } else if (group.length >= 2) {
        const newest = [...group].sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        )[0];
        if (!newest) {
          continue;
        }

        await memoryBackend.save({
          scope: currentScope as MemoryScope,
          content: newest.content,
          tags: mergeTags(group),
          createdBy: `system:${Defaults.MEMORY_COMPACTOR_AGENT}`,
          source: "compaction",
        });
        createdEntries += 1;
      } else {
        continue;
      }

      for (const entry of group) {
        const updated = await memoryBackend.update(entry.id, {
          status: "compacted",
        });
        if (updated) {
          compactedEntries += 1;
        }
      }
    }
  }

  return {
    scopes,
    createdEntries,
    compactedEntries,
  };
}
