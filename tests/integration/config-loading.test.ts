import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { resolveConfig } from "../../src/resources.ts";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

describe("config loading (integration)", () => {
  test("throws with init message when home dir missing", async () => {
    await expect(
      resolveConfig({ home: "/tmp/nonexistent-pug-claw-home" }),
    ).rejects.toThrow("pug-claw init");
  });

  test("loads from fixtures pug-claw-home", async () => {
    const fixtureHome = resolve(PROJECT_ROOT, "tests/fixtures/pug-claw-home");
    const config = await resolveConfig({ home: fixtureHome });
    expect(config.defaultAgent).toBe("test-agent");
    expect(config.defaultDriver).toBe("claude");
    expect(config.agentsDir).toBe(resolve(fixtureHome, "agents"));
  });
});
