import { describe, expect, test } from "bun:test";
import {
  type ResolvedSessionOptions,
  buildClaudeSdkOptions,
  processClaudeEvents,
  resolveClaudeSessionOptions,
} from "../../src/drivers/claude.ts";
import type { DriverEvent } from "../../src/drivers/types.ts";

// --- resolveClaudeSessionOptions ---

describe("resolveClaudeSessionOptions", () => {
  test("defaults model to claude-sonnet-4-6", () => {
    const result = resolveClaudeSessionOptions({
      systemPrompt: "test",
    });
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  test("uses provided model", () => {
    const result = resolveClaudeSessionOptions({
      systemPrompt: "test",
      model: "claude-opus-4-6",
    });
    expect(result.model).toBe("claude-opus-4-6");
  });

  test("defaults tools to Read, Glob, Grep, Bash", () => {
    const result = resolveClaudeSessionOptions({
      systemPrompt: "test",
    });
    expect(result.tools).toEqual(["Read", "Glob", "Grep", "Bash"]);
  });

  test("uses provided tools", () => {
    const result = resolveClaudeSessionOptions({
      systemPrompt: "test",
      tools: ["Read", "Write"],
    });
    expect(result.tools).toEqual(["Read", "Write"]);
  });

  test("with pluginDir and skills appends plugin hint", () => {
    const result = resolveClaudeSessionOptions({
      systemPrompt: "base prompt",
      pluginDir: "/plugins",
      skills: [{ name: "foo", description: "does foo", path: "/foo" }],
    });
    expect(result.systemPrompt).toContain("plugin skills loaded");
    expect(result.plugins).toEqual([{ type: "local", path: "/plugins" }]);
  });

  test("without pluginDir embeds skill catalog in prompt", () => {
    const result = resolveClaudeSessionOptions({
      systemPrompt: "base prompt",
      skills: [{ name: "foo", description: "does foo", path: "/foo" }],
    });
    expect(result.systemPrompt).toContain("Available Skills");
    expect(result.systemPrompt).toContain("foo");
    expect(result.plugins).toBeUndefined();
  });

  test("with pluginDir but empty skills does not append plugin hint", () => {
    const result = resolveClaudeSessionOptions({
      systemPrompt: "base prompt",
      pluginDir: "/plugins",
      skills: [],
    });
    expect(result.systemPrompt).not.toContain("plugin skills loaded");
  });

  test("appends environment block", () => {
    const result = resolveClaudeSessionOptions({
      systemPrompt: "test",
    });
    expect(result.systemPrompt).toContain("# Environment");
  });

  test("registers memory tools via an MCP server when memoryToolContext is provided", () => {
    const result = resolveClaudeSessionOptions({
      systemPrompt: "test",
      memoryToolContext: {
        memoryBackend: {
          init: async () => {},
          close: async () => {},
          save: async () => {
            throw new Error("unused");
          },
          update: async () => null,
          get: async () => null,
          delete: async () => false,
          archive: async () => false,
          peek: async () => [],
          list: async () => [],
          search: async () => [],
          listScopes: async () => [],
          count: async () => 0,
          stats: async () => ({
            totalEntries: 0,
            activeEntries: 0,
            archivedEntries: 0,
            compactedEntries: 0,
            entriesByScope: {},
          }),
          exportMarkdown: async () => "",
        },
        actor: {
          type: "agent",
          agentName: "writer",
          createdBy: "agent:writer",
          source: "agent",
        },
      },
    });

    expect(result.mcpServers).toBeDefined();
    expect(Object.keys(result.mcpServers ?? {})).toEqual(["memory"]);
  });

  test("passes cwd through", () => {
    const result = resolveClaudeSessionOptions({
      systemPrompt: "test",
      cwd: "/work",
    });
    expect(result.cwd).toBe("/work");
  });
});

// --- buildClaudeSdkOptions ---

describe("buildClaudeSdkOptions", () => {
  const baseResolved: ResolvedSessionOptions = {
    model: "claude-sonnet-4-6",
    tools: ["Read", "Bash"],
    systemPrompt: "test prompt",
    cwd: "/work",
  };

  test("includes resume when provided", () => {
    const opts = buildClaudeSdkOptions(baseResolved, "session-123");
    expect(opts.resume).toBe("session-123");
  });

  test("omits resume when undefined", () => {
    const opts = buildClaudeSdkOptions(baseResolved);
    expect("resume" in opts).toBe(false);
  });

  test("sets bypassPermissions", () => {
    const opts = buildClaudeSdkOptions(baseResolved);
    expect(opts.permissionMode).toBe("bypassPermissions");
    expect(opts.allowDangerouslySkipPermissions).toBe(true);
  });

  test("passes plugins when present", () => {
    const resolved: ResolvedSessionOptions = {
      ...baseResolved,
      plugins: [{ type: "local", path: "/plugins" }],
    };
    const opts = buildClaudeSdkOptions(resolved);
    expect(opts.plugins).toEqual([{ type: "local", path: "/plugins" }]);
  });

  test("passes mcpServers when present", () => {
    const resolved: ResolvedSessionOptions = {
      ...baseResolved,
      mcpServers: {
        memory: { type: "sdk", name: "memory", instance: {} } as never,
      },
    };
    const opts = buildClaudeSdkOptions(resolved);
    expect(opts.mcpServers).toEqual(resolved.mcpServers);
  });

  test("maps tools to allowedTools", () => {
    const opts = buildClaudeSdkOptions(baseResolved);
    expect(opts.allowedTools).toEqual(["Read", "Bash"]);
  });
});

// --- processClaudeEvents ---

async function* makeMessages(
  msgs: Record<string, unknown>[],
): AsyncIterable<Record<string, unknown>> {
  for (const msg of msgs) {
    yield msg;
  }
}

describe("processClaudeEvents", () => {
  test("extracts result text", async () => {
    const result = await processClaudeEvents(
      makeMessages([{ result: "hello world" }]),
      "sess-1",
    );
    expect(result.text).toBe("hello world");
  });

  test("extracts session_id from system/init event", async () => {
    const result = await processClaudeEvents(
      makeMessages([
        { type: "system", subtype: "init", session_id: "new-sess" },
      ]),
      "",
    );
    expect(result.sessionId).toBe("new-sess");
  });

  test("fires tool_use event on tool_progress message", async () => {
    const events: DriverEvent[] = [];
    await processClaudeEvents(
      makeMessages([
        {
          type: "tool_progress",
          tool_name: "Read",
          tool_use_id: "tu-1",
        },
      ]),
      "sess-1",
      (e) => events.push(e),
    );
    expect(events).toEqual([{ type: "tool_use", tool: "Read" }]);
  });

  test("deduplicates tool events by tool_use_id for logging", async () => {
    const events: DriverEvent[] = [];
    await processClaudeEvents(
      makeMessages([
        { type: "tool_progress", tool_name: "Read", tool_use_id: "tu-1" },
        { type: "tool_progress", tool_name: "Read", tool_use_id: "tu-1" },
        { type: "tool_progress", tool_name: "Bash", tool_use_id: "tu-2" },
      ]),
      "sess-1",
      (e) => events.push(e),
    );
    // onEvent fires for every tool_progress, but dedup is internal logging only
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "tool_use", tool: "Read" });
    expect(events[2]).toEqual({ type: "tool_use", tool: "Bash" });
  });

  test("fires status event on system/status message", async () => {
    const events: DriverEvent[] = [];
    await processClaudeEvents(
      makeMessages([
        { type: "system", subtype: "status", status: "thinking..." },
      ]),
      "sess-1",
      (e) => events.push(e),
    );
    expect(events).toEqual([{ type: "status", message: "thinking..." }]);
  });

  test("handles elicitation without crashing", async () => {
    const result = await processClaudeEvents(
      makeMessages([{ type: "system", subtype: "elicitation" }]),
      "sess-1",
    );
    expect(result.text).toBe("");
  });

  test("returns empty string when no result event", async () => {
    const result = await processClaudeEvents(makeMessages([]), "sess-1");
    expect(result.text).toBe("");
  });

  test("handles interleaved tool and result events", async () => {
    const events: DriverEvent[] = [];
    const result = await processClaudeEvents(
      makeMessages([
        { type: "tool_progress", tool_name: "Bash", tool_use_id: "tu-1" },
        { result: "done" },
        { type: "tool_progress", tool_name: "Read", tool_use_id: "tu-2" },
      ]),
      "sess-1",
      (e) => events.push(e),
    );
    expect(result.text).toBe("done");
    expect(events).toHaveLength(2);
  });
});
