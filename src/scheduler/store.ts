import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { Logger } from "../logger.ts";
import {
  ScheduleExecutionStatuses,
  type ScheduleDeliveryStatus,
  type ScheduleExecutionStatus,
  type ScheduleOutputType,
  type ScheduleRunRecord,
  ScheduleRunStatuses,
  type ScheduleRunStatus,
  type ScheduleTriggerSource,
} from "./types.ts";

interface ScheduleRunRow {
  run_id: string;
  schedule_name: string;
  trigger_source: ScheduleTriggerSource;
  status: ScheduleRunStatus;
  agent: string;
  driver: string | null;
  model: string | null;
  cron_expression: string;
  timezone: string;
  output_type: ScheduleOutputType | null;
  output_target: string | null;
  execution_status: ScheduleExecutionStatus | null;
  delivery_status: ScheduleDeliveryStatus;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

function rowToRecord(row: ScheduleRunRow): ScheduleRunRecord {
  return {
    runId: row.run_id,
    scheduleName: row.schedule_name,
    triggerSource: row.trigger_source,
    status: row.status,
    agent: row.agent,
    driver: row.driver ?? undefined,
    model: row.model ?? undefined,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    outputType: row.output_type ?? undefined,
    outputTarget: row.output_target ?? undefined,
    executionStatus: row.execution_status ?? undefined,
    deliveryStatus: row.delivery_status,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

export class SchedulerStore {
  private db: Database;

  constructor(
    dbPath: string,
    private logger: Logger,
  ) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
  }

  init(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA foreign_keys = ON;");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedule_runs (
        run_id TEXT PRIMARY KEY,
        schedule_name TEXT NOT NULL,
        trigger_source TEXT NOT NULL,
        status TEXT NOT NULL,
        agent TEXT NOT NULL,
        driver TEXT,
        model TEXT,
        cron_expression TEXT NOT NULL,
        timezone TEXT NOT NULL,
        output_type TEXT,
        output_target TEXT,
        execution_status TEXT,
        delivery_status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_started_at
        ON schedule_runs(schedule_name, started_at DESC);

      CREATE INDEX IF NOT EXISTS idx_schedule_runs_status_started_at
        ON schedule_runs(status, started_at DESC);
    `);
  }

  close(): void {
    this.db.close();
  }

  insertRun(record: ScheduleRunRecord): void {
    this.db
      .query(
        `
          INSERT INTO schedule_runs (
            run_id,
            schedule_name,
            trigger_source,
            status,
            agent,
            driver,
            model,
            cron_expression,
            timezone,
            output_type,
            output_target,
            execution_status,
            delivery_status,
            started_at,
            finished_at,
            error_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        record.runId,
        record.scheduleName,
        record.triggerSource,
        record.status,
        record.agent,
        record.driver ?? null,
        record.model ?? null,
        record.cronExpression,
        record.timezone,
        record.outputType ?? null,
        record.outputTarget ?? null,
        record.executionStatus ?? null,
        record.deliveryStatus,
        record.startedAt,
        record.finishedAt ?? null,
        record.errorMessage ?? null,
      );
  }

  updateRun(
    runId: string,
    patch: Partial<
      Pick<
        ScheduleRunRecord,
        | "status"
        | "executionStatus"
        | "deliveryStatus"
        | "finishedAt"
        | "errorMessage"
      >
    >,
  ): void {
    const current = this.getRun(runId);
    if (!current) {
      this.logger.warn({ run_id: runId }, "scheduler_run_update_missing");
      return;
    }

    this.db
      .query(
        `
          UPDATE schedule_runs
          SET status = ?,
              execution_status = ?,
              delivery_status = ?,
              finished_at = ?,
              error_message = ?
          WHERE run_id = ?
        `,
      )
      .run(
        patch.status ?? current.status,
        patch.executionStatus ?? current.executionStatus ?? null,
        patch.deliveryStatus ?? current.deliveryStatus,
        patch.finishedAt ?? current.finishedAt ?? null,
        patch.errorMessage ?? current.errorMessage ?? null,
        runId,
      );
  }

  getRun(runId: string): ScheduleRunRecord | null {
    const row = this.db
      .query("SELECT * FROM schedule_runs WHERE run_id = ? LIMIT 1")
      .get(runId) as ScheduleRunRow | null;
    return row ? rowToRecord(row) : null;
  }

  getLatestRunsBySchedule(): Map<string, ScheduleRunRecord> {
    const rows = this.db
      .query("SELECT * FROM schedule_runs ORDER BY started_at DESC")
      .all() as ScheduleRunRow[];

    const latest = new Map<string, ScheduleRunRecord>();
    for (const row of rows) {
      if (!latest.has(row.schedule_name)) {
        latest.set(row.schedule_name, rowToRecord(row));
      }
    }
    return latest;
  }

  markRunningRunsInterrupted(nowIso: string): number {
    const result = this.db
      .query(
        `
          UPDATE schedule_runs
          SET status = '${ScheduleRunStatuses.INTERRUPTED}',
              execution_status = '${ScheduleExecutionStatuses.INTERRUPTED}',
              finished_at = ?,
              error_message = COALESCE(error_message, 'Process exited before run completed.')
          WHERE status = '${ScheduleRunStatuses.RUNNING}'
        `,
      )
      .run(nowIso) as { changes?: number };

    return result.changes ?? 0;
  }
}
