import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { FakeSshExecutor } from "../fakes/fake-ssh-executor.ts";
import {
  TmuxClient,
  buildTmuxKillCommand,
  buildTmuxListCommand,
  buildTmuxReadCommand,
  buildTmuxSendCommand,
  buildTmuxStartCommand,
  parseTmuxSessionsList,
} from "../../src/coding/tmux.ts";

const CLI_PATH = resolve(import.meta.dir, "../../src/coding/cli.ts");

// --- Pure command builders ---

describe("buildTmuxStartCommand", () => {
  test("produces command that reads stdin and starts tmux session", () => {
    const cmd = buildTmuxStartCommand("dev");
    expect(cmd).toContain("cmd=$(cat)");
    expect(cmd).toContain("tmux new-session -d -s dev");
    expect(cmd).toContain('sh -c "$cmd"');
  });

  test("rejects invalid name with shell metacharacters", () => {
    expect(() => buildTmuxStartCommand("foo;rm -rf /")).toThrow("Invalid name");
  });

  test("rejects empty name", () => {
    expect(() => buildTmuxStartCommand("")).toThrow("Invalid name");
  });

  test("accepts name with hyphens and underscores", () => {
    const cmd = buildTmuxStartCommand("my-session_1");
    expect(cmd).toContain("tmux new-session -d -s my-session_1");
  });
});

describe("buildTmuxReadCommand", () => {
  test("produces capture-pane command with name and line count", () => {
    const cmd = buildTmuxReadCommand("dev", 50);
    expect(cmd).toBe("tmux capture-pane -t dev -p -S -50");
  });

  test("rejects invalid name", () => {
    expect(() => buildTmuxReadCommand("bad;name", 50)).toThrow("Invalid name");
  });

  test("rejects zero lines", () => {
    expect(() => buildTmuxReadCommand("dev", 0)).toThrow("positive integer");
  });

  test("rejects negative lines", () => {
    expect(() => buildTmuxReadCommand("dev", -5)).toThrow("positive integer");
  });

  test("rejects non-integer lines", () => {
    expect(() => buildTmuxReadCommand("dev", 10.5)).toThrow("positive integer");
  });

  test("accepts large line count", () => {
    const cmd = buildTmuxReadCommand("dev", 10000);
    expect(cmd).toBe("tmux capture-pane -t dev -p -S -10000");
  });
});

describe("buildTmuxSendCommand", () => {
  test("produces load-buffer and paste-buffer command", () => {
    const cmd = buildTmuxSendCommand("dev");
    expect(cmd).toContain("tmux load-buffer -");
    expect(cmd).toContain("tmux paste-buffer -t dev -d");
  });

  test("rejects invalid name", () => {
    expect(() => buildTmuxSendCommand("$(whoami)")).toThrow("Invalid name");
  });
});

describe("buildTmuxListCommand", () => {
  test("produces list-sessions command with format string", () => {
    const cmd = buildTmuxListCommand();
    expect(cmd).toBe(
      'tmux list-sessions -F "#{session_name} #{session_activity}"',
    );
  });
});

describe("buildTmuxKillCommand", () => {
  test("produces kill-session command with sanitized name", () => {
    const cmd = buildTmuxKillCommand("dev");
    expect(cmd).toBe("tmux kill-session -t dev");
  });

  test("rejects invalid name", () => {
    expect(() => buildTmuxKillCommand("bad|name")).toThrow("Invalid name");
  });
});

// --- Pure parser ---

describe("parseTmuxSessionsList", () => {
  test("parses single session line", () => {
    const result = parseTmuxSessionsList("dev 1700000000");
    expect(result).toEqual([{ name: "dev", lastActivity: "1700000000" }]);
  });

  test("parses multiple session lines", () => {
    const result = parseTmuxSessionsList(
      "dev 1700000000\nstaging 1700001000\nprod 1700002000",
    );
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ name: "dev", lastActivity: "1700000000" });
    expect(result[1]).toEqual({ name: "staging", lastActivity: "1700001000" });
    expect(result[2]).toEqual({ name: "prod", lastActivity: "1700002000" });
  });

  test("returns empty array for empty string", () => {
    expect(parseTmuxSessionsList("")).toEqual([]);
  });

  test("returns empty array for whitespace-only string", () => {
    expect(parseTmuxSessionsList("  \n  ")).toEqual([]);
  });

  test("skips malformed lines without spaces", () => {
    const result = parseTmuxSessionsList("noseparator");
    expect(result).toEqual([]);
  });

  test("handles session name with hyphens and underscores", () => {
    const result = parseTmuxSessionsList("my-dev_1 1700000000");
    expect(result).toEqual([{ name: "my-dev_1", lastActivity: "1700000000" }]);
  });

  test("handles trailing newline", () => {
    const result = parseTmuxSessionsList("dev 1700000000\n");
    expect(result).toEqual([{ name: "dev", lastActivity: "1700000000" }]);
  });
});

// --- TmuxClient with FakeSshExecutor ---

describe("TmuxClient", () => {
  describe("start", () => {
    test("sends correct command with name and command via stdin", async () => {
      const fake = new FakeSshExecutor();
      const client = new TmuxClient(fake);
      await client.start("dev", "npm run dev");

      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.command).toContain("tmux new-session -d -s dev");
      expect(fake.calls[0]?.stdin).toBe("npm run dev");
    });

    test("throws on non-zero exit code", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({ stdout: "", stderr: "error", exitCode: 1 });
      const client = new TmuxClient(fake);

      expect(client.start("dev", "npm run dev")).rejects.toThrow(
        "tmux start failed",
      );
    });

    test("includes stderr in error message", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr: "duplicate session: dev",
        exitCode: 1,
      });
      const client = new TmuxClient(fake);

      expect(client.start("dev", "npm run dev")).rejects.toThrow(
        "duplicate session: dev",
      );
    });

    test("validates name before executing SSH", async () => {
      const fake = new FakeSshExecutor();
      const client = new TmuxClient(fake);

      expect(client.start("bad;name", "echo hi")).rejects.toThrow(
        "Invalid name",
      );
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe("read", () => {
    test("sends capture-pane command with default lines", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "line1\nline2\n",
        stderr: "",
        exitCode: 0,
      });
      const client = new TmuxClient(fake);
      await client.read("dev");

      expect(fake.calls[0]?.command).toContain(
        "tmux capture-pane -t dev -p -S -100",
      );
    });

    test("respects custom line count", async () => {
      const fake = new FakeSshExecutor();
      const client = new TmuxClient(fake);
      await client.read("dev", 50);

      expect(fake.calls[0]?.command).toContain("-S -50");
    });

    test("returns stdout as captured text", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "line1\nline2\n",
        stderr: "",
        exitCode: 0,
      });
      const client = new TmuxClient(fake);
      const result = await client.read("dev");

      expect(result).toBe("line1\nline2\n");
    });

    test("throws on non-zero exit code", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr: "session not found: dev",
        exitCode: 1,
      });
      const client = new TmuxClient(fake);

      expect(client.read("dev")).rejects.toThrow("tmux read failed");
    });

    test("does not send stdin", async () => {
      const fake = new FakeSshExecutor();
      const client = new TmuxClient(fake);
      await client.read("dev");

      expect(fake.calls[0]?.stdin).toBeUndefined();
    });
  });

  describe("send", () => {
    test("sends correct command with keys via stdin", async () => {
      const fake = new FakeSshExecutor();
      const client = new TmuxClient(fake);
      await client.send("dev", "ls -la\n");

      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.command).toContain("tmux load-buffer -");
      expect(fake.calls[0]?.command).toContain("tmux paste-buffer -t dev -d");
      expect(fake.calls[0]?.stdin).toBe("ls -la\n");
    });

    test("handles multi-line text via stdin", async () => {
      const fake = new FakeSshExecutor();
      const client = new TmuxClient(fake);
      const text = "line1\nline2\nline3\n";
      await client.send("dev", text);

      expect(fake.calls[0]?.stdin).toBe(text);
    });

    test("handles text with shell metacharacters via stdin", async () => {
      const fake = new FakeSshExecutor();
      const client = new TmuxClient(fake);
      const dangerous = "echo $(whoami); rm -rf / && cat /etc/passwd";
      await client.send("dev", dangerous);

      expect(fake.calls[0]?.stdin).toBe(dangerous);
    });

    test("throws on non-zero exit code", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr: "session not found",
        exitCode: 1,
      });
      const client = new TmuxClient(fake);

      expect(client.send("dev", "text")).rejects.toThrow("tmux send failed");
    });
  });

  describe("list", () => {
    test("parses successful list output", async () => {
      const fake = new FakeSshExecutor();
      fake.onCommand("list-sessions", {
        stdout: "dev 1700000000\nstaging 1700001000\n",
        stderr: "",
        exitCode: 0,
      });
      const client = new TmuxClient(fake);
      const sessions = await client.list();

      expect(sessions).toHaveLength(2);
      expect(sessions[0]?.name).toBe("dev");
      expect(sessions[1]?.name).toBe("staging");
    });

    test("returns empty array when no server running", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr: "no server running on /tmp/tmux-0/default",
        exitCode: 1,
      });
      const client = new TmuxClient(fake);
      const sessions = await client.list();

      expect(sessions).toEqual([]);
    });

    test("returns empty array when no sessions", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr: "no sessions",
        exitCode: 1,
      });
      const client = new TmuxClient(fake);
      const sessions = await client.list();

      expect(sessions).toEqual([]);
    });

    test("returns empty array when error connecting to socket", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr:
          "error connecting to /tmp/tmux-0/default (No such file or directory)",
        exitCode: 1,
      });
      const client = new TmuxClient(fake);
      const sessions = await client.list();

      expect(sessions).toEqual([]);
    });

    test("throws on unexpected non-zero exit code", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr: "something unexpected",
        exitCode: 2,
      });
      const client = new TmuxClient(fake);

      expect(client.list()).rejects.toThrow("tmux list failed");
    });

    test("does not send stdin", async () => {
      const fake = new FakeSshExecutor();
      const client = new TmuxClient(fake);
      await client.list();

      expect(fake.calls[0]?.stdin).toBeUndefined();
    });
  });

  describe("kill", () => {
    test("sends correct kill-session command", async () => {
      const fake = new FakeSshExecutor();
      const client = new TmuxClient(fake);
      await client.kill("dev");

      expect(fake.calls[0]?.command).toContain("tmux kill-session -t dev");
    });

    test("throws on non-zero exit code", async () => {
      const fake = new FakeSshExecutor();
      fake.setDefaultResponse({
        stdout: "",
        stderr: "session not found: dev",
        exitCode: 1,
      });
      const client = new TmuxClient(fake);

      expect(client.kill("dev")).rejects.toThrow("tmux kill failed");
    });

    test("validates name before executing SSH", async () => {
      const fake = new FakeSshExecutor();
      const client = new TmuxClient(fake);

      expect(client.kill("bad;name")).rejects.toThrow("Invalid name");
      expect(fake.calls).toHaveLength(0);
    });
  });
});

// --- CLI tmux subcommands ---

describe("coding CLI tmux", () => {
  test("tmux --help shows subcommands", () => {
    const result = Bun.spawnSync(["bun", CLI_PATH, "tmux", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain("start");
    expect(stdout).toContain("read");
    expect(stdout).toContain("send");
    expect(stdout).toContain("list");
    expect(stdout).toContain("kill");
  });

  test("tmux start requires --name", () => {
    const result = Bun.spawnSync(
      [
        "bun",
        CLI_PATH,
        "tmux",
        "start",
        "--host",
        "h",
        "--user",
        "u",
        "--command",
        "echo",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });

  test("tmux read requires --name", () => {
    const result = Bun.spawnSync(
      ["bun", CLI_PATH, "tmux", "read", "--host", "h", "--user", "u"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });

  test("tmux send requires --keys", () => {
    const result = Bun.spawnSync(
      [
        "bun",
        CLI_PATH,
        "tmux",
        "send",
        "--host",
        "h",
        "--user",
        "u",
        "--name",
        "n",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });

  test("tmux list requires --host", () => {
    const result = Bun.spawnSync(
      ["bun", CLI_PATH, "tmux", "list", "--user", "u"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });

  test("tmux kill requires --name", () => {
    const result = Bun.spawnSync(
      ["bun", CLI_PATH, "tmux", "kill", "--host", "h", "--user", "u"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });
});
