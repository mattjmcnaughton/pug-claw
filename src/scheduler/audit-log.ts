import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Paths } from "../constants.ts";
import type { Logger } from "../logger.ts";
import { toError } from "../resources.ts";
import type { SchedulerAuditEvent } from "./types.ts";

function getDateString(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

export class SchedulerAuditLog {
  constructor(
    private logsDir: string,
    private logger: Logger,
  ) {}

  append(event: SchedulerAuditEvent): void {
    try {
      const schedulesDir = resolve(this.logsDir, Paths.SCHEDULES_LOG_DIR);
      mkdirSync(schedulesDir, { recursive: true });
      const logPath = resolve(schedulesDir, `${getDateString(event.ts)}.jsonl`);
      appendFileSync(logPath, `${JSON.stringify(event)}\n`);
    } catch (err) {
      this.logger.error(
        { err: toError(err) },
        "scheduler_audit_log_write_error",
      );
    }
  }
}
