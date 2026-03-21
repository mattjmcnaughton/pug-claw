export const ScheduleTriggerSources = {
  CRON: "cron",
  MANUAL: "manual",
} as const;

export type ScheduleTriggerSource =
  (typeof ScheduleTriggerSources)[keyof typeof ScheduleTriggerSources];

export const ScheduleRunStatuses = {
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SKIPPED: "skipped",
  INTERRUPTED: "interrupted",
} as const;

export type ScheduleRunStatus =
  (typeof ScheduleRunStatuses)[keyof typeof ScheduleRunStatuses];

export const ScheduleExecutionStatuses = {
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
} as const;

export type ScheduleExecutionStatus =
  (typeof ScheduleExecutionStatuses)[keyof typeof ScheduleExecutionStatuses];

export const ScheduleDeliveryStatuses = {
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  NOT_APPLICABLE: "not_applicable",
} as const;

export type ScheduleDeliveryStatus =
  (typeof ScheduleDeliveryStatuses)[keyof typeof ScheduleDeliveryStatuses];

export const ScheduleOutputTypes = {
  DISCORD_CHANNEL: "discord_channel",
} as const;

export type ScheduleOutputType =
  (typeof ScheduleOutputTypes)[keyof typeof ScheduleOutputTypes];

export const SchedulerAuditEvents = {
  SCHEDULE_RUN_STARTED: "schedule_run_started",
  SCHEDULE_RUN_SKIPPED_OVERLAP: "schedule_run_skipped_overlap",
  SCHEDULE_RUN_COMPLETED: "schedule_run_completed",
  SCHEDULE_RUN_FAILED: "schedule_run_failed",
  SCHEDULE_RUN_OUTPUT: "schedule_run_output",
  SCHEDULE_RUN_DELIVERY_STARTED: "schedule_run_delivery_started",
  SCHEDULE_RUN_DELIVERY_SUCCEEDED: "schedule_run_delivery_succeeded",
  SCHEDULE_RUN_DELIVERY_FAILED: "schedule_run_delivery_failed",
  SCHEDULER_LOCK_ACQUIRED: "scheduler_lock_acquired",
  SCHEDULER_LOCK_NOT_ACQUIRED: "scheduler_lock_not_acquired",
  SCHEDULER_LOCK_RECLAIMED_STALE: "scheduler_lock_reclaimed_stale",
} as const;

export type SchedulerAuditEventName =
  (typeof SchedulerAuditEvents)[keyof typeof SchedulerAuditEvents];

export interface ScheduleOutput {
  type: ScheduleOutputType;
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
  outputType?: ScheduleOutputType;
  outputTarget?: string;
  executionStatus?: ScheduleExecutionStatus;
  deliveryStatus: ScheduleDeliveryStatus;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
}

export interface SchedulerAuditEvent {
  ts: string;
  event: SchedulerAuditEventName;
  run_id?: string;
  schedule_name?: string;
  trigger_source?: ScheduleTriggerSource;
  agent?: string;
  driver?: string;
  model?: string;
  cron_expression?: string;
  timezone?: string;
  output?: {
    type: ScheduleOutputType;
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
