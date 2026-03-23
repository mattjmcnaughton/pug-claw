import { describe, expect, test } from "bun:test";
import { buildFinalSystemPrompt } from "../../src/prompt.ts";

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
});
