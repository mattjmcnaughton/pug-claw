import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export interface SshContainer {
  host: string;
  port: number;
  user: string;
  keyPath: string;
  /** Extra SSH options needed to connect to this container. */
  sshOptions: string[];
  cleanup: () => void;
}

const CONTAINER_NAME_PREFIX = "pug-claw-ssh-test";

const ACPX_API_KEY_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

/**
 * Check whether Docker is available and responsive.
 */
export function isDockerAvailable(): boolean {
  const proc = Bun.spawnSync(["docker", "ps"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exitCode === 0;
}

/**
 * Check whether at least one acpx API key is set in the environment.
 */
export function isAcpxAvailable(): boolean {
  return ACPX_API_KEY_VARS.some((key) => {
    const val = process.env[key];
    return val !== undefined && val.length > 0;
  });
}

export interface StartContainerOptions {
  /** Install acpx and forward API keys into the container. */
  withAcpx?: boolean | undefined;
}

/**
 * Start an Alpine container with openssh-server for integration testing.
 * Generates an ephemeral SSH key pair and injects the public key.
 * Returns connection details and a cleanup function.
 */
export async function startSshContainer(
  options?: StartContainerOptions,
): Promise<SshContainer> {
  const tmpDir = resolve(
    tmpdir(),
    `${CONTAINER_NAME_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  const keyPath = resolve(tmpDir, "test_key");
  const containerName = `${CONTAINER_NAME_PREFIX}-${Date.now()}`;

  // Generate ephemeral SSH key pair
  const keygen = Bun.spawnSync(
    ["ssh-keygen", "-t", "ed25519", "-f", keyPath, "-N", "", "-q"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (keygen.exitCode !== 0) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`ssh-keygen failed: ${keygen.stderr.toString()}`);
  }

  const pubKey = await Bun.file(`${keyPath}.pub`).text();

  const setupSteps = [
    "apk add --no-cache openssh-server tmux git nodejs npm",
    "ssh-keygen -A",
    "mkdir -p /root/.ssh",
    "chmod 700 /root/.ssh",
    `echo '${pubKey.trim()}' > /root/.ssh/authorized_keys`,
    "chmod 600 /root/.ssh/authorized_keys",
  ];

  if (options?.withAcpx) {
    setupSteps.push("npm install -g acpx@latest 2>/dev/null");
  }

  // SSHD must be last — it runs in the foreground
  setupSteps.push("/usr/sbin/sshd -D -e");

  // Build docker run args
  const dockerArgs = [
    "docker",
    "run",
    "-d",
    "--name",
    containerName,
    "-p",
    "0:22",
  ];

  // Forward API keys as env vars
  if (options?.withAcpx) {
    for (const key of ACPX_API_KEY_VARS) {
      const val = process.env[key];
      if (val !== undefined && val.length > 0) {
        dockerArgs.push("-e", `${key}=${val}`);
      }
    }
  }

  dockerArgs.push("alpine:3.20", "sh", "-c", setupSteps.join(" && "));

  // Start container with SSHD
  const run = Bun.spawnSync(dockerArgs, { stdout: "pipe", stderr: "pipe" });

  if (run.exitCode !== 0) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`docker run failed: ${run.stderr.toString()}`);
  }

  // Wait for SSHD to be ready
  await waitForSshd(containerName, keyPath);

  // Get the mapped port
  const portProc = Bun.spawnSync(["docker", "port", containerName, "22"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (portProc.exitCode !== 0) {
    cleanupContainer(containerName, tmpDir);
    throw new Error(`docker port failed: ${portProc.stderr.toString()}`);
  }

  const portOutput = portProc.stdout.toString().trim();
  const portStr = portOutput.split(":").pop();
  if (!portStr) {
    cleanupContainer(containerName, tmpDir);
    throw new Error(`Could not parse port from: ${portOutput}`);
  }
  const port = Number.parseInt(portStr, 10);

  return {
    host: "localhost",
    port,
    user: "root",
    keyPath,
    sshOptions: [
      "-i",
      keyPath,
      "-p",
      String(port),
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "StrictHostKeyChecking=no",
    ],
    cleanup: () => cleanupContainer(containerName, tmpDir),
  };
}

async function waitForSshd(
  containerName: string,
  keyPath: string,
  maxAttempts = 30,
): Promise<void> {
  // First wait for the container to be running and SSHD log to appear
  for (let i = 0; i < maxAttempts; i++) {
    const logs = Bun.spawnSync(["docker", "logs", containerName], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = logs.stdout.toString() + logs.stderr.toString();
    if (output.includes("Server listening on")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // If we get here, try connecting anyway — the log check may be flaky
  const portProc = Bun.spawnSync(["docker", "port", containerName, "22"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const portStr = portProc.stdout.toString().trim().split(":").pop();
  if (!portStr) return;

  const port = Number.parseInt(portStr, 10);
  for (let i = 0; i < 5; i++) {
    const ssh = Bun.spawnSync(
      [
        "ssh",
        "-i",
        keyPath,
        "-p",
        String(port),
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "ConnectTimeout=2",
        "-o",
        "BatchMode=yes",
        "root@localhost",
        "echo ready",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (ssh.exitCode === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function cleanupContainer(containerName: string, tmpDir: string): void {
  Bun.spawnSync(["docker", "rm", "-f", containerName], {
    stdout: "pipe",
    stderr: "pipe",
  });
  rmSync(tmpDir, { recursive: true, force: true });
}
