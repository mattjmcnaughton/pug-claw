import { CodingDefaults } from "../constants.ts";
import { logger } from "../logger.ts";
import { toError } from "../resources.ts";
import type {
  CodingNotificationCallback,
  CodingTask,
  ResultFetcher,
  StatusPoller,
} from "./types.ts";
import { CodingNotificationStatuses, CodingTaskStatuses } from "./types.ts";

interface CodingTaskMonitorOptions {
  statusPoller: StatusPoller;
  resultFetcher: ResultFetcher;
  notificationCallback: CodingNotificationCallback;
  pollIntervalSeconds?: number | undefined;
  taskTimeoutMinutes?: number | undefined;
}

export class CodingTaskMonitor {
  private readonly activeTasks = new Map<string, CodingTask>();
  private readonly timeoutWarned = new Set<string>();
  private interval: ReturnType<typeof setInterval> | undefined;
  private readonly pollIntervalMs: number;
  private readonly taskTimeoutMs: number;
  private readonly statusPoller: StatusPoller;
  private readonly resultFetcher: ResultFetcher;
  private readonly notificationCallback: CodingNotificationCallback;

  constructor(options: CodingTaskMonitorOptions) {
    this.statusPoller = options.statusPoller;
    this.resultFetcher = options.resultFetcher;
    this.notificationCallback = options.notificationCallback;
    this.pollIntervalMs =
      (options.pollIntervalSeconds ?? CodingDefaults.POLL_INTERVAL_SECONDS) *
      1000;
    this.taskTimeoutMs =
      (options.taskTimeoutMinutes ?? CodingDefaults.TASK_TIMEOUT_MINUTES) *
      60 *
      1000;
  }

  start(): void {
    this.interval = setInterval(() => {
      this.tick();
    }, this.pollIntervalMs);
    this.interval.unref?.();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  addTask(task: CodingTask): void {
    this.activeTasks.set(task.taskId, task);
  }

  removeTask(taskId: string): boolean {
    this.timeoutWarned.delete(taskId);
    return this.activeTasks.delete(taskId);
  }

  getTask(taskId: string): CodingTask | undefined {
    return this.activeTasks.get(taskId);
  }

  getActiveTasks(): CodingTask[] {
    return [...this.activeTasks.values()];
  }

  async tick(): Promise<void> {
    const tasks = [...this.activeTasks.values()];
    if (tasks.length === 0) return;

    const results = await Promise.allSettled(
      tasks.map((task) => this.pollTask(task)),
    );

    for (const [i, result] of results.entries()) {
      if (result.status === "rejected") {
        const task = tasks[i];
        logger.error(
          { err: toError(result.reason), taskId: task?.taskId },
          "coding_monitor_poll_error",
        );
      }
    }
  }

  private async pollTask(task: CodingTask): Promise<void> {
    let status: Awaited<ReturnType<StatusPoller>>;
    try {
      status = await this.statusPoller(task);
    } catch (err) {
      logger.warn(
        { err: toError(err), taskId: task.taskId },
        "coding_monitor_status_poll_failed",
      );
      return;
    }

    if (status.status === CodingTaskStatuses.COMPLETED) {
      let result: string | undefined;
      try {
        result = await this.resultFetcher(task);
      } catch (err) {
        logger.warn(
          { err: toError(err), taskId: task.taskId },
          "coding_monitor_result_fetch_failed",
        );
        result = "(result fetch failed)";
      }

      this.activeTasks.delete(task.taskId);
      this.timeoutWarned.delete(task.taskId);

      await this.notificationCallback({
        taskId: task.taskId,
        status: CodingNotificationStatuses.COMPLETED,
        result,
        originChannel: task.originChannel,
        originSession: task.originSession,
      });
      return;
    }

    if (status.status === CodingTaskStatuses.FAILED) {
      this.activeTasks.delete(task.taskId);
      this.timeoutWarned.delete(task.taskId);

      await this.notificationCallback({
        taskId: task.taskId,
        status: CodingNotificationStatuses.FAILED,
        error: status.summary ?? "Task failed",
        originChannel: task.originChannel,
        originSession: task.originSession,
      });
      return;
    }

    if (status.status === CodingTaskStatuses.CANCELLED) {
      this.activeTasks.delete(task.taskId);
      this.timeoutWarned.delete(task.taskId);
      return;
    }

    // Still running — check timeout
    if (!this.timeoutWarned.has(task.taskId)) {
      const elapsed = Date.now() - new Date(task.submittedAt).getTime();
      if (elapsed >= this.taskTimeoutMs) {
        this.timeoutWarned.add(task.taskId);

        await this.notificationCallback({
          taskId: task.taskId,
          status: CodingNotificationStatuses.TIMEOUT_WARNING,
          originChannel: task.originChannel,
          originSession: task.originSession,
        });
      }
    }
  }
}
