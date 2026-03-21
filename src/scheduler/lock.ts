import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { VERSION } from "../constants.ts";
import type { Logger } from "../logger.ts";
import { toError } from "../resources.ts";
import { SchedulerAuditEvents, type SchedulerAuditEvent } from "./types.ts";

interface LockOwner {
  pid: number;
  started_at: string;
  hostname: string;
  version: string;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const error = toError(err) as NodeJS.ErrnoException;
    if (error.code === "EPERM") {
      return true;
    }
    if (error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

export interface SchedulerLockAcquireResult {
  acquired: boolean;
  reclaimedStale: boolean;
  owner?: LockOwner;
}

export class SchedulerLock {
  private held = false;
  private hostname = hostname();

  constructor(
    private lockDir: string,
    private ownerFilePath: string,
    private logger: Logger,
    private onAuditEvent: (event: SchedulerAuditEvent) => void,
  ) {}

  acquire(): SchedulerLockAcquireResult {
    const owner: LockOwner = {
      pid: process.pid,
      started_at: new Date().toISOString(),
      hostname: this.hostname,
      version: VERSION,
    };

    mkdirSync(dirname(this.lockDir), { recursive: true });

    try {
      mkdirSync(this.lockDir, { recursive: false });
      writeFileSync(this.ownerFilePath, `${JSON.stringify(owner, null, 2)}\n`);
      this.held = true;
      this.onAuditEvent({
        ts: new Date().toISOString(),
        event: SchedulerAuditEvents.SCHEDULER_LOCK_ACQUIRED,
        pid: owner.pid,
        hostname: owner.hostname,
        message: "Scheduler lock acquired.",
      });
      return { acquired: true, reclaimedStale: false, owner };
    } catch (err) {
      const error = toError(err) as NodeJS.ErrnoException;
      if (error.code !== "EEXIST") {
        throw error;
      }
    }

    const existingOwner = this.readOwner();
    const reclaimable =
      existingOwner === null ||
      (existingOwner.hostname === this.hostname &&
        !isPidAlive(existingOwner.pid));

    if (!reclaimable) {
      this.onAuditEvent({
        ts: new Date().toISOString(),
        event: SchedulerAuditEvents.SCHEDULER_LOCK_NOT_ACQUIRED,
        pid: existingOwner?.pid,
        hostname: existingOwner?.hostname,
        message: "Scheduler lock not acquired.",
      });
      return {
        acquired: false,
        reclaimedStale: false,
        owner: existingOwner ?? undefined,
      };
    }

    try {
      if (existsSync(this.lockDir)) {
        rmSync(this.lockDir, { recursive: true, force: true });
      }
      mkdirSync(this.lockDir, { recursive: false });
      writeFileSync(this.ownerFilePath, `${JSON.stringify(owner, null, 2)}\n`);
      this.held = true;
      this.onAuditEvent({
        ts: new Date().toISOString(),
        event: SchedulerAuditEvents.SCHEDULER_LOCK_RECLAIMED_STALE,
        pid: owner.pid,
        hostname: owner.hostname,
        message: "Scheduler lock reclaimed.",
      });
      return { acquired: true, reclaimedStale: true, owner };
    } catch (err) {
      const reclaimError = toError(err);
      this.logger.warn({ err: reclaimError }, "scheduler_lock_reclaim_failed");
      this.onAuditEvent({
        ts: new Date().toISOString(),
        event: SchedulerAuditEvents.SCHEDULER_LOCK_NOT_ACQUIRED,
        pid: existingOwner?.pid,
        hostname: existingOwner?.hostname,
        message: "Scheduler lock not acquired after reclaim attempt.",
        error: reclaimError.message,
      });
      return {
        acquired: false,
        reclaimedStale: false,
        owner: existingOwner ?? undefined,
      };
    }
  }

  release(): void {
    if (!this.held) {
      return;
    }

    try {
      rmSync(this.lockDir, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn({ err: toError(err) }, "scheduler_lock_release_failed");
    }

    this.held = false;
  }

  private readOwner(): LockOwner | null {
    try {
      const raw = readFileSync(resolve(this.ownerFilePath), "utf-8");
      const parsed = JSON.parse(raw) as Partial<LockOwner>;
      if (
        typeof parsed.pid !== "number" ||
        typeof parsed.started_at !== "string" ||
        typeof parsed.hostname !== "string"
      ) {
        return null;
      }
      return {
        pid: parsed.pid,
        started_at: parsed.started_at,
        hostname: parsed.hostname,
        version: typeof parsed.version === "string" ? parsed.version : VERSION,
      };
    } catch {
      return null;
    }
  }
}
