import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { FakeSshExecutor } from "../fakes/fake-ssh-executor.ts";
import { buildSshCommand } from "../../src/coding/ssh.ts";

const CLI_PATH = resolve(import.meta.dir, "../../src/coding/cli.ts");

describe("buildSshCommand", () => {
  test("constructs basic SSH command array with default options", () => {
    const cmd = buildSshCommand("coding-vm", "pug-claw", "uname -a");
    expect(cmd[0]).toBe("ssh");
    expect(cmd).toContain("-o");
    expect(cmd).toContain("BatchMode=yes");
    expect(cmd).toContain("ConnectTimeout=10");
    expect(cmd).toContain("StrictHostKeyChecking=accept-new");
    expect(cmd.at(-2)).toBe("pug-claw@coding-vm");
    expect(cmd.at(-1)).toBe("uname -a");
  });

  test("handles host with domain suffix", () => {
    const cmd = buildSshCommand("vm.tail1234.ts.net", "deploy", "whoami");
    expect(cmd.at(-2)).toBe("deploy@vm.tail1234.ts.net");
    expect(cmd.at(-1)).toBe("whoami");
  });

  test("preserves multi-word commands as single argument", () => {
    const cmd = buildSshCommand("host", "user", "cd /home/user && ls -la");
    expect(cmd.at(-1)).toBe("cd /home/user && ls -la");
  });

  test("includes extra SSH options when provided", () => {
    const cmd = buildSshCommand("host", "user", "echo hi", [
      "-i",
      "/tmp/key",
      "-p",
      "2222",
    ]);
    expect(cmd).toContain("-i");
    expect(cmd).toContain("/tmp/key");
    expect(cmd).toContain("-p");
    expect(cmd).toContain("2222");
    // Extra options come before user@host
    const userHostIdx = cmd.indexOf("user@host");
    const keyIdx = cmd.indexOf("-i");
    expect(keyIdx).toBeLessThan(userHostIdx);
  });
});

describe("FakeSshExecutor", () => {
  test("records commands in calls array", async () => {
    const fake = new FakeSshExecutor();
    await fake.exec("echo hello");
    await fake.exec("ls -la");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.command).toBe("echo hello");
    expect(fake.calls[1]?.command).toBe("ls -la");
  });

  test("returns matching response by command substring", async () => {
    const fake = new FakeSshExecutor();
    fake.onCommand("echo", { stdout: "hello\n", stderr: "", exitCode: 0 });
    fake.onCommand("fail", { stdout: "", stderr: "error", exitCode: 1 });

    const r1 = await fake.exec("echo hello");
    expect(r1.stdout).toBe("hello\n");
    expect(r1.exitCode).toBe(0);

    const r2 = await fake.exec("this will fail");
    expect(r2.stderr).toBe("error");
    expect(r2.exitCode).toBe(1);
  });

  test("returns default response when no match found", async () => {
    const fake = new FakeSshExecutor();
    const result = await fake.exec("unmatched command");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("supports custom default response", async () => {
    const fake = new FakeSshExecutor();
    fake.setDefaultResponse({
      stdout: "default out",
      stderr: "",
      exitCode: 42,
    });
    const result = await fake.exec("anything");
    expect(result.stdout).toBe("default out");
    expect(result.exitCode).toBe(42);
  });

  test("records stdin in calls when provided", async () => {
    const fake = new FakeSshExecutor();
    await fake.exec("cat", { stdin: "piped text" });
    expect(fake.calls[0]?.stdin).toBe("piped text");
  });

  test("records undefined stdin when not provided", async () => {
    const fake = new FakeSshExecutor();
    await fake.exec("echo hi");
    expect(fake.calls[0]?.stdin).toBeUndefined();
  });

  test("first matching response wins", async () => {
    const fake = new FakeSshExecutor();
    fake.onCommand("echo", { stdout: "first", stderr: "", exitCode: 0 });
    fake.onCommand("echo hello", { stdout: "second", stderr: "", exitCode: 0 });

    const result = await fake.exec("echo hello world");
    expect(result.stdout).toBe("first");
  });
});

describe("coding CLI", () => {
  test("shows help with --help flag", () => {
    const result = Bun.spawnSync(["bun", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain("exec");
  });

  test("exits with error when --host is missing", () => {
    const result = Bun.spawnSync(
      ["bun", CLI_PATH, "exec", "--user", "test", "--command", "echo"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });

  test("exits with error when --command is missing", () => {
    const result = Bun.spawnSync(
      ["bun", CLI_PATH, "exec", "--host", "test", "--user", "test"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).not.toBe(0);
  });
});
