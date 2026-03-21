import { describe, expect, test } from "bun:test";
import {
  buildPiSystemPrompt,
  createPiEventHandler,
  parsePiModelString,
  PiDriver,
} from "../../src/drivers/pi.ts";
import type { DriverEvent } from "../../src/drivers/types.ts";

// --- parsePiModelString ---

describe("parsePiModelString", () => {
  test("splits provider/model correctly", () => {
    const result = parsePiModelString("openrouter/minimax-m2.5");
    expect(result.provider).toBe("openrouter");
    expect(result.modelId).toBe("minimax-m2.5");
  });

  test("handles nested slashes (provider/org/model)", () => {
    const result = parsePiModelString("openrouter/minimax/minimax-m2.5");
    expect(result.provider).toBe("openrouter");
    expect(result.modelId).toBe("minimax/minimax-m2.5");
  });

  test("throws on missing slash", () => {
    expect(() => parsePiModelString("no-slash")).toThrow(
      'Pi model must be in "provider/model-id" format',
    );
  });
});

// --- PiDriver.availableModels alias resolution ---

describe("PiDriver model alias resolution", () => {
  test("availableModels contains expected aliases", async () => {
    const driver = await PiDriver.create();
    expect(driver.availableModels["gpt"]).toBe("openai-codex/gpt-5.4");
    expect(driver.availableModels["minimax"]).toBe(
      "openrouter/minimax/minimax-m2.5",
    );
  });

  test("alias is expanded before parsing in createSession", async () => {
    const driver = await PiDriver.create("gpt");
    // createSession will fail at the Pi SDK layer (no auth), but it should
    // NOT fail with the "provider/model-id" format error — that would mean
    // the alias was not expanded.
    try {
      await driver.createSession({
        systemPrompt: "test",
        model: "gpt",
      });
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain('Pi model must be in "provider/model-id"');
    }
  });

  test("alias is expanded for minimax alias", async () => {
    const driver = await PiDriver.create("minimax");
    try {
      await driver.createSession({
        systemPrompt: "test",
        model: "minimax",
      });
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain('Pi model must be in "provider/model-id"');
    }
  });

  test("fully-qualified model string still works", async () => {
    const driver = await PiDriver.create();
    try {
      await driver.createSession({
        systemPrompt: "test",
        model: "openai-codex/gpt-5.4",
      });
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain('Pi model must be in "provider/model-id"');
    }
  });
});

// --- buildPiSystemPrompt ---

describe("buildPiSystemPrompt", () => {
  test("with skills appends catalog and guardrail", () => {
    const result = buildPiSystemPrompt("base", [
      { name: "foo", description: "does foo", path: "/foo" },
    ]);
    expect(result).toContain("Available Skills");
    expect(result).toContain("foo");
    expect(result).toContain("Only use the skills listed above");
  });

  test("with empty skills appends no-skill guardrail", () => {
    const result = buildPiSystemPrompt("base", []);
    expect(result).toContain("no skills loaded");
    expect(result).toContain("Do not search the filesystem");
  });

  test("with undefined skills appends no-skill guardrail", () => {
    const result = buildPiSystemPrompt("base", undefined);
    expect(result).toContain("no skills loaded");
  });

  test("appends environment block", () => {
    const result = buildPiSystemPrompt("base");
    expect(result).toContain("# Environment");
  });
});

// --- createPiEventHandler ---

describe("createPiEventHandler", () => {
  test("accumulates text from message_update/text_delta events", () => {
    const handler = createPiEventHandler("sess-1");
    handler.handleEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello " },
    });
    handler.handleEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "world" },
    });
    expect(handler.getText()).toBe("Hello world");
  });

  test("fires tool_use on tool_execution_start", () => {
    const events: DriverEvent[] = [];
    const handler = createPiEventHandler("sess-1", (e) => events.push(e));
    handler.handleEvent({
      type: "tool_execution_start",
      toolName: "read_file",
      toolCallId: "tc-1",
      args: {},
    });
    expect(events).toEqual([{ type: "tool_use", tool: "read_file" }]);
  });

  test("does not fire tool_use on tool_execution_end", () => {
    const events: DriverEvent[] = [];
    const handler = createPiEventHandler("sess-1", (e) => events.push(e));
    handler.handleEvent({
      type: "tool_execution_end",
      toolName: "read_file",
      toolCallId: "tc-1",
      isError: false,
    });
    expect(events).toHaveLength(0);
  });

  test("ignores non-text_delta message_update events", () => {
    const handler = createPiEventHandler("sess-1");
    handler.handleEvent({
      type: "message_update",
      assistantMessageEvent: { type: "thinking", delta: "hmm" },
    });
    expect(handler.getText()).toBe("");
  });

  test("multiple text deltas concatenate in order", () => {
    const handler = createPiEventHandler("sess-1");
    const parts = ["one", "two", "three"];
    for (const part of parts) {
      handler.handleEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: part },
      });
    }
    expect(handler.getText()).toBe("onetwothree");
  });
});
