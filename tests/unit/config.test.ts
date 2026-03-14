import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { getChannelConfig, loadConfig } from "../../src/config.ts";

const FIXTURES = resolve(import.meta.dir, "../fixtures");

describe("loadConfig", () => {
  test("parses a valid config file", async () => {
    const config = await loadConfig(resolve(FIXTURES, "valid-config.json"));
    expect(config.default_agent).toBe("default");
    expect(config.default_driver).toBe("claude");
    expect(config.drivers.pi?.default_model).toBe(
      "openrouter/minimax/minimax-m2.5",
    );
  });

  test("rejects config missing required fields", () => {
    expect(
      loadConfig(resolve(FIXTURES, "invalid-config.json")),
    ).rejects.toThrow();
  });

  test("defaults drivers and channels to empty objects", async () => {
    const tmpPath = resolve(FIXTURES, "minimal-config.json");
    await Bun.write(
      tmpPath,
      JSON.stringify({
        default_agent: "default",
        default_driver: "claude",
      }),
    );
    try {
      const config = await loadConfig(tmpPath);
      expect(config.drivers).toEqual({});
      expect(config.channels).toEqual({});
    } finally {
      await Bun.file(tmpPath).delete();
    }
  });
});

describe("getChannelConfig", () => {
  test("returns config for a known channel", async () => {
    const config = await loadConfig(resolve(FIXTURES, "valid-config.json"));
    const chan = getChannelConfig(config, "123");
    expect(chan.agent).toBe("custom");
    expect(chan.driver).toBe("pi");
  });

  test("returns empty object for unknown channel", async () => {
    const config = await loadConfig(resolve(FIXTURES, "valid-config.json"));
    const chan = getChannelConfig(config, "unknown");
    expect(chan).toEqual({});
  });
});
