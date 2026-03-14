import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildFullSystemPrompt, discoverSkills } from "../../src/skills.ts";

const FIXTURES = resolve(import.meta.dir, "../fixtures");
const TEST_AGENT = resolve(FIXTURES, "agents/test-agent");

describe("discoverSkills", () => {
  test("finds skills with valid SKILL.md frontmatter", () => {
    const skills = discoverSkills(TEST_AGENT);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("greet");
    expect(skills[0].description).toBe("Greet the user by name");
  });

  test("returns empty array for agent with no skills dir", () => {
    const skills = discoverSkills(resolve(FIXTURES, "agents/nonexistent"));
    expect(skills).toEqual([]);
  });
});

describe("buildFullSystemPrompt", () => {
  test("includes system prompt and skill catalog", () => {
    const prompt = buildFullSystemPrompt(TEST_AGENT);
    expect(prompt).toContain("You are a test agent.");
    expect(prompt).toContain("<available-skills>");
    expect(prompt).toContain('name="greet"');
  });
});
