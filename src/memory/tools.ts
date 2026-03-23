import type {
  MemoryBackend,
  MemoryEntry,
  MemorySearchResult,
  MemoryScope,
  MemorySource,
} from "./types.ts";

const USER_SCOPE: MemoryScope = "user:default";

export interface MemoryToolActor {
  type: "agent" | "system";
  agentName?: string;
  createdBy: string;
  source: MemorySource;
  canManageAllScopes?: boolean;
}

export interface MemoryToolContext {
  memoryBackend: MemoryBackend;
  actor: MemoryToolActor;
}

export interface SaveMemoryArgs {
  content: string;
  scope?: "agent" | "global" | "user";
  tags?: string[];
}

export interface SearchMemoryArgs {
  query: string;
  scope?: "agent" | "global" | "user";
  limit?: number;
}

export interface UpdateMemoryArgs {
  id: string;
  content?: string;
  tags?: string[];
}

export interface DeleteMemoryArgs {
  id: string;
}

export interface ListMemoryArgs {
  scope?: "agent" | "global" | "user";
  limit?: number;
}

function requireAgentScope(actor: MemoryToolActor): MemoryScope {
  if (!actor.agentName) {
    throw new Error("Memory tools require an agent context");
  }
  return `agent:${actor.agentName}`;
}

function resolveWriteScope(
  actor: MemoryToolActor,
  scope?: "agent" | "global" | "user",
): MemoryScope {
  if (!scope || scope === "agent") {
    return requireAgentScope(actor);
  }
  if (scope === "global") {
    return "global";
  }
  return USER_SCOPE;
}

function resolveListScope(
  actor: MemoryToolActor,
  scope?: "agent" | "global" | "user",
): MemoryScope {
  return resolveWriteScope(actor, scope);
}

function resolveSearchScopes(
  actor: MemoryToolActor,
  scope?: "agent" | "global" | "user",
): MemoryScope[] {
  if (!scope || scope === "agent") {
    return [requireAgentScope(actor), USER_SCOPE, "global"];
  }
  if (scope === "global") {
    return ["global"];
  }
  return [USER_SCOPE];
}

function canModifyEntry(actor: MemoryToolActor, entry: MemoryEntry): boolean {
  if (actor.canManageAllScopes) {
    return true;
  }

  const ownAgentScope = actor.agentName
    ? `agent:${actor.agentName}`
    : undefined;
  if (entry.scope === ownAgentScope) {
    return true;
  }

  if (entry.scope === "global" || entry.scope === USER_SCOPE) {
    return entry.createdBy === actor.createdBy;
  }

  return false;
}

export async function saveMemory(
  ctx: MemoryToolContext,
  args: SaveMemoryArgs,
): Promise<{ entry: MemoryEntry }> {
  const scope = resolveWriteScope(ctx.actor, args.scope);
  const entry = await ctx.memoryBackend.save({
    scope,
    content: args.content,
    tags: args.tags,
    createdBy: ctx.actor.createdBy,
    source: ctx.actor.source,
  });
  return { entry };
}

export async function searchMemory(
  ctx: MemoryToolContext,
  args: SearchMemoryArgs,
): Promise<{ results: MemorySearchResult[] }> {
  const scopes = resolveSearchScopes(ctx.actor, args.scope);
  const perScopeResults = await Promise.all(
    scopes.map((scope) =>
      ctx.memoryBackend.search({
        text: args.query,
        scope,
        limit: args.limit ?? 10,
      }),
    ),
  );

  const merged = new Map<string, MemorySearchResult>();
  for (const result of perScopeResults.flat()) {
    const existing = merged.get(result.entry.id);
    if (!existing || result.score > existing.score) {
      merged.set(result.entry.id, result);
    }
  }

  return {
    results: [...merged.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, args.limit ?? 10),
  };
}

export async function updateMemory(
  ctx: MemoryToolContext,
  args: UpdateMemoryArgs,
): Promise<{ entry: MemoryEntry | null }> {
  const existing = await ctx.memoryBackend.get(args.id);
  if (!existing) {
    return { entry: null };
  }
  if (!canModifyEntry(ctx.actor, existing)) {
    throw new Error("You do not have permission to update this memory");
  }

  const entry = await ctx.memoryBackend.update(args.id, {
    content: args.content,
    tags: args.tags,
  });
  return { entry };
}

export async function deleteMemory(
  ctx: MemoryToolContext,
  args: DeleteMemoryArgs,
): Promise<{ archived: boolean }> {
  const existing = await ctx.memoryBackend.get(args.id);
  if (!existing) {
    return { archived: false };
  }
  if (!canModifyEntry(ctx.actor, existing)) {
    throw new Error("You do not have permission to delete this memory");
  }

  return {
    archived: await ctx.memoryBackend.archive(args.id),
  };
}

export async function listMemory(
  ctx: MemoryToolContext,
  args: ListMemoryArgs,
): Promise<{ scope: MemoryScope; entries: MemoryEntry[] }> {
  const scope = resolveListScope(ctx.actor, args.scope);
  return {
    scope,
    entries: await ctx.memoryBackend.list({
      scope,
      limit: args.limit ?? 20,
    }),
  };
}

export function buildMemoryToolInstructions(): string {
  return [
    "You have persistent memory that survives across sessions.",
    "Important facts, preferences, and patterns from past conversations are shown above when available.",
    "You can also:",
    "- Use SaveMemory to remember new information",
    "- Use SearchMemory to find specific memories",
    "- Use UpdateMemory to correct or refine memories",
    "- Use DeleteMemory to remove outdated information",
    "- Use ListMemory to browse all memories",
    "Save important facts proactively — preferences, corrections, project context, recurring patterns.",
    "Do not save transient or obvious information.",
    'When the user asks "what\'s in your memory?" or "what do you remember?", use ListMemory.',
    "When the user asks to update or remove a memory, use UpdateMemory or DeleteMemory.",
  ].join("\n");
}
