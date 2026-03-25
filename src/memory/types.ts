export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  content: string;
  tags: string[];
  source: MemorySource;
  createdBy: string;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  accessedAt: string;
}

export type MemoryScope = `agent:${string}` | "global" | `user:${string}`;

export type MemorySource = "agent" | "user" | "system";

export type MemoryStatus = "active" | "archived";

export interface NewMemoryEntry {
  scope: MemoryScope;
  content: string;
  tags?: string[] | undefined;
  source: MemorySource;
  createdBy: string;
}

export interface MemoryEntryPatch {
  content?: string | undefined;
  tags?: string[] | undefined;
  status?: MemoryStatus | undefined;
}

export interface MemoryFilter {
  scope?: MemoryScope | undefined;
  status?: MemoryStatus | undefined;
  source?: MemorySource | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface MemorySearchQuery {
  text?: string | undefined;
  embedding?: number[] | undefined;
  scope?: MemoryScope | undefined;
  status?: MemoryStatus | undefined;
  limit?: number | undefined;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  matchType: "keyword" | "semantic" | "hybrid";
}

export interface MemoryStats {
  totalEntries: number;
  activeEntries: number;
  archivedEntries: number;
  entriesByScope: Record<string, number>;
}

export interface MemoryBackend {
  init(): Promise<void>;
  close(): Promise<void>;
  save(entry: NewMemoryEntry): Promise<MemoryEntry>;
  update(id: string, patch: MemoryEntryPatch): Promise<MemoryEntry | null>;
  get(id: string): Promise<MemoryEntry | null>;
  delete(id: string): Promise<boolean>;
  archive(id: string): Promise<boolean>;
  peek(filter: MemoryFilter): Promise<MemoryEntry[]>;
  list(filter: MemoryFilter): Promise<MemoryEntry[]>;
  search(query: MemorySearchQuery): Promise<MemorySearchResult[]>;
  listScopes(): Promise<string[]>;
  count(filter: MemoryFilter): Promise<number>;
  stats(): Promise<MemoryStats>;
  exportMarkdown(scope: MemoryScope): Promise<string>;
  reindex?(): Promise<number>;
}

export interface EmbeddingProvider {
  init(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions(): number;
}

const MEMORY_SCOPE_REGEX = /^(global|agent:[^\s:][^\s]*|user:[^\s:][^\s]*)$/;

export function validateMemoryScope(
  scope: string,
): asserts scope is MemoryScope {
  if (!MEMORY_SCOPE_REGEX.test(scope)) {
    throw new Error(`Invalid memory scope: "${scope}"`);
  }
}

export function normalizeMemoryTags(tags?: string[]): string[] {
  if (!tags) {
    return [];
  }

  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
