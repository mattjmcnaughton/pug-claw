import { describe, expect, test } from "bun:test";
import {
  sanitizeName,
  sanitizePath,
  validateGitUrl,
} from "../../src/coding/sanitize.ts";

describe("sanitizeName", () => {
  test("accepts valid lowercase name", () => {
    expect(sanitizeName("my-session")).toBe("my-session");
  });

  test("accepts name with hyphens", () => {
    expect(sanitizeName("build-123")).toBe("build-123");
  });

  test("accepts name with underscores", () => {
    expect(sanitizeName("my_session")).toBe("my_session");
  });

  test("accepts name starting with digit", () => {
    expect(sanitizeName("1abc")).toBe("1abc");
  });

  test("accepts single character name", () => {
    expect(sanitizeName("a")).toBe("a");
  });

  test("rejects empty string", () => {
    expect(() => sanitizeName("")).toThrow("Invalid name");
  });

  test("rejects name starting with hyphen", () => {
    expect(() => sanitizeName("-leading")).toThrow("Invalid name");
  });

  test("rejects name starting with underscore", () => {
    expect(() => sanitizeName("_leading")).toThrow("Invalid name");
  });

  test("rejects name with uppercase letters", () => {
    expect(() => sanitizeName("MySession")).toThrow("Invalid name");
  });

  test("rejects name with spaces", () => {
    expect(() => sanitizeName("my session")).toThrow("Invalid name");
  });

  test("rejects name with dots", () => {
    expect(() => sanitizeName("my.session")).toThrow("Invalid name");
  });

  // Adversarial inputs
  test("rejects shell injection via semicolon", () => {
    expect(() => sanitizeName("foo;rm -rf /")).toThrow("Invalid name");
  });

  test("rejects shell injection via pipe", () => {
    expect(() => sanitizeName("foo|cat /etc/passwd")).toThrow("Invalid name");
  });

  test("rejects shell injection via backtick", () => {
    expect(() => sanitizeName("foo`id`")).toThrow("Invalid name");
  });

  test("rejects shell injection via $()", () => {
    expect(() => sanitizeName("foo$(whoami)")).toThrow("Invalid name");
  });

  test("rejects shell injection via &&", () => {
    expect(() => sanitizeName("foo&&echo pwned")).toThrow("Invalid name");
  });

  test("rejects newline in name", () => {
    expect(() => sanitizeName("foo\nbar")).toThrow("Invalid name");
  });

  test("rejects null byte in name", () => {
    expect(() => sanitizeName("foo\0bar")).toThrow("Invalid name");
  });
});

describe("sanitizePath", () => {
  test("accepts valid absolute path", () => {
    expect(sanitizePath("/home/user/repos/app")).toBe("/home/user/repos/app");
  });

  test("accepts path with hyphens and underscores", () => {
    expect(sanitizePath("/a-b_c/d")).toBe("/a-b_c/d");
  });

  test("accepts path with dots", () => {
    expect(sanitizePath("/home/user/.config")).toBe("/home/user/.config");
  });

  test("accepts root path", () => {
    expect(sanitizePath("/")).toBe("/");
  });

  test("rejects relative path", () => {
    expect(() => sanitizePath("relative/path")).toThrow(
      "must be an absolute path",
    );
  });

  test("rejects empty string", () => {
    expect(() => sanitizePath("")).toThrow("must be an absolute path");
  });

  test("rejects path with semicolon", () => {
    expect(() => sanitizePath("/home;rm -rf /")).toThrow(
      "shell metacharacters",
    );
  });

  test("rejects path with pipe", () => {
    expect(() => sanitizePath("/home|cat")).toThrow("shell metacharacters");
  });

  test("rejects path with backticks", () => {
    expect(() => sanitizePath("/home/`id`")).toThrow("shell metacharacters");
  });

  test("rejects path with $() substitution", () => {
    expect(() => sanitizePath("/home/$(whoami)")).toThrow(
      "shell metacharacters",
    );
  });

  test("rejects path with curly braces", () => {
    expect(() => sanitizePath("/home/{a,b}")).toThrow("shell metacharacters");
  });

  test("rejects path with angle brackets", () => {
    expect(() => sanitizePath("/home/<file>")).toThrow("shell metacharacters");
  });

  test("rejects path with wildcards", () => {
    expect(() => sanitizePath("/home/*.txt")).toThrow("shell metacharacters");
    expect(() => sanitizePath("/home/?.txt")).toThrow("shell metacharacters");
  });

  test("rejects path with square brackets", () => {
    expect(() => sanitizePath("/home/[a]")).toThrow("shell metacharacters");
  });

  // Adversarial inputs
  test("rejects path traversal", () => {
    expect(() => sanitizePath("/home/../etc/passwd")).toThrow("path traversal");
  });

  test("rejects path with newline", () => {
    expect(() => sanitizePath("/home/user\n/etc")).toThrow(
      "shell metacharacters",
    );
  });

  test("rejects path with hash", () => {
    expect(() => sanitizePath("/home/user#comment")).toThrow(
      "shell metacharacters",
    );
  });

  test("rejects path with tilde", () => {
    expect(() => sanitizePath("~/repos")).toThrow("must be an absolute path");
  });
});

describe("validateGitUrl", () => {
  test("accepts HTTPS URL with .git", () => {
    expect(validateGitUrl("https://github.com/user/repo.git")).toBe(
      "https://github.com/user/repo.git",
    );
  });

  test("accepts HTTPS URL without .git", () => {
    expect(validateGitUrl("https://github.com/user/repo")).toBe(
      "https://github.com/user/repo",
    );
  });

  test("accepts git@ SSH URL with .git", () => {
    expect(validateGitUrl("git@github.com:user/repo.git")).toBe(
      "git@github.com:user/repo.git",
    );
  });

  test("accepts git@ SSH URL without .git", () => {
    expect(validateGitUrl("git@github.com:user/repo")).toBe(
      "git@github.com:user/repo",
    );
  });

  test("accepts ssh:// URL", () => {
    expect(validateGitUrl("ssh://git@github.com/user/repo.git")).toBe(
      "ssh://git@github.com/user/repo.git",
    );
  });

  test("accepts URL with nested paths", () => {
    expect(validateGitUrl("https://github.com/org/sub/repo.git")).toBe(
      "https://github.com/org/sub/repo.git",
    );
  });

  test("rejects empty string", () => {
    expect(() => validateGitUrl("")).toThrow("Invalid git URL");
  });

  test("rejects plain word", () => {
    expect(() => validateGitUrl("repo")).toThrow("Invalid git URL");
  });

  test("rejects HTTP (non-HTTPS)", () => {
    expect(() => validateGitUrl("http://github.com/user/repo.git")).toThrow(
      "Invalid git URL",
    );
  });

  test("rejects ftp:// URL", () => {
    expect(() => validateGitUrl("ftp://github.com/user/repo.git")).toThrow(
      "Invalid git URL",
    );
  });

  test("rejects file:// URL", () => {
    expect(() => validateGitUrl("file:///tmp/repo.git")).toThrow(
      "Invalid git URL",
    );
  });

  // Adversarial inputs
  test("rejects URL with shell injection", () => {
    expect(() => validateGitUrl("https://evil.com/$(whoami).git")).toThrow(
      "Invalid git URL",
    );
  });

  test("rejects URL with spaces", () => {
    expect(() => validateGitUrl("https://github.com/user/my repo")).toThrow(
      "Invalid git URL",
    );
  });

  test("rejects URL with semicolons", () => {
    expect(() =>
      validateGitUrl("https://github.com/user/repo;rm -rf /"),
    ).toThrow("Invalid git URL");
  });
});
