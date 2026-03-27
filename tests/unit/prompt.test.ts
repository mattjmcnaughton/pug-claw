import { describe, expect, test } from "bun:test";
import {
  buildDateTimeBlock,
  buildFinalSystemPrompt,
} from "../../src/prompt.ts";

const skills = [
  {
    name: "foo",
    description: "Does foo",
    path: "/tmp/foo/SKILL.md",
  },
];

describe("buildFinalSystemPrompt", () => {
  test("appends skill catalog and environment block by default", () => {
    const prompt = buildFinalSystemPrompt("base", { skills });

    expect(prompt).toContain("base");
    expect(prompt).toContain("# Available Skills");
    expect(prompt).toContain("foo");
    expect(prompt).toContain("# Environment");
  });

  test("appends plugin hint instead of skill catalog when requested", () => {
    const prompt = buildFinalSystemPrompt("base", {
      skills,
      pluginHint: true,
    });

    expect(prompt).toContain("plugin skills loaded");
    expect(prompt).not.toContain("# Available Skills");
  });

  test("supports strict skill guardrails for pi sessions", () => {
    const withSkills = buildFinalSystemPrompt("base", {
      skills,
      skillMode: "strict",
    });
    const withoutSkills = buildFinalSystemPrompt("base", {
      skillMode: "strict",
    });

    expect(withSkills).toContain("Only use the skills listed above");
    expect(withoutSkills).toContain("no skills loaded");
  });

  test("inserts memory before the environment block", () => {
    const prompt = buildFinalSystemPrompt("base", {
      skills,
      memoryBlock: "# Memory\n\n- remembered",
    });

    expect(prompt.indexOf("# Available Skills")).toBeLessThan(
      prompt.indexOf("# Memory"),
    );
    expect(prompt.indexOf("# Memory")).toBeLessThan(
      prompt.indexOf("# Environment"),
    );
  });

  test("appends date/time block after environment when timezone is provided", () => {
    const prompt = buildFinalSystemPrompt("base", {
      timezone: "America/New_York",
    });

    expect(prompt).toContain("# Current Date & Time");
    expect(prompt).toContain("America/New_York");
    expect(prompt.indexOf("# Environment")).toBeLessThan(
      prompt.indexOf("# Current Date & Time"),
    );
  });

  test("omits date/time block when timezone is not provided", () => {
    const prompt = buildFinalSystemPrompt("base", {});

    expect(prompt).not.toContain("# Current Date & Time");
  });
});

describe("buildDateTimeBlock", () => {
  const fixedDate = new Date("2026-03-27T14:30:00Z");

  test("formats date with timezone name", () => {
    const block = buildDateTimeBlock("America/New_York", fixedDate);

    expect(block).toContain("# Current Date & Time");
    expect(block).toContain("America/New_York");
    expect(block).toContain("Friday");
    expect(block).toContain("March");
    expect(block).toContain("2026");
  });

  test("formats date in UTC", () => {
    const block = buildDateTimeBlock("UTC", fixedDate);

    expect(block).toContain("UTC");
    expect(block).toContain("Friday");
    expect(block).toContain("2:30");
  });
});
