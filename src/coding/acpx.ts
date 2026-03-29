import { randomUUID } from "node:crypto";
import type {
  CodingSessionInfo,
  CodingSessionRef,
  CodingStatus,
  CodingSubmitOptions,
  CodingTaskStatus,
  SshExecutor,
} from "./types.ts";
import { CodingTaskStatuses } from "./types.ts";
import { sanitizeName, sanitizePath, validateGitUrl } from "./sanitize.ts";
import { CodingDefaults } from "../constants.ts";
import { logger } from "../logger.ts";

// --- Pure command builders ---

export function buildAcpxSubmitCommand(
  agent: string,
  cwd: string,
  sessionName?: string,
): string {
  const safeAgent = sanitizeName(agent);
  const safeCwd = sanitizePath(cwd);
  const sessionPart =
    sessionName !== undefined ? ` --session ${sanitizeName(sessionName)}` : "";
  return `cd ${safeCwd} && acpx --no-wait --format json${sessionPart} ${safeAgent}`;
}

export function buildAcpxStatusCommand(
  agent: string,
  cwd: string,
  sessionName?: string,
): string {
  const safeAgent = sanitizeName(agent);
  const safeCwd = sanitizePath(cwd);
  const sessionPart =
    sessionName !== undefined ? ` --session ${sanitizeName(sessionName)}` : "";
  return `cd ${safeCwd} && acpx${sessionPart} ${safeAgent} status`;
}

export function buildAcpxResultCommand(
  agent: string,
  cwd: string,
  sessionName?: string,
): string {
  const safeAgent = sanitizeName(agent);
  const safeCwd = sanitizePath(cwd);
  const sessionPart =
    sessionName !== undefined ? ` --session ${sanitizeName(sessionName)}` : "";
  return `cd ${safeCwd} && acpx${sessionPart} ${safeAgent} sessions history --limit 1`;
}

export function buildAcpxCancelCommand(
  agent: string,
  cwd: string,
  sessionName?: string,
): string {
  const safeAgent = sanitizeName(agent);
  const safeCwd = sanitizePath(cwd);
  const sessionPart =
    sessionName !== undefined ? ` --session ${sanitizeName(sessionName)}` : "";
  return `cd ${safeCwd} && acpx${sessionPart} ${safeAgent} cancel`;
}

export function buildAcpxSessionsCommand(agent: string): string {
  const safeAgent = sanitizeName(agent);
  return `acpx ${safeAgent} sessions list`;
}

export function buildCloneCommand(url: string, path?: string): string {
  const safeUrl = validateGitUrl(url);
  if (path !== undefined) {
    const safePath = sanitizePath(path);
    return `git clone ${safeUrl} ${safePath}`;
  }
  return `git clone ${safeUrl}`;
}

// --- Pure parsers ---

export function parseAcpxSubmitResponse(output: string): string {
  const trimmed = output.trim();
  if (trimmed === "") {
    throw new Error("acpx submit returned empty output");
  }

  // Try NDJSON — look for sessionId in any line
  for (const line of trimmed.split("\n")) {
    const stripped = line.trim();
    if (stripped === "") continue;
    try {
      const parsed = JSON.parse(stripped) as Record<string, unknown>;
      const sessionId = parsed.sessionId ?? parsed.session_id ?? parsed.id;
      if (typeof sessionId === "string" && sessionId.length > 0) {
        return sessionId;
      }
    } catch {
      // Not JSON — continue
    }
  }

  // Fallback: return the first non-empty line as identifier
  const firstLine = trimmed.split("\n")[0]?.trim();
  if (firstLine !== undefined && firstLine.length > 0) {
    return firstLine;
  }

  throw new Error("Could not parse session ID from acpx submit output");
}

function mapAcpxStatus(raw: string): CodingTaskStatus {
  const lower = raw.toLowerCase();
  switch (lower) {
    case "running":
    case "busy":
      return CodingTaskStatuses.RUNNING;
    case "failed":
    case "error":
    case "dead":
      return CodingTaskStatuses.FAILED;
    case "cancelled":
    case "canceled":
      return CodingTaskStatuses.CANCELLED;
    case "idle":
    case "completed":
    case "done":
      return CodingTaskStatuses.COMPLETED;
    default:
      return CodingTaskStatuses.COMPLETED;
  }
}

export function parseAcpxStatus(output: string): CodingStatus {
  const trimmed = output.trim();
  if (trimmed === "") {
    return { status: CodingTaskStatuses.COMPLETED };
  }

  // Try JSON
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const rawStatus =
      typeof parsed.status === "string" ? parsed.status : undefined;
    const summary =
      typeof parsed.summary === "string" ? parsed.summary : undefined;
    if (rawStatus !== undefined) {
      return { status: mapAcpxStatus(rawStatus), summary };
    }
  } catch {
    // Not JSON — fall through
  }

  // Keyword matching on raw text
  const lower = trimmed.toLowerCase();
  if (lower.includes("running") || lower.includes("busy")) {
    return { status: CodingTaskStatuses.RUNNING, summary: trimmed };
  }
  if (
    lower.includes("failed") ||
    lower.includes("error") ||
    lower.includes("dead")
  ) {
    return { status: CodingTaskStatuses.FAILED, summary: trimmed };
  }
  if (lower.includes("cancelled") || lower.includes("canceled")) {
    return { status: CodingTaskStatuses.CANCELLED, summary: trimmed };
  }

  return { status: CodingTaskStatuses.COMPLETED, summary: trimmed };
}

export function parseAcpxSessionsList(output: string): CodingSessionInfo[] {
  const trimmed = output.trim();
  if (trimmed === "") {
    return [];
  }

  // Try JSON array
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (item): item is Record<string, unknown> =>
            item !== null && typeof item === "object",
        )
        .map((item) => ({
          sessionId: String(item.session_id ?? item.sessionId ?? item.id ?? ""),
          agent: String(item.agent ?? ""),
          status: String(item.status ?? ""),
        }))
        .filter((s) => s.sessionId.length > 0);
    }
  } catch {
    // Not JSON — fall through
  }

  // Line-based fallback: "SESSION_ID AGENT STATUS"
  const sessions: CodingSessionInfo[] = [];
  for (const line of trimmed.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3) {
      sessions.push({
        sessionId: parts[0] as string,
        agent: parts[1] as string,
        status: parts[2] as string,
      });
    }
  }
  return sessions;
}

export function parseCloneOutput(output: string, url: string): string {
  // git clone outputs "Cloning into 'path'..." to stderr
  const match = output.match(/Cloning into '([^']+)'/);
  if (match?.[1] !== undefined) {
    return match[1];
  }

  // Derive from URL: strip .git, take last segment after / or :
  const urlPath = url.replace(/\.git$/, "");
  const lastSlash = urlPath.lastIndexOf("/");
  const colon = urlPath.lastIndexOf(":");
  const separatorIdx = Math.max(lastSlash, colon);
  if (separatorIdx >= 0 && separatorIdx < urlPath.length - 1) {
    return urlPath.slice(separatorIdx + 1);
  }

  return url;
}

// --- Utility ---

export function generateTaskId(): string {
  return `coding_${randomUUID()}`;
}

// --- AcpxClient ---

export class AcpxClient {
  private readonly ssh: SshExecutor;

  constructor(ssh: SshExecutor) {
    this.ssh = ssh;
  }

  async submit(options: CodingSubmitOptions): Promise<string> {
    const agent = options.agent ?? CodingDefaults.AGENT;
    const remoteCmd = buildAcpxSubmitCommand(
      agent,
      options.cwd,
      options.sessionName,
    );
    logger.debug({ agent, cwd: options.cwd }, "acpx_submit");

    const result = await this.ssh.exec(remoteCmd, { stdin: options.prompt });

    if (result.exitCode !== 0) {
      throw new Error(
        `acpx submit failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
      );
    }

    return parseAcpxSubmitResponse(result.stdout);
  }

  async status(ref: CodingSessionRef): Promise<CodingStatus> {
    const agent = ref.agent ?? CodingDefaults.AGENT;
    const remoteCmd = buildAcpxStatusCommand(agent, ref.cwd, ref.sessionName);
    logger.debug({ agent, cwd: ref.cwd }, "acpx_status");

    const result = await this.ssh.exec(remoteCmd);

    if (result.exitCode !== 0) {
      throw new Error(
        `acpx status failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
      );
    }

    return parseAcpxStatus(result.stdout);
  }

  async result(ref: CodingSessionRef): Promise<string> {
    const agent = ref.agent ?? CodingDefaults.AGENT;
    const remoteCmd = buildAcpxResultCommand(agent, ref.cwd, ref.sessionName);
    logger.debug({ agent, cwd: ref.cwd }, "acpx_result");

    const result = await this.ssh.exec(remoteCmd);

    if (result.exitCode !== 0) {
      throw new Error(
        `acpx result failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
      );
    }

    return result.stdout;
  }

  async cancel(ref: CodingSessionRef): Promise<void> {
    const agent = ref.agent ?? CodingDefaults.AGENT;
    const remoteCmd = buildAcpxCancelCommand(agent, ref.cwd, ref.sessionName);
    logger.debug({ agent, cwd: ref.cwd }, "acpx_cancel");

    const result = await this.ssh.exec(remoteCmd);

    if (result.exitCode !== 0) {
      throw new Error(
        `acpx cancel failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
      );
    }
  }

  async sessions(agent?: string): Promise<CodingSessionInfo[]> {
    const resolvedAgent = agent ?? CodingDefaults.AGENT;
    const remoteCmd = buildAcpxSessionsCommand(resolvedAgent);
    logger.debug({ agent: resolvedAgent }, "acpx_sessions");

    const result = await this.ssh.exec(remoteCmd);

    if (result.exitCode !== 0) {
      throw new Error(
        `acpx sessions failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
      );
    }

    return parseAcpxSessionsList(result.stdout);
  }

  async clone(url: string, path?: string): Promise<string> {
    const remoteCmd = buildCloneCommand(url, path);
    logger.debug({ url, path }, "acpx_clone");

    const result = await this.ssh.exec(remoteCmd);

    if (result.exitCode !== 0) {
      throw new Error(
        `git clone failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
      );
    }

    // git clone prints "Cloning into..." on stderr
    return parseCloneOutput(result.stderr + result.stdout, url);
  }
}
