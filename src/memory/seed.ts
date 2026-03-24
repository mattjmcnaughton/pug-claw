import type { MemoryBackend } from "./types.ts";
import type { ResolvedConfig } from "../resources.ts";

export interface SeedConfiguredMemoryResult {
  configuredGlobalSeeds: number;
  created: number;
}

export async function seedConfiguredMemory(
  memoryBackend: MemoryBackend,
  config: ResolvedConfig,
): Promise<SeedConfiguredMemoryResult> {
  const configuredGlobalSeeds = config.memory.seed.global;
  if (configuredGlobalSeeds.length === 0) {
    return {
      configuredGlobalSeeds: 0,
      created: 0,
    };
  }

  const existingEntries = await memoryBackend.peek({
    scope: "global",
    status: "active",
  });
  const existingContent = new Set(
    existingEntries.map((entry) => entry.content),
  );

  let created = 0;
  for (const content of configuredGlobalSeeds) {
    if (existingContent.has(content)) {
      continue;
    }

    await memoryBackend.save({
      scope: "global",
      content,
      createdBy: "system:config",
      source: "system",
    });
    existingContent.add(content);
    created += 1;
  }

  return {
    configuredGlobalSeeds: configuredGlobalSeeds.length,
    created,
  };
}
