// --- Status constants ---

export const CodingTaskStatuses = {
  SUBMITTED: "submitted",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type CodingTaskStatus =
  (typeof CodingTaskStatuses)[keyof typeof CodingTaskStatuses];

export const CodingNotificationStatuses = {
  COMPLETED: "completed",
  FAILED: "failed",
  TIMEOUT_WARNING: "timeout_warning",
} as const;

export type CodingNotificationStatus =
  (typeof CodingNotificationStatuses)[keyof typeof CodingNotificationStatuses];

// --- Core interfaces ---

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SshExecOptions {
  stdin?: string | undefined;
}

export interface SshExecutor {
  exec(command: string, options?: SshExecOptions): Promise<ExecResult>;
}

export interface CodingConfig {
  vmHost: string;
  sshUser: string;
  defaultAgent: string;
  repos: Record<string, string>;
  pollIntervalSeconds: number;
  taskTimeoutMinutes: number;
}

export interface CodingTask {
  taskId: string;
  vmHost: string;
  sshUser: string;
  cwd: string;
  agent: string;
  sessionName?: string | undefined;
  originChannel?: string | undefined;
  originSession?: string | undefined;
  submittedAt: string;
}

export interface CodingStatus {
  status: CodingTaskStatus;
  summary?: string | undefined;
}

export interface CodingNotification {
  taskId: string;
  status: CodingNotificationStatus;
  result?: string | undefined;
  error?: string | undefined;
  originChannel?: string | undefined;
  originSession?: string | undefined;
}

export interface TmuxSession {
  name: string;
  lastActivity: string;
}

export interface CodingSubmitOptions {
  prompt: string;
  agent?: string | undefined;
  cwd: string;
  sessionName?: string | undefined;
}

export interface CodingSessionRef {
  cwd: string;
  agent?: string | undefined;
  sessionName?: string | undefined;
}

export interface CodingSessionInfo {
  sessionId: string;
  agent: string;
  status: string;
}

// --- Function types ---

export type CodingNotificationCallback = (
  notification: CodingNotification,
) => Promise<void>;

export type StatusPoller = (task: CodingTask) => Promise<CodingStatus>;

export type ResultFetcher = (task: CodingTask) => Promise<string>;
