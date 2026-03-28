import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AcpxClient } from "../../src/coding/acpx.ts";
import { ProcessSshExecutor } from "../../src/coding/ssh.ts";
import {
  type SshContainer,
  isAcpxAvailable,
  isDockerAvailable,
  startSshContainer,
} from "../helpers/ssh-container.ts";

const SKIP_DOCKER = !isDockerAvailable();
const SKIP_ACPX = !isAcpxAvailable();

// --- Clone tests (Docker + git only, no API key needed) ---

let cloneContainer: SshContainer;
let cloneClient: AcpxClient;

describe.skipIf(SKIP_DOCKER)("AcpxClient clone integration", () => {
  beforeAll(async () => {
    cloneContainer = await startSshContainer();
    const ssh = new ProcessSshExecutor(
      cloneContainer.host,
      cloneContainer.user,
      cloneContainer.sshOptions,
    );
    cloneClient = new AcpxClient(ssh);
  }, 30_000);

  afterAll(() => {
    cloneContainer?.cleanup();
  });

  test("clones a public HTTPS repo", async () => {
    const path = await cloneClient.clone(
      "https://github.com/octocat/Hello-World.git",
    );
    expect(path).toBe("Hello-World");
  }, 30_000);

  test("clone to a specific path", async () => {
    const path = await cloneClient.clone(
      "https://github.com/octocat/Hello-World.git",
      "/tmp/my-clone",
    );
    expect(path).toBe("/tmp/my-clone");
  }, 30_000);

  test("clone nonexistent repo throws", async () => {
    expect(
      cloneClient.clone(
        "https://github.com/octocat/nonexistent-repo-12345.git",
      ),
    ).rejects.toThrow("git clone failed");
  }, 30_000);
});

// --- acpx tests (Docker + acpx + API keys) ---

let acpxContainer: SshContainer;
let acpxClient: AcpxClient;

describe.skipIf(SKIP_DOCKER || SKIP_ACPX)("AcpxClient acpx integration", () => {
  beforeAll(async () => {
    acpxContainer = await startSshContainer({ withAcpx: true });
    const ssh = new ProcessSshExecutor(
      acpxContainer.host,
      acpxContainer.user,
      acpxContainer.sshOptions,
    );
    acpxClient = new AcpxClient(ssh);

    // Clone a repo to use as cwd for acpx commands
    await acpxClient.clone(
      "https://github.com/octocat/Hello-World.git",
      "/root/test-repo",
    );
  }, 120_000);

  afterAll(() => {
    acpxContainer?.cleanup();
  });

  test("submit returns a session ID", async () => {
    const sessionId = await acpxClient.submit({
      cwd: "/root/test-repo",
      prompt: "Create a file called hello.txt with the text 'hello world'",
    });
    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);
  }, 60_000);

  test("status returns a valid status", async () => {
    const status = await acpxClient.status({ cwd: "/root/test-repo" });
    expect(status.status).toBeDefined();
    expect(typeof status.status).toBe("string");
  }, 30_000);

  test("sessions lists sessions", async () => {
    const sessions = await acpxClient.sessions();
    expect(Array.isArray(sessions)).toBe(true);
  }, 30_000);
});
