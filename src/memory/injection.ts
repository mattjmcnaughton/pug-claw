import type { MemoryBackend, MemoryEntry, MemoryScope } from "./types.ts";

const CHARS_PER_TOKEN = 4;
const USER_SCOPE = "user:default";

function estimateCharsForTokens(tokens: number): number {
  return Math.max(0, tokens) * CHARS_PER_TOKEN;
}

function scopePriority(scope: string, agentScope: string): number {
  if (scope === agentScope) {
    return 0;
  }
  if (scope === USER_SCOPE) {
    return 1;
  }
  return 2;
}

function compareEntries(
  left: MemoryEntry,
  right: MemoryEntry,
  agentScope: string,
): number {
  const priorityDiff =
    scopePriority(left.scope, agentScope) -
    scopePriority(right.scope, agentScope);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const accessedDiff =
    new Date(right.accessedAt).getTime() - new Date(left.accessedAt).getTime();
  if (accessedDiff !== 0) {
    return accessedDiff;
  }

  return (
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function truncateToFit(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  if (maxChars <= 1) {
    return "";
  }

  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function renderSection(
  title: string,
  entries: MemoryEntry[],
  remainingChars: number,
): { text: string; usedChars: number } {
  if (entries.length === 0 || remainingChars <= 0) {
    return { text: "", usedChars: 0 };
  }

  const lines: string[] = [title];
  let usedChars = title.length;

  for (const entry of entries) {
    const prefix = "- ";
    const lineBudget = remainingChars - usedChars - 1;
    if (lineBudget <= prefix.length) {
      break;
    }

    const line = `${prefix}${truncateToFit(entry.content, lineBudget - prefix.length)}`;
    lines.push(line);
    usedChars += line.length + 1;
  }

  if (lines.length === 1) {
    return { text: "", usedChars: 0 };
  }

  const text = lines.join("\n");
  return { text, usedChars: text.length };
}

export function buildMemoryBlock(
  entries: MemoryEntry[],
  agentName: string,
  budgetTokens: number,
): string {
  if (entries.length === 0 || budgetTokens <= 0) {
    return "";
  }

  const agentScope: MemoryScope = `agent:${agentName}`;
  const sortedEntries = [...entries].sort((left, right) =>
    compareEntries(left, right, agentScope),
  );

  const charBudget = estimateCharsForTokens(budgetTokens);
  const selectedEntries: MemoryEntry[] = [];
  let usedChars = "# Memory\n".length;

  for (const entry of sortedEntries) {
    const lineEstimate = entry.content.length + 4;
    if (selectedEntries.length > 0 && usedChars + lineEstimate > charBudget) {
      break;
    }
    selectedEntries.push(entry);
    usedChars += lineEstimate;
  }

  if (selectedEntries.length === 0) {
    return "";
  }

  const agentEntries = selectedEntries.filter(
    (entry) => entry.scope === agentScope,
  );
  const userEntries = selectedEntries.filter(
    (entry) => entry.scope === USER_SCOPE,
  );
  const globalEntries = selectedEntries.filter(
    (entry) => entry.scope === "global",
  );

  const sections: string[] = ["# Memory"];
  let remainingChars = charBudget - sections[0].length;

  for (const render of [
    () =>
      renderSection(
        `## Your Memory (${agentScope})`,
        agentEntries,
        remainingChars,
      ),
    () => renderSection("## About the User", userEntries, remainingChars),
    () => renderSection("## Shared Knowledge", globalEntries, remainingChars),
  ]) {
    const rendered = render();
    if (!rendered.text) {
      continue;
    }
    sections.push("", rendered.text);
    remainingChars -= rendered.usedChars;
  }

  return sections.join("\n");
}

export async function buildMemoryBlockForAgent(
  memoryBackend: MemoryBackend,
  agentName: string,
  budgetTokens: number,
): Promise<string> {
  const agentScope: MemoryScope = `agent:${agentName}`;
  const entries = await Promise.all([
    memoryBackend.peek({ scope: agentScope, status: "active", limit: 20 }),
    memoryBackend.peek({ scope: USER_SCOPE, status: "active", limit: 20 }),
    memoryBackend.peek({ scope: "global", status: "active", limit: 20 }),
  ]);

  return buildMemoryBlock(entries.flat(), agentName, budgetTokens);
}
