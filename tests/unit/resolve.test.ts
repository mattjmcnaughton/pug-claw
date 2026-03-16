import { describe, expect, test } from "bun:test";
import { resolveDriverName, resolveModelName } from "../../src/resolve.ts";

describe("resolveDriverName", () => {
  test("returns runtime override when all levels set", () => {
    expect(
      resolveDriverName({
        runtimeOverride: "runtime",
        channelConfig: "channel",
        agentFrontmatter: "agent",
        globalDefault: "global",
      }),
    ).toBe("runtime");
  });

  test("returns channel config when no runtime override", () => {
    expect(
      resolveDriverName({
        channelConfig: "channel",
        agentFrontmatter: "agent",
        globalDefault: "global",
      }),
    ).toBe("channel");
  });

  test("returns agent frontmatter when no runtime or channel override", () => {
    expect(
      resolveDriverName({
        agentFrontmatter: "agent",
        globalDefault: "global",
      }),
    ).toBe("agent");
  });

  test("returns global default when nothing else set", () => {
    expect(
      resolveDriverName({
        globalDefault: "global",
      }),
    ).toBe("global");
  });

  test("skips undefined levels correctly (runtime=undefined, channel=set)", () => {
    expect(
      resolveDriverName({
        runtimeOverride: undefined,
        channelConfig: "channel",
        agentFrontmatter: "agent",
        globalDefault: "global",
      }),
    ).toBe("channel");
  });

  test("skips undefined levels correctly (runtime=undefined, channel=undefined, agent=set)", () => {
    expect(
      resolveDriverName({
        runtimeOverride: undefined,
        channelConfig: undefined,
        agentFrontmatter: "agent",
        globalDefault: "global",
      }),
    ).toBe("agent");
  });

  test("returns global default when all overrides are undefined", () => {
    expect(
      resolveDriverName({
        runtimeOverride: undefined,
        channelConfig: undefined,
        agentFrontmatter: undefined,
        globalDefault: "global",
      }),
    ).toBe("global");
  });
});

describe("resolveModelName", () => {
  test("returns runtime override when all levels set", () => {
    expect(
      resolveModelName({
        runtimeOverride: "runtime-model",
        channelConfig: "channel-model",
        agentFrontmatter: "agent-model",
        driverDefault: "driver-model",
      }),
    ).toBe("runtime-model");
  });

  test("returns channel config when no runtime override", () => {
    expect(
      resolveModelName({
        channelConfig: "channel-model",
        agentFrontmatter: "agent-model",
        driverDefault: "driver-model",
      }),
    ).toBe("channel-model");
  });

  test("returns agent frontmatter when no runtime or channel override", () => {
    expect(
      resolveModelName({
        agentFrontmatter: "agent-model",
        driverDefault: "driver-model",
      }),
    ).toBe("agent-model");
  });

  test("returns driver default when nothing else set", () => {
    expect(
      resolveModelName({
        driverDefault: "driver-model",
      }),
    ).toBe("driver-model");
  });

  test("skips undefined levels correctly (runtime=undefined, channel=set)", () => {
    expect(
      resolveModelName({
        runtimeOverride: undefined,
        channelConfig: "channel-model",
        agentFrontmatter: "agent-model",
        driverDefault: "driver-model",
      }),
    ).toBe("channel-model");
  });

  test("skips undefined levels correctly (runtime=undefined, channel=undefined, agent=set)", () => {
    expect(
      resolveModelName({
        runtimeOverride: undefined,
        channelConfig: undefined,
        agentFrontmatter: "agent-model",
        driverDefault: "driver-model",
      }),
    ).toBe("agent-model");
  });

  test("returns driver default when all overrides are undefined", () => {
    expect(
      resolveModelName({
        runtimeOverride: undefined,
        channelConfig: undefined,
        agentFrontmatter: undefined,
        driverDefault: "driver-model",
      }),
    ).toBe("driver-model");
  });
});
