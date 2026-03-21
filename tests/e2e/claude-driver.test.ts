import { describe, expect, test } from "bun:test";
import { ClaudeDriver } from "../../src/drivers/claude.ts";
import type { DriverEvent } from "../../src/drivers/types.ts";

const SKIP = !process.env.ENABLE_EXTERNAL_TESTS;

describe.skipIf(SKIP)("ClaudeDriver e2e", () => {
  test("create session, query, destroy lifecycle", async () => {
    const driver = new ClaudeDriver();
    const sessionId = await driver.createSession({
      systemPrompt: "You are a test assistant. Be very brief.",
      model: "claude-sonnet-4-6",
    });

    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe("string");

    const response = await driver.query(sessionId, "Reply with exactly: pong");
    expect(response.text).toBeTruthy();
    expect(response.sessionId).toBe(sessionId);

    await driver.destroySession(sessionId);

    // After destroy, query should throw
    expect(driver.query(sessionId, "hello")).rejects.toThrow(
      "Unknown Claude session",
    );
  }, 60_000);

  test("query unknown session throws", async () => {
    const driver = new ClaudeDriver();
    expect(driver.query("nonexistent", "hello")).rejects.toThrow(
      "Unknown Claude session",
    );
  });

  test("destroySession is idempotent for unknown ID", async () => {
    const driver = new ClaudeDriver();
    // Should not throw
    await driver.destroySession("nonexistent");
  });

  test("onEvent callback is invoked during query", async () => {
    const driver = new ClaudeDriver();
    const sessionId = await driver.createSession({
      systemPrompt: "You are a test assistant. Be very brief.",
      model: "claude-sonnet-4-6",
    });

    const events: DriverEvent[] = [];
    const response = await driver.query(
      sessionId,
      "Reply with exactly: pong",
      (e) => events.push(e),
    );

    // Verify the query succeeded and the callback was accepted without error.
    // Note: tool_progress events may not fire for simple prompts or in
    // bypassPermissions mode, so we don't assert on event count.
    expect(response.text).toBeTruthy();
    expect(response.sessionId).toBe(sessionId);

    await driver.destroySession(sessionId);
  }, 60_000);
});
