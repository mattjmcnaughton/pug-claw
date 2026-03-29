import { describe, expect, test } from "bun:test";
import { AcpxClient } from "../../src/coding/acpx.ts";
import { CodingClient, createCodingClient } from "../../src/coding/index.ts";
import { TmuxClient } from "../../src/coding/tmux.ts";
import { FakeSshExecutor } from "../fakes/fake-ssh-executor.ts";

function makeClient() {
  const fake = new FakeSshExecutor();
  const tmux = new TmuxClient(fake);
  const acpx = new AcpxClient(fake);
  const client = new CodingClient({ ssh: fake, tmux, acpx });
  return { fake, client };
}

// --- Layer 1: exec ---

describe("CodingClient exec", () => {
  test("delegates to ssh.exec and returns ExecResult", async () => {
    const { fake, client } = makeClient();
    fake.setDefaultResponse({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await client.exec("echo hello");

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.command).toBe("echo hello");
    expect(result.stdout).toBe("hello\n");
    expect(result.exitCode).toBe(0);
  });

  test("propagates errors from ssh.exec", async () => {
    const { fake, client } = makeClient();
    fake.setDefaultResponse({
      stdout: "",
      stderr: "command not found",
      exitCode: 127,
    });

    const result = await client.exec("badcmd");

    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe("command not found");
  });
});

// --- Layer 2: tmux ---

describe("CodingClient tmux", () => {
  test("tmuxStart delegates to tmux.start with name and command", async () => {
    const { fake, client } = makeClient();

    await client.tmuxStart("dev", "npm run dev");

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.command).toContain("tmux new-session -d -s dev");
    expect(fake.calls[0]?.stdin).toBe("npm run dev");
  });

  test("tmuxRead delegates to tmux.read with name and optional lines", async () => {
    const { fake, client } = makeClient();
    fake.setDefaultResponse({
      stdout: "output line\n",
      stderr: "",
      exitCode: 0,
    });

    const output = await client.tmuxRead("dev", 50);

    expect(fake.calls[0]?.command).toContain(
      "tmux capture-pane -t dev -p -S -50",
    );
    expect(output).toBe("output line\n");
  });

  test("tmuxSend delegates to tmux.send with name and keys", async () => {
    const { fake, client } = makeClient();

    await client.tmuxSend("dev", "ls -la\n");

    expect(fake.calls[0]?.command).toContain("tmux load-buffer -");
    expect(fake.calls[0]?.command).toContain("tmux paste-buffer -t dev -d");
    expect(fake.calls[0]?.stdin).toBe("ls -la\n");
  });

  test("tmuxList delegates to tmux.list", async () => {
    const { fake, client } = makeClient();
    fake.onCommand("list-sessions", {
      stdout: "dev 1700000000\nstaging 1700001000\n",
      stderr: "",
      exitCode: 0,
    });

    const sessions = await client.tmuxList();

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.name).toBe("dev");
    expect(sessions[1]?.name).toBe("staging");
  });

  test("tmuxKill delegates to tmux.kill with name", async () => {
    const { fake, client } = makeClient();

    await client.tmuxKill("dev");

    expect(fake.calls[0]?.command).toContain("tmux kill-session -t dev");
  });
});

// --- Layer 3: acpx ---

describe("CodingClient acpx", () => {
  test("codingSubmit delegates to acpx.submit", async () => {
    const { fake, client } = makeClient();
    fake.setDefaultResponse({
      stdout: '{"sessionId":"s1"}\n',
      stderr: "",
      exitCode: 0,
    });

    const sessionId = await client.codingSubmit({
      cwd: "/home/user/repo",
      prompt: "fix tests",
    });

    expect(fake.calls[0]?.command).toContain("acpx --no-wait --format json");
    expect(fake.calls[0]?.stdin).toBe("fix tests");
    expect(sessionId).toBe("s1");
  });

  test("codingStatus delegates to acpx.status", async () => {
    const { fake, client } = makeClient();
    fake.setDefaultResponse({
      stdout: '{"status":"running"}',
      stderr: "",
      exitCode: 0,
    });

    const status = await client.codingStatus({ cwd: "/home/user/repo" });

    expect(fake.calls[0]?.command).toContain("acpx");
    expect(fake.calls[0]?.command).toContain("status");
    expect(status.status).toBe("running");
  });

  test("codingResult delegates to acpx.result", async () => {
    const { fake, client } = makeClient();
    fake.setDefaultResponse({
      stdout: "result output",
      stderr: "",
      exitCode: 0,
    });

    const result = await client.codingResult({ cwd: "/home/user/repo" });

    expect(fake.calls[0]?.command).toContain("sessions history --limit 1");
    expect(result).toBe("result output");
  });

  test("codingCancel delegates to acpx.cancel", async () => {
    const { fake, client } = makeClient();

    await client.codingCancel({ cwd: "/home/user/repo" });

    expect(fake.calls[0]?.command).toContain("cancel");
  });

  test("codingSessions delegates to acpx.sessions", async () => {
    const { fake, client } = makeClient();
    fake.setDefaultResponse({
      stdout: '[{"session_id":"s1","agent":"claude","status":"running"}]',
      stderr: "",
      exitCode: 0,
    });

    const sessions = await client.codingSessions();

    expect(fake.calls[0]?.command).toContain("sessions list");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe("s1");
  });

  test("clone delegates to acpx.clone", async () => {
    const { fake, client } = makeClient();
    fake.setDefaultResponse({
      stdout: "",
      stderr: "Cloning into 'my-repo'...\n",
      exitCode: 0,
    });

    const path = await client.clone("https://github.com/user/my-repo.git");

    expect(fake.calls[0]?.command).toContain("git clone");
    expect(path).toBe("my-repo");
  });
});

// --- Factory ---

describe("createCodingClient", () => {
  test("creates a CodingClient from config", () => {
    const client = createCodingClient({
      vmHost: "test-vm",
      sshUser: "test-user",
      defaultAgent: "claude",
      repos: {},
      pollIntervalSeconds: 15,
      taskTimeoutMinutes: 30,
    });

    expect(client).toBeInstanceOf(CodingClient);
  });
});
