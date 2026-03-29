import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { FakeSshExecutor } from "../fakes/fake-ssh-executor.ts";
import {
  AcpxClient,
  buildAcpxCancelCommand,
  buildAcpxResultCommand,
  buildAcpxSessionsCommand,
  buildAcpxStatusCommand,
  buildAcpxSubmitCommand,
  buildCloneCommand,
  generateTaskId,
  parseAcpxSessionsList,
  parseAcpxStatus,
  parseAcpxSubmitResponse,
  parseCloneOutput,
} from "../../src/coding/acpx.ts";

const CLI_PATH = resolve(import.meta.dir, "../../src/coding/cli.ts");

// --- Pure command builders ---

describe("buildAcpxSubmitCommand", () => {
  test("produces cd + acpx command with agent", () => {
    const cmd = buildAcpxSubmitCommand("claude", "/home/user/repos/app");
    expect(cmd).toBe(
      "cd /home/user/repos/app && acpx --no-wait --format json claude",
    );
  });

  test("includes --session when sessionName provided", () => {
    const cmd = buildAcpxSubmitCommand(
      "claude",
      "/home/user/repos/app",
      "my-session",
    );
    expect(cmd).toContain("--session my-session");
    expect(cmd).toContain("acpx --no-wait --format json");
  });

  test("omits --session when sessionName undefined", () => {
    const cmd = buildAcpxSubmitCommand("claude", "/home/user/repos/app");
    expect(cmd).not.toContain("--session");
  });

  test("rejects invalid agent", () => {
    expect(() => buildAcpxSubmitCommand("bad;agent", "/home/user")).toThrow(
      "Invalid name",
    );
  });

  test("rejects relative cwd", () => {
    expect(() => buildAcpxSubmitCommand("claude", "relative/path")).toThrow(
      "Invalid path",
    );
  });

  test("rejects invalid sessionName", () => {
    expect(() =>
      buildAcpxSubmitCommand("claude", "/home/user", "bad;name"),
    ).toThrow("Invalid name");
  });

  test("accepts pi, codex, claude agents", () => {
    expect(buildAcpxSubmitCommand("pi", "/home/user")).toContain("pi");
    expect(buildAcpxSubmitCommand("codex", "/home/user")).toContain("codex");
    expect(buildAcpxSubmitCommand("claude", "/home/user")).toContain("claude");
  });
});

describe("buildAcpxStatusCommand", () => {
  test("produces cd + acpx agent status", () => {
    const cmd = buildAcpxStatusCommand("claude", "/home/user/repos/app");
    expect(cmd).toBe("cd /home/user/repos/app && acpx claude status");
  });

  test("includes --session when provided", () => {
    const cmd = buildAcpxStatusCommand("claude", "/home/user", "my-session");
    expect(cmd).toContain("--session my-session");
  });

  test("rejects invalid agent", () => {
    expect(() => buildAcpxStatusCommand("bad|agent", "/home/user")).toThrow(
      "Invalid name",
    );
  });

  test("rejects invalid cwd", () => {
    expect(() => buildAcpxStatusCommand("claude", "relative")).toThrow(
      "Invalid path",
    );
  });
});

describe("buildAcpxResultCommand", () => {
  test("produces cd + acpx sessions history --limit 1", () => {
    const cmd = buildAcpxResultCommand("claude", "/home/user/repos/app");
    expect(cmd).toBe(
      "cd /home/user/repos/app && acpx claude sessions history --limit 1",
    );
  });

  test("includes --session when provided", () => {
    const cmd = buildAcpxResultCommand("codex", "/home/user", "my-session");
    expect(cmd).toContain("--session my-session");
  });
});

describe("buildAcpxCancelCommand", () => {
  test("produces cd + acpx agent cancel", () => {
    const cmd = buildAcpxCancelCommand("claude", "/home/user/repos/app");
    expect(cmd).toBe("cd /home/user/repos/app && acpx claude cancel");
  });

  test("includes --session when provided", () => {
    const cmd = buildAcpxCancelCommand("pi", "/home/user", "my-session");
    expect(cmd).toContain("--session my-session");
  });
});

describe("buildAcpxSessionsCommand", () => {
  test("produces acpx agent sessions list (no cd)", () => {
    const cmd = buildAcpxSessionsCommand("claude");
    expect(cmd).toBe("acpx claude sessions list");
  });

  test("rejects invalid agent", () => {
    expect(() => buildAcpxSessionsCommand("$(whoami)")).toThrow("Invalid name");
  });
});

describe("buildCloneCommand", () => {
  test("produces git clone with URL only", () => {
    const cmd = buildCloneCommand("https://github.com/user/repo.git");
    expect(cmd).toBe("git clone https://github.com/user/repo.git");
  });

  test("produces git clone with URL and path", () => {
    const cmd = buildCloneCommand(
      "https://github.com/user/repo.git",
      "/home/user/repos/repo",
    );
    expect(cmd).toBe(
      "git clone https://github.com/user/repo.git /home/user/repos/repo",
    );
  });

  test("rejects invalid git URL", () => {
    expect(() => buildCloneCommand("not-a-url")).toThrow("Invalid git URL");
  });

  test("rejects relative path", () => {
    expect(() =>
      buildCloneCommand("https://github.com/user/repo.git", "relative"),
    ).toThrow("Invalid path");
  });

  test("accepts git@ SSH URL", () => {
    const cmd = buildCloneCommand("git@github.com:user/repo.git");
    expect(cmd).toBe("git clone git@github.com:user/repo.git");
  });
});

// --- Pure parsers ---

describe("parseAcpxSubmitResponse", () => {
  test("parses NDJSON with sessionId", () => {
    const output = '{"sessionId":"abc123","type":"prompt"}\n';
    expect(parseAcpxSubmitResponse(output)).toBe("abc123");
  });

  test("parses JSON with session_id field", () => {
    const output = '{"session_id":"task_456"}';
    expect(parseAcpxSubmitResponse(output)).toBe("task_456");
  });

  test("parses JSON with id field", () => {
    const output = '{"id":"xyz789"}';
    expect(parseAcpxSubmitResponse(output)).toBe("xyz789");
  });

  test("falls back to first line for non-JSON", () => {
    expect(parseAcpxSubmitResponse("session-id-plain")).toBe(
      "session-id-plain",
    );
  });

  test("throws on empty output", () => {
    expect(() => parseAcpxSubmitResponse("")).toThrow("empty output");
  });

  test("handles NDJSON with multiple lines", () => {
    const output =
      '{"type":"start"}\n{"sessionId":"found-it","type":"prompt"}\n';
    expect(parseAcpxSubmitResponse(output)).toBe("found-it");
  });

  test("handles trailing whitespace", () => {
    const output = '{"sessionId":"abc123"}  \n  ';
    expect(parseAcpxSubmitResponse(output)).toBe("abc123");
  });
});

describe("parseAcpxStatus", () => {
  test("parses JSON with running status", () => {
    const result = parseAcpxStatus('{"status":"running"}');
    expect(result.status).toBe("running");
  });

  test("parses JSON with completed status", () => {
    const result = parseAcpxStatus('{"status":"completed"}');
    expect(result.status).toBe("completed");
  });

  test("maps idle to completed", () => {
    const result = parseAcpxStatus('{"status":"idle"}');
    expect(result.status).toBe("completed");
  });

  test("maps dead to failed", () => {
    const result = parseAcpxStatus('{"status":"dead"}');
    expect(result.status).toBe("failed");
  });

  test("maps failed to failed", () => {
    const result = parseAcpxStatus('{"status":"failed"}');
    expect(result.status).toBe("failed");
  });

  test("maps cancelled to cancelled", () => {
    const result = parseAcpxStatus('{"status":"cancelled"}');
    expect(result.status).toBe("cancelled");
  });

  test("includes summary from JSON", () => {
    const result = parseAcpxStatus(
      '{"status":"running","summary":"Working on tests..."}',
    );
    expect(result.summary).toBe("Working on tests...");
  });

  test("keyword fallback: running", () => {
    const result = parseAcpxStatus("Status: running (pid 1234)");
    expect(result.status).toBe("running");
  });

  test("keyword fallback: failed/error", () => {
    expect(parseAcpxStatus("Process error occurred").status).toBe("failed");
    expect(parseAcpxStatus("Process is dead").status).toBe("failed");
  });

  test("keyword fallback: cancelled", () => {
    expect(parseAcpxStatus("Task was cancelled").status).toBe("cancelled");
    expect(parseAcpxStatus("Task was canceled").status).toBe("cancelled");
  });

  test("empty output returns completed", () => {
    expect(parseAcpxStatus("").status).toBe("completed");
  });

  test("unrecognized text returns completed with summary", () => {
    const result = parseAcpxStatus("some unknown output");
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("some unknown output");
  });
});

describe("parseAcpxSessionsList", () => {
  test("parses JSON array", () => {
    const output =
      '[{"session_id":"s1","agent":"claude","status":"running"},{"session_id":"s2","agent":"codex","status":"idle"}]';
    const result = parseAcpxSessionsList(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      sessionId: "s1",
      agent: "claude",
      status: "running",
    });
    expect(result[1]).toEqual({
      sessionId: "s2",
      agent: "codex",
      status: "idle",
    });
  });

  test("parses JSON with sessionId field", () => {
    const output = '[{"sessionId":"s1","agent":"pi","status":"done"}]';
    const result = parseAcpxSessionsList(output);
    expect(result[0]?.sessionId).toBe("s1");
  });

  test("returns empty array for empty string", () => {
    expect(parseAcpxSessionsList("")).toEqual([]);
  });

  test("returns empty array for whitespace", () => {
    expect(parseAcpxSessionsList("  \n  ")).toEqual([]);
  });

  test("falls back to space-delimited lines", () => {
    const output = "s1 claude running\ns2 codex idle\n";
    const result = parseAcpxSessionsList(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      sessionId: "s1",
      agent: "claude",
      status: "running",
    });
  });

  test("skips lines with fewer than 3 fields", () => {
    const output = "s1 claude running\nincomplete\ns2 codex idle\n";
    const result = parseAcpxSessionsList(output);
    expect(result).toHaveLength(2);
  });

  test("filters empty sessionIds from JSON", () => {
    const output = '[{"session_id":"","agent":"claude","status":"running"}]';
    expect(parseAcpxSessionsList(output)).toEqual([]);
  });
});

describe("parseCloneOutput", () => {
  test("extracts path from Cloning into pattern", () => {
    const output = "Cloning into '/home/user/my-repo'...\n";
    expect(
      parseCloneOutput(output, "https://github.com/user/my-repo.git"),
    ).toBe("/home/user/my-repo");
  });

  test("derives repo name from HTTPS URL", () => {
    expect(parseCloneOutput("", "https://github.com/user/my-repo.git")).toBe(
      "my-repo",
    );
  });

  test("derives repo name from git@ URL", () => {
    expect(parseCloneOutput("", "git@github.com:user/my-repo.git")).toBe(
      "my-repo",
    );
  });

  test("strips .git suffix when deriving from URL", () => {
    expect(parseCloneOutput("", "https://github.com/org/project.git")).toBe(
      "project",
    );
  });

  test("returns URL as fallback", () => {
    expect(parseCloneOutput("", "something-unusual")).toBe("something-unusual");
  });
});

// --- generateTaskId ---

describe("generateTaskId", () => {
  test("returns string starting with coding_", () => {
    const id = generateTaskId();
    expect(id.startsWith("coding_")).toBe(true);
  });

  test("returns unique values on successive calls", () => {
    const a = generateTaskId();
    const b = generateTaskId();
    expect(a).not.toBe(b);
  });
});

// --- AcpxClient with FakeSshExecutor ---

describe("AcpxClient", () => {
  describe("submit", () => {
    test("sends correct command with prompt via stdin", async () => {
      const fake = new FakeSshExecutor();
      fake.onCommand("acpx", {
        stdout: '{"sessionId":"abc123"}\n',
        stderr: "",
        exitCode: 0,
      });
      const client = new AcpxClient(fake);

      const sessionId = await client.submit({
        prompt: "fix the failing tests",
        agent: "claude",
        cwd: "/home/user/repos/app",
      });

      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.command).toContain(
        "acpx --no-wait --format json claude",
      );
      expect(fake.calls[0]?.command).toContain("cd /home/user/repos/app");
      expect(fake.calls[0]?.stdin).toBe("fix the failing tests");
      expect(sessionId).toBe("abc123");
    });

    test("prompt is NOT in the command string", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: '{"sessionId":"abc"}\n',
        stderr: "",
        exitCode: 0,
      });
      const client = new AcpxClient(fake);

      await client.submit({
        prompt: "dangerous $(rm -rf /)",
        cwd: "/home/user",
      });

      expect(fake.calls[0]?.command).not.toContain("dangerous");
      expect(fake.calls[0]?.stdin).toBe("dangerous $(rm -rf /)");
    });

    test("uses default agent when none provided", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: '{"sessionId":"abc"}\n',
        stderr: "",
        exitCode: 0,
      });
      const client = new AcpxClient(fake);

      await client.submit({ prompt: "test", cwd: "/home/user" });

      expect(fake.calls[0]?.command).toContain("claude");
    });

    test("passes sessionName when provided", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: '{"sessionId":"abc"}\n',
        stderr: "",
        exitCode: 0,
      });
      const client = new AcpxClient(fake);

      await client.submit({
        prompt: "test",
        cwd: "/home/user",
        sessionName: "my-session",
      });

      expect(fake.calls[0]?.command).toContain("--session my-session");
    });

    test("throws on non-zero exit code", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr: "connection refused",
        exitCode: 1,
      });
      const client = new AcpxClient(fake);

      expect(
        client.submit({ prompt: "test", cwd: "/home/user" }),
      ).rejects.toThrow("acpx submit failed");
    });

    test("validates inputs before executing SSH", async () => {
      const fake = new FakeSshExecutor();
      const client = new AcpxClient(fake);

      expect(
        client.submit({ prompt: "test", cwd: "relative/path" }),
      ).rejects.toThrow("Invalid path");
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe("status", () => {
    test("sends correct status command", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: '{"status":"running"}',
        stderr: "",
        exitCode: 0,
      });
      const client = new AcpxClient(fake);

      const status = await client.status({ cwd: "/home/user" });

      expect(fake.calls[0]?.command).toContain("acpx claude status");
      expect(status.status).toBe("running");
    });

    test("uses default agent", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: '{"status":"idle"}',
        stderr: "",
        exitCode: 0,
      });
      const client = new AcpxClient(fake);

      await client.status({ cwd: "/home/user" });

      expect(fake.calls[0]?.command).toContain("claude");
    });

    test("throws on non-zero exit code", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({ stdout: "", stderr: "error", exitCode: 1 });
      const client = new AcpxClient(fake);

      expect(client.status({ cwd: "/home/user" })).rejects.toThrow(
        "acpx status failed",
      );
    });

    test("does not send stdin", async () => {
      const fake = new FakeSshExecutor();
      const client = new AcpxClient(fake);

      await client.status({ cwd: "/home/user" });

      expect(fake.calls[0]?.stdin).toBeUndefined();
    });
  });

  describe("result", () => {
    test("sends correct result command", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "The fix was applied successfully.",
        stderr: "",
        exitCode: 0,
      });
      const client = new AcpxClient(fake);

      const result = await client.result({ cwd: "/home/user" });

      expect(fake.calls[0]?.command).toContain("sessions history --limit 1");
      expect(result).toBe("The fix was applied successfully.");
    });

    test("throws on non-zero exit code", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({ stdout: "", stderr: "error", exitCode: 1 });
      const client = new AcpxClient(fake);

      expect(client.result({ cwd: "/home/user" })).rejects.toThrow(
        "acpx result failed",
      );
    });
  });

  describe("cancel", () => {
    test("sends correct cancel command", async () => {
      const fake = new FakeSshExecutor();
      const client = new AcpxClient(fake);

      await client.cancel({ cwd: "/home/user" });

      expect(fake.calls[0]?.command).toContain("acpx claude cancel");
    });

    test("throws on non-zero exit code", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({ stdout: "", stderr: "error", exitCode: 1 });
      const client = new AcpxClient(fake);

      expect(client.cancel({ cwd: "/home/user" })).rejects.toThrow(
        "acpx cancel failed",
      );
    });
  });

  describe("sessions", () => {
    test("sends correct sessions command", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: '[{"session_id":"s1","agent":"claude","status":"running"}]',
        stderr: "",
        exitCode: 0,
      });
      const client = new AcpxClient(fake);

      const sessions = await client.sessions();

      expect(fake.calls[0]?.command).toBe("acpx claude sessions list");
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.sessionId).toBe("s1");
    });

    test("uses default agent when none provided", async () => {
      const fake = new FakeSshExecutor();
      const client = new AcpxClient(fake);

      await client.sessions();

      expect(fake.calls[0]?.command).toContain("claude");
    });

    test("uses specified agent", async () => {
      const fake = new FakeSshExecutor();
      const client = new AcpxClient(fake);

      await client.sessions("pi");

      expect(fake.calls[0]?.command).toBe("acpx pi sessions list");
    });

    test("returns empty array on empty output", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({ stdout: "", stderr: "", exitCode: 0 });
      const client = new AcpxClient(fake);

      expect(await client.sessions()).toEqual([]);
    });

    test("throws on non-zero exit code", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({ stdout: "", stderr: "error", exitCode: 1 });
      const client = new AcpxClient(fake);

      expect(client.sessions()).rejects.toThrow("acpx sessions failed");
    });
  });

  describe("clone", () => {
    test("sends correct git clone command", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr: "Cloning into '/home/user/repo'...\n",
        exitCode: 0,
      });
      const client = new AcpxClient(fake);

      const path = await client.clone("https://github.com/user/repo.git");

      expect(fake.calls[0]?.command).toBe(
        "git clone https://github.com/user/repo.git",
      );
      expect(path).toBe("/home/user/repo");
    });

    test("sends git clone with path", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr: "Cloning into '/tmp/clone'...\n",
        exitCode: 0,
      });
      const client = new AcpxClient(fake);

      await client.clone("https://github.com/user/repo.git", "/tmp/clone");

      expect(fake.calls[0]?.command).toBe(
        "git clone https://github.com/user/repo.git /tmp/clone",
      );
    });

    test("throws on non-zero exit code", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr: "fatal: repository not found",
        exitCode: 128,
      });
      const client = new AcpxClient(fake);

      expect(client.clone("https://github.com/user/repo.git")).rejects.toThrow(
        "git clone failed",
      );
    });

    test("validates URL before executing SSH", async () => {
      const fake = new FakeSshExecutor();
      const client = new AcpxClient(fake);

      expect(client.clone("not-a-url")).rejects.toThrow("Invalid git URL");
      expect(fake.calls).toHaveLength(0);
    });
  });
});

// --- CLI ---

describe("coding CLI acpx", () => {
  test("coding --help shows subcommands", () => {
    const result = Bun.spawnSync(["bun", CLI_PATH, "coding", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain("submit");
    expect(stdout).toContain("status");
    expect(stdout).toContain("result");
    expect(stdout).toContain("cancel");
    expect(stdout).toContain("sessions");
  });

  test("coding submit requires --cwd", () => {
    const result = Bun.spawnSync(
      [
        "bun",
        CLI_PATH,
        "coding",
        "submit",
        "--host",
        "h",
        "--user",
        "u",
        "--prompt",
        "test",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });

  test("coding submit requires --prompt", () => {
    const result = Bun.spawnSync(
      [
        "bun",
        CLI_PATH,
        "coding",
        "submit",
        "--host",
        "h",
        "--user",
        "u",
        "--cwd",
        "/path",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });

  test("coding status requires --cwd", () => {
    const result = Bun.spawnSync(
      ["bun", CLI_PATH, "coding", "status", "--host", "h", "--user", "u"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });

  test("coding sessions requires --host", () => {
    const result = Bun.spawnSync(
      ["bun", CLI_PATH, "coding", "sessions", "--user", "u"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });

  test("clone requires --url", () => {
    const result = Bun.spawnSync(
      ["bun", CLI_PATH, "clone", "--host", "h", "--user", "u"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });
});
