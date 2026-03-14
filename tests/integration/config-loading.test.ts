import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadConfig } from "../../src/config.ts";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

describe("config loading (integration)", () => {
  test("loads the real agents.json from project root", async () => {
    const config = await loadConfig(resolve(PROJECT_ROOT, "agents.json"));
    expect(config.default_agent).toBe("default");
    expect(config.default_driver).toBe("claude");
  });
});
