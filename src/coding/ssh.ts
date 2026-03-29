import type { ExecResult, SshExecOptions, SshExecutor } from "./types.ts";
import { logger } from "../logger.ts";
import { toError } from "../resources.ts";

const SSH_DEFAULT_OPTIONS: readonly string[] = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=10",
  "-o",
  "StrictHostKeyChecking=accept-new",
];

export function buildSshCommand(
  host: string,
  user: string,
  command: string,
  extraOptions?: string[],
): string[] {
  return [
    "ssh",
    ...SSH_DEFAULT_OPTIONS,
    ...(extraOptions ?? []),
    `${user}@${host}`,
    command,
  ];
}

export class ProcessSshExecutor implements SshExecutor {
  private readonly host: string;
  private readonly user: string;
  private readonly sshOptions: string[];

  constructor(host: string, user: string, sshOptions?: string[]) {
    this.host = host;
    this.user = user;
    this.sshOptions = sshOptions ?? [];
  }

  async exec(command: string, options?: SshExecOptions): Promise<ExecResult> {
    const args = buildSshCommand(
      this.host,
      this.user,
      command,
      this.sshOptions,
    );

    logger.debug({ host: this.host, command }, "ssh_exec_start");

    try {
      const proc = Bun.spawn(args, {
        stdin:
          options?.stdin !== undefined ? new Blob([options.stdin]) : undefined,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;

      const exitCode = proc.exitCode ?? 1;

      logger.debug({ host: this.host, command, exitCode }, "ssh_exec_complete");

      return { stdout, stderr, exitCode };
    } catch (err) {
      const error = toError(err);
      logger.error({ err: error, host: this.host, command }, "ssh_exec_error");
      throw error;
    }
  }
}
