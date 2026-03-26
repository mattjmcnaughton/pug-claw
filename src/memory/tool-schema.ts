import { Type, type TObject } from "@sinclair/typebox";
import { z } from "zod/v4";
import {
  deleteMemory,
  listMemory,
  saveMemory,
  searchMemory,
  type MemoryToolContext,
  updateMemory,
} from "./tools.ts";

interface MemoryToolSchemaDefinition {
  name: string;
  description: string;
  claudeParameters: z.ZodRawShape;
  piParameters: TObject;
  execute: (
    memoryToolContext: MemoryToolContext,
    args: unknown,
  ) => Promise<unknown>;
  formatClaudeResult?: ((result: unknown) => string) | undefined;
}

function createMemoryToolSchema<TArgs>(config: {
  name: string;
  description: string;
  claudeParameters: z.ZodRawShape;
  piParameters: TObject;
  argsSchema: z.ZodType<TArgs>;
  execute: (
    memoryToolContext: MemoryToolContext,
    args: TArgs,
  ) => Promise<unknown>;
  formatClaudeResult?: (result: unknown) => string;
}): MemoryToolSchemaDefinition {
  return {
    name: config.name,
    description: config.description,
    claudeParameters: config.claudeParameters,
    piParameters: config.piParameters,
    execute: async (memoryToolContext, args) =>
      config.execute(memoryToolContext, config.argsSchema.parse(args)),
    formatClaudeResult: config.formatClaudeResult,
  };
}

const MEMORY_SCOPE_ZOD = z.enum(["agent", "global", "user"]);
const MEMORY_SCOPE_TYPEBOX = Type.Union([
  Type.Literal("agent"),
  Type.Literal("global"),
  Type.Literal("user"),
]);

export const memoryToolSchemas: MemoryToolSchemaDefinition[] = [
  createMemoryToolSchema({
    name: "SaveMemory",
    description: "Save a piece of information to memory for future reference.",
    claudeParameters: {
      content: z.string(),
      scope: MEMORY_SCOPE_ZOD.optional(),
      tags: z.array(z.string()).optional(),
    },
    piParameters: Type.Object({
      content: Type.String(),
      scope: Type.Optional(MEMORY_SCOPE_TYPEBOX),
      tags: Type.Optional(Type.Array(Type.String())),
    }),
    argsSchema: z.object({
      content: z.string(),
      scope: MEMORY_SCOPE_ZOD.optional(),
      tags: z.array(z.string()).optional(),
    }),
    execute: saveMemory,
    formatClaudeResult: (result) => {
      const parsed = result as Awaited<ReturnType<typeof saveMemory>>;
      return `Saved memory ${parsed.entry.id} in ${parsed.entry.scope}.`;
    },
  }),
  createMemoryToolSchema({
    name: "SearchMemory",
    description: "Search memory for relevant information.",
    claudeParameters: {
      query: z.string(),
      scope: MEMORY_SCOPE_ZOD.optional(),
      limit: z.number().int().positive().optional(),
    },
    piParameters: Type.Object({
      query: Type.String(),
      scope: Type.Optional(MEMORY_SCOPE_TYPEBOX),
      limit: Type.Optional(Type.Number()),
    }),
    argsSchema: z.object({
      query: z.string(),
      scope: MEMORY_SCOPE_ZOD.optional(),
      limit: z.number().int().positive().optional(),
    }),
    execute: searchMemory,
  }),
  createMemoryToolSchema({
    name: "UpdateMemory",
    description: "Update an existing memory entry.",
    claudeParameters: {
      id: z.string(),
      content: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    piParameters: Type.Object({
      id: Type.String(),
      content: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
    }),
    argsSchema: z.object({
      id: z.string(),
      content: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    execute: updateMemory,
  }),
  createMemoryToolSchema({
    name: "DeleteMemory",
    description: "Archive a memory entry.",
    claudeParameters: {
      id: z.string(),
    },
    piParameters: Type.Object({
      id: Type.String(),
    }),
    argsSchema: z.object({
      id: z.string(),
    }),
    execute: deleteMemory,
  }),
  createMemoryToolSchema({
    name: "ListMemory",
    description: "List memory entries, optionally filtered.",
    claudeParameters: {
      scope: MEMORY_SCOPE_ZOD.optional(),
      limit: z.number().int().positive().optional(),
    },
    piParameters: Type.Object({
      scope: Type.Optional(MEMORY_SCOPE_TYPEBOX),
      limit: Type.Optional(Type.Number()),
    }),
    argsSchema: z.object({
      scope: MEMORY_SCOPE_ZOD.optional(),
      limit: z.number().int().positive().optional(),
    }),
    execute: listMemory,
  }),
];
