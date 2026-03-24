import { describe, expect, test } from "bun:test";
import { parseMemoryScopeInput } from "../../src/memory/chat.ts";

describe("parseMemoryScopeInput", () => {
  test("defaults to the current agent scope", () => {
    expect(parseMemoryScopeInput("writer")).toBe("agent:writer");
    expect(parseMemoryScopeInput("writer", "agent")).toBe("agent:writer");
  });

  test("accepts explicit shared scopes", () => {
    expect(parseMemoryScopeInput("writer", "global")).toBe("global");
    expect(parseMemoryScopeInput("writer", "user")).toBe("user:default");
    expect(parseMemoryScopeInput("writer", "user:default")).toBe(
      "user:default",
    );
  });

  test("accepts explicit agent scopes", () => {
    expect(parseMemoryScopeInput("writer", "agent:researcher")).toBe(
      "agent:researcher",
    );
  });

  test("rejects invalid scopes", () => {
    expect(() => parseMemoryScopeInput("writer", "team")).toThrow(
      "Invalid memory scope",
    );
  });
});
