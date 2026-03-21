export type ScheduleTriggerSource = "cron" | "manual";

export type ScheduleRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "interrupted";

export type ScheduleExecutionStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted";

export type ScheduleDeliveryStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "not_applicable";

export interface ScheduleOutput {
  type: "discord_channel";
  channelId: string;
}

export interface ResolvedSchedule {
  name: string;
  description?: string;
  enabled: boolean;
  cron: string;
  agent: string;
  driver?: string;
  model?: string;
  prompt: string;
  output?: ScheduleOutput;
}

export interface ScheduleRunRecord {
  runId: string;
  scheduleName: string;
  triggerSource: ScheduleTriggerSource;
  status: ScheduleRunStatus;
  agent: string;
  driver?: string;
  model?: string;
  cronExpression: string;
  timezone: string;
  outputType?: string;
  outputTarget?: string;
  executionStatus?: ScheduleExecutionStatus;
  deliveryStatus: ScheduleDeliveryStatus;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
}

export interface SchedulerAuditEvent {
  ts: string;
  event:
    | "schedule_run_started"
    | "schedule_run_skipped_overlap"
    | "schedule_run_completed"
    | "schedule_run_failed"
    | "schedule_run_output"
    | "schedule_run_delivery_started"
    | "schedule_run_delivery_succeeded"
    | "schedule_run_delivery_failed"
    | "scheduler_lock_acquired"
    | "scheduler_lock_not_acquired"
    | "scheduler_lock_reclaimed_stale";
  run_id?: string;
  schedule_name?: string;
  trigger_source?: ScheduleTriggerSource;
  agent?: string;
  driver?: string;
  model?: string;
  cron_expression?: string;
  timezone?: string;
  output?: {
    type: string;
    channel_id?: string;
  } | null;
  status?: ScheduleRunStatus;
  delivery_status?: ScheduleDeliveryStatus;
  channel_id?: string;
  response_text?: string;
  message?: string;
  error?: string;
  pid?: number;
  hostname?: string;
}

export interface ScheduleSummary {
  schedule: ResolvedSchedule;
  nextRunAt: Date | null;
  currentlyRunning: boolean;
  lastRun?: ScheduleRunRecord;
}
