import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MemoryBackend, MemoryEntry, MemoryScope } from "./types.ts";

const USER_SCOPE: MemoryScope = "user:default";

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function formatTags(tags: string[]): string {
  if (tags.length === 0) {
    return "";
  }
  return ` [${tags.join(", ")}]`;
}

export function parseMemoryScopeInput(
  currentAgentName: string,
  scopeInput?: string,
): MemoryScope {
  const normalized = scopeInput?.trim().toLowerCase();
  if (!normalized || normalized === "agent") {
    return `agent:${currentAgentName}`;
  }
  if (normalized === "global") {
    return "global";
  }
  if (normalized === "user" || normalized === USER_SCOPE) {
    return USER_SCOPE;
  }
  if (normalized.startsWith("agent:")) {
    return normalized as MemoryScope;
  }
  throw new Error(
    `Invalid memory scope \`${scopeInput}\`. Use \`agent\`, \`agent:<name>\`, \`global\`, or \`user\`.`,
  );
}

export async function resolveMemoryIdPrefix(
  memoryBackend: MemoryBackend,
  idOrPrefix: string,
): Promise<
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" | "ambiguous"; matches: string[] }
> {
  const entries = await memoryBackend.peek({ status: "active" });
  const matches = entries
    .map((entry) => entry.id)
    .filter((id) => id.startsWith(idOrPrefix))
    .sort((left, right) => left.localeCompare(right));

  if (matches.length === 0) {
    return { ok: false, reason: "not_found", matches: [] };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous", matches };
  }
  return { ok: true, id: matches[0] ?? idOrPrefix };
}

export function renderMemoryEntries(
  scope: MemoryScope,
  entries: MemoryEntry[],
): string {
  const lines = [`**Memory: ${scope}** (${entries.length} entries)`];
  if (entries.length === 0) {
    lines.push("", "(none)");
    return lines.join("\n");
  }

  lines.push("");
  entries.forEach((entry, index) => {
    lines.push(
      `${index + 1}. \`${entry.id}\` ${entry.content}${formatTags(entry.tags)} (${formatDate(entry.createdAt)})`,
    );
  });
  return lines.join("\n");
}

export function renderMemorySearchResults(
  query: string,
  results: Array<{ entry: MemoryEntry; score: number }>,
): string {
  const lines = [`**Memory search: "${query}"** (${results.length} results)`];
  if (results.length === 0) {
    lines.push("", "(none)");
    return lines.join("\n");
  }

  lines.push("");
  results.forEach((result, index) => {
    lines.push(
      `${index + 1}. [${result.entry.scope}] \`${result.entry.id}\` ${result.entry.content} (${result.score.toFixed(2)})`,
    );
  });
  return lines.join("\n");
}

export function renderMemoryStats(stats: {
  totalEntries: number;
  activeEntries: number;
  archivedEntries: number;
  entriesByScope: Record<string, number>;
}): string {
  const lines = [
    "**Memory Stats**",
    "",
    `Total: ${stats.totalEntries} entries (${stats.activeEntries} active, ${stats.archivedEntries} archived)`,
    "",
    "By scope:",
  ];

  for (const [scope, count] of Object.entries(stats.entriesByScope).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    lines.push(`  ${scope.padEnd(18, " ")} ${count} entries`);
  }

  return lines.join("\n");
}

export async function exportMemoryForCommand(
  memoryBackend: MemoryBackend,
  internalDir: string,
  scope: MemoryScope,
): Promise<string> {
  const markdown = await memoryBackend.exportMarkdown(scope);
  if (markdown.length <= 1500) {
    return markdown;
  }

  const exportDir = resolve(internalDir, "memory-exports");
  mkdirSync(exportDir, { recursive: true });
  const exportPath = resolve(
    exportDir,
    `${scope.replace(/[:/]/g, "-")}-${Date.now()}.md`,
  );
  await writeFile(exportPath, markdown, "utf-8");
  return `Memory export written to ${exportPath}`;
}
