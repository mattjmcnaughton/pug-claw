import type { SshExecutor, TmuxSession } from "./types.ts";
import { sanitizeName } from "./sanitize.ts";
import { logger } from "../logger.ts";
import { CodingTmuxDefaults } from "../constants.ts";

// --- Pure command builders ---

export function buildTmuxStartCommand(name: string): string {
  const safeName = sanitizeName(name);
  return `cmd=$(cat); tmux new-session -d -s ${safeName} -- sh -c "$cmd"`;
}

export function buildTmuxReadCommand(name: string, lines: number): string {
  const safeName = sanitizeName(name);
  if (!Number.isInteger(lines) || lines <= 0) {
    throw new Error(
      `Invalid lines count "${lines}": must be a positive integer`,
    );
  }
  return `tmux capture-pane -t ${safeName} -p -S -${lines}`;
}

export function buildTmuxSendCommand(name: string): string {
  const safeName = sanitizeName(name);
  return `tmux load-buffer - && tmux paste-buffer -t ${safeName} -d`;
}

export function buildTmuxListCommand(): string {
  return 'tmux list-sessions -F "#{session_name} #{session_activity}"';
}

export function buildTmuxKillCommand(name: string): string {
  const safeName = sanitizeName(name);
  return `tmux kill-session -t ${safeName}`;
}

// --- Pure parser ---

export function parseTmuxSessionsList(output: string): TmuxSession[] {
  const trimmed = output.trim();
  if (trimmed === "") {
    return [];
  }

  const sessions: TmuxSession[] = [];
  for (const line of trimmed.split("\n")) {
    const spaceIdx = line.indexOf(" ");
    if (spaceIdx === -1) {
      continue;
    }
    const name = line.slice(0, spaceIdx);
    const lastActivity = line.slice(spaceIdx + 1);
    sessions.push({ name, lastActivity });
  }
  return sessions;
}

// --- TmuxClient ---

export class TmuxClient {
  private readonly ssh: SshExecutor;

  constructor(ssh: SshExecutor) {
    this.ssh = ssh;
  }

  async start(name: string, command: string): Promise<void> {
    const remoteCmd = buildTmuxStartCommand(name);
    logger.debug({ name }, "tmux_start");

    const result = await this.ssh.exec(remoteCmd, { stdin: command });

    if (result.exitCode !== 0) {
      throw new Error(
        `tmux start failed for session "${name}": ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
      );
    }
  }

  async read(name: string, lines?: number): Promise<string> {
    const lineCount = lines ?? CodingTmuxDefaults.READ_LINES;
    const remoteCmd = buildTmuxReadCommand(name, lineCount);
    logger.debug({ name, lines: lineCount }, "tmux_read");

    const result = await this.ssh.exec(remoteCmd);

    if (result.exitCode !== 0) {
      throw new Error(
        `tmux read failed for session "${name}": ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
      );
    }

    return result.stdout;
  }

  async send(name: string, keys: string): Promise<void> {
    const remoteCmd = buildTmuxSendCommand(name);
    logger.debug({ name }, "tmux_send");

    const result = await this.ssh.exec(remoteCmd, { stdin: keys });

    if (result.exitCode !== 0) {
      throw new Error(
        `tmux send failed for session "${name}": ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
      );
    }
  }

  async list(): Promise<TmuxSession[]> {
    const remoteCmd = buildTmuxListCommand();
    logger.debug({}, "tmux_list");

    const result = await this.ssh.exec(remoteCmd);

    if (
      result.exitCode !== 0 &&
      (result.stderr.includes("no server running") ||
        result.stderr.includes("no sessions") ||
        result.stderr.includes("error connecting to"))
    ) {
      return [];
    }

    if (result.exitCode !== 0) {
      throw new Error(
        `tmux list failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
      );
    }

    return parseTmuxSessionsList(result.stdout);
  }

  async kill(name: string): Promise<void> {
    const remoteCmd = buildTmuxKillCommand(name);
    logger.debug({ name }, "tmux_kill");

    const result = await this.ssh.exec(remoteCmd);

    if (result.exitCode !== 0) {
      throw new Error(
        `tmux kill failed for session "${name}": ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
      );
    }
  }
}
