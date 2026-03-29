import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ProcessSshExecutor } from "../../src/coding/ssh.ts";
import { TmuxClient } from "../../src/coding/tmux.ts";
import {
  type SshContainer,
  isDockerAvailable,
  startSshContainer,
} from "../helpers/ssh-container.ts";

const SKIP = !isDockerAvailable();

let container: SshContainer;
let tmux: TmuxClient;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(SKIP)("TmuxClient integration", () => {
  beforeAll(async () => {
    container = await startSshContainer();
    const ssh = new ProcessSshExecutor(
      container.host,
      container.user,
      container.sshOptions,
    );
    tmux = new TmuxClient(ssh);
  }, 30_000);

  afterAll(() => {
    container?.cleanup();
  });

  test("list returns empty when no sessions exist", async () => {
    const sessions = await tmux.list();
    expect(sessions).toEqual([]);
  });

  test("start creates a session", async () => {
    await tmux.start("integ-test", "sleep 300");
    // Give tmux a moment to initialize
    await sleep(500);

    const sessions = await tmux.list();
    const found = sessions.find((s) => s.name === "integ-test");
    expect(found).toBeDefined();
  });

  test("read captures pane output", async () => {
    const output = await tmux.read("integ-test");
    // Output should be a string (may contain shell prompt or be mostly empty)
    expect(typeof output).toBe("string");
  });

  test("send injects text and read captures it", async () => {
    await tmux.send("integ-test", "echo hello-from-test\n");
    // Wait for the command to execute
    await sleep(1000);

    const output = await tmux.read("integ-test");
    expect(output).toContain("hello-from-test");
  });

  test("start a second session and list shows both", async () => {
    await tmux.start("integ-test-2", "sleep 300");
    await sleep(500);

    const sessions = await tmux.list();
    const names = sessions.map((s) => s.name);
    expect(names).toContain("integ-test");
    expect(names).toContain("integ-test-2");
  });

  test("kill removes a session", async () => {
    await tmux.kill("integ-test");

    const sessions = await tmux.list();
    const names = sessions.map((s) => s.name);
    expect(names).not.toContain("integ-test");
    expect(names).toContain("integ-test-2");
  });

  test("kill remaining session and list returns empty", async () => {
    await tmux.kill("integ-test-2");

    const sessions = await tmux.list();
    expect(sessions).toEqual([]);
  });

  test("read from nonexistent session throws", async () => {
    expect(tmux.read("nonexistent-session")).rejects.toThrow(
      "tmux read failed",
    );
  });

  test("kill nonexistent session throws", async () => {
    expect(tmux.kill("nonexistent-session")).rejects.toThrow(
      "tmux kill failed",
    );
  });
});
