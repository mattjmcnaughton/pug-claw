import { describe, expect, test } from "bun:test";
import { CodingTaskMonitor } from "../../src/coding/monitor.ts";
import type {
  CodingStatus,
  CodingTask,
  ResultFetcher,
  StatusPoller,
} from "../../src/coding/types.ts";
import { CodingTaskStatuses } from "../../src/coding/types.ts";
import { FakeCodingNotificationCallback } from "../fakes/fake-coding-notification-callback.ts";

// --- Test helpers ---

function makeTask(overrides?: Partial<CodingTask>): CodingTask {
  return {
    taskId: "coding_test-1",
    vmHost: "test-vm",
    sshUser: "test-user",
    cwd: "/home/test/repo",
    agent: "claude",
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeScriptedPoller(statuses: CodingStatus[]): StatusPoller {
  let index = 0;
  return async (_task: CodingTask): Promise<CodingStatus> => {
    const status = statuses[index];
    if (status === undefined) {
      throw new Error("StatusPoller exhausted: no more scripted statuses");
    }
    index++;
    return status;
  };
}

function makeScriptedResultFetcher(results: string[]): ResultFetcher {
  let index = 0;
  return async (_task: CodingTask): Promise<string> => {
    const result = results[index];
    if (result === undefined) {
      throw new Error("ResultFetcher exhausted");
    }
    index++;
    return result;
  };
}

function makeMonitor(options: {
  poller: StatusPoller;
  resultFetcher?: ResultFetcher;
  pollIntervalSeconds?: number;
  taskTimeoutMinutes?: number;
}) {
  const fakeCallback = new FakeCodingNotificationCallback();
  const monitor = new CodingTaskMonitor({
    statusPoller: options.poller,
    resultFetcher: options.resultFetcher ?? makeScriptedResultFetcher([""]),
    notificationCallback: fakeCallback.callback,
    pollIntervalSeconds: options.pollIntervalSeconds,
    taskTimeoutMinutes: options.taskTimeoutMinutes,
  });
  return { monitor, fakeCallback };
}

// --- Task management ---

describe("CodingTaskMonitor task management", () => {
  test("addTask stores a task retrievable via getTask", () => {
    const { monitor } = makeMonitor({
      poller: makeScriptedPoller([]),
    });
    const task = makeTask();

    monitor.addTask(task);

    expect(monitor.getTask("coding_test-1")).toEqual(task);
  });

  test("getTask returns undefined for unknown taskId", () => {
    const { monitor } = makeMonitor({
      poller: makeScriptedPoller([]),
    });

    expect(monitor.getTask("nonexistent")).toBeUndefined();
  });

  test("getActiveTasks returns all active tasks", () => {
    const { monitor } = makeMonitor({
      poller: makeScriptedPoller([]),
    });
    const task1 = makeTask({ taskId: "coding_1" });
    const task2 = makeTask({ taskId: "coding_2" });

    monitor.addTask(task1);
    monitor.addTask(task2);

    const tasks = monitor.getActiveTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.taskId).sort()).toEqual(["coding_1", "coding_2"]);
  });

  test("getActiveTasks returns empty array when no tasks", () => {
    const { monitor } = makeMonitor({
      poller: makeScriptedPoller([]),
    });

    expect(monitor.getActiveTasks()).toEqual([]);
  });

  test("removeTask removes task and returns true", () => {
    const { monitor } = makeMonitor({
      poller: makeScriptedPoller([]),
    });
    monitor.addTask(makeTask());

    const removed = monitor.removeTask("coding_test-1");

    expect(removed).toBe(true);
    expect(monitor.getTask("coding_test-1")).toBeUndefined();
    expect(monitor.getActiveTasks()).toEqual([]);
  });

  test("removeTask returns false for unknown taskId", () => {
    const { monitor } = makeMonitor({
      poller: makeScriptedPoller([]),
    });

    expect(monitor.removeTask("nonexistent")).toBe(false);
  });
});

// --- Tick: completion ---

describe("CodingTaskMonitor tick — completion", () => {
  test("calls statusPoller for each active task", async () => {
    const polledTasks: string[] = [];
    const poller: StatusPoller = async (task) => {
      polledTasks.push(task.taskId);
      return { status: CodingTaskStatuses.RUNNING };
    };
    const { monitor } = makeMonitor({ poller });

    monitor.addTask(makeTask({ taskId: "coding_1" }));
    monitor.addTask(makeTask({ taskId: "coding_2" }));
    await monitor.tick();

    expect(polledTasks.sort()).toEqual(["coding_1", "coding_2"]);
  });

  test("on completed: fetches result and calls callback with completed", async () => {
    const { monitor, fakeCallback } = makeMonitor({
      poller: makeScriptedPoller([{ status: CodingTaskStatuses.COMPLETED }]),
      resultFetcher: makeScriptedResultFetcher(["task output here"]),
    });
    monitor.addTask(makeTask());

    await monitor.tick();

    expect(fakeCallback.notifications).toHaveLength(1);
    expect(fakeCallback.notifications[0]?.status).toBe("completed");
    expect(fakeCallback.notifications[0]?.result).toBe("task output here");
    expect(fakeCallback.notifications[0]?.taskId).toBe("coding_test-1");
  });

  test("on completed: removes task from active map", async () => {
    const { monitor } = makeMonitor({
      poller: makeScriptedPoller([{ status: CodingTaskStatuses.COMPLETED }]),
      resultFetcher: makeScriptedResultFetcher(["result"]),
    });
    monitor.addTask(makeTask());

    await monitor.tick();

    expect(monitor.getActiveTasks()).toEqual([]);
    expect(monitor.getTask("coding_test-1")).toBeUndefined();
  });

  test("on completed: includes originChannel and originSession in notification", async () => {
    const { monitor, fakeCallback } = makeMonitor({
      poller: makeScriptedPoller([{ status: CodingTaskStatuses.COMPLETED }]),
      resultFetcher: makeScriptedResultFetcher(["result"]),
    });
    monitor.addTask(
      makeTask({
        originChannel: "general",
        originSession: "session-123",
      }),
    );

    await monitor.tick();

    expect(fakeCallback.notifications[0]?.originChannel).toBe("general");
    expect(fakeCallback.notifications[0]?.originSession).toBe("session-123");
  });

  test("on completed with result fetch failure: sends notification with fallback message", async () => {
    const failingFetcher: ResultFetcher = async () => {
      throw new Error("SSH timeout");
    };
    const { monitor, fakeCallback } = makeMonitor({
      poller: makeScriptedPoller([{ status: CodingTaskStatuses.COMPLETED }]),
      resultFetcher: failingFetcher,
    });
    monitor.addTask(makeTask());

    await monitor.tick();

    expect(fakeCallback.notifications).toHaveLength(1);
    expect(fakeCallback.notifications[0]?.status).toBe("completed");
    expect(fakeCallback.notifications[0]?.result).toBe("(result fetch failed)");
  });
});

// --- Tick: failure ---

describe("CodingTaskMonitor tick — failure", () => {
  test("on failed: calls callback with failed and error summary", async () => {
    const { monitor, fakeCallback } = makeMonitor({
      poller: makeScriptedPoller([
        { status: CodingTaskStatuses.FAILED, summary: "segfault in main.ts" },
      ]),
    });
    monitor.addTask(makeTask());

    await monitor.tick();

    expect(fakeCallback.notifications).toHaveLength(1);
    expect(fakeCallback.notifications[0]?.status).toBe("failed");
    expect(fakeCallback.notifications[0]?.error).toBe("segfault in main.ts");
  });

  test("on failed: removes task from active map", async () => {
    const { monitor } = makeMonitor({
      poller: makeScriptedPoller([{ status: CodingTaskStatuses.FAILED }]),
    });
    monitor.addTask(makeTask());

    await monitor.tick();

    expect(monitor.getActiveTasks()).toEqual([]);
  });

  test("on failed with no summary: uses default error message", async () => {
    const { monitor, fakeCallback } = makeMonitor({
      poller: makeScriptedPoller([{ status: CodingTaskStatuses.FAILED }]),
    });
    monitor.addTask(makeTask());

    await monitor.tick();

    expect(fakeCallback.notifications[0]?.error).toBe("Task failed");
  });
});

// --- Tick: cancelled ---

describe("CodingTaskMonitor tick — cancelled", () => {
  test("on cancelled: silently removes from active map without notification", async () => {
    const { monitor, fakeCallback } = makeMonitor({
      poller: makeScriptedPoller([{ status: CodingTaskStatuses.CANCELLED }]),
    });
    monitor.addTask(makeTask());

    await monitor.tick();

    expect(monitor.getActiveTasks()).toEqual([]);
    expect(fakeCallback.notifications).toEqual([]);
  });
});

// --- Tick: timeout ---

describe("CodingTaskMonitor tick — timeout", () => {
  test("running task within timeout threshold does not trigger warning", async () => {
    const { monitor, fakeCallback } = makeMonitor({
      poller: makeScriptedPoller([{ status: CodingTaskStatuses.RUNNING }]),
      taskTimeoutMinutes: 30,
    });
    // Task submitted just now — well within 30 min timeout
    monitor.addTask(makeTask());

    await monitor.tick();

    expect(fakeCallback.notifications).toEqual([]);
  });

  test("running task past timeout threshold triggers timeout_warning notification", async () => {
    const { monitor, fakeCallback } = makeMonitor({
      poller: makeScriptedPoller([{ status: CodingTaskStatuses.RUNNING }]),
      taskTimeoutMinutes: 30,
    });
    // Task submitted 31 minutes ago
    monitor.addTask(
      makeTask({
        submittedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
        originChannel: "general",
      }),
    );

    await monitor.tick();

    expect(fakeCallback.notifications).toHaveLength(1);
    expect(fakeCallback.notifications[0]?.status).toBe("timeout_warning");
    expect(fakeCallback.notifications[0]?.taskId).toBe("coding_test-1");
    expect(fakeCallback.notifications[0]?.originChannel).toBe("general");
  });

  test("timeout warning fires only once per task", async () => {
    let pollCount = 0;
    const poller: StatusPoller = async () => {
      pollCount++;
      return { status: CodingTaskStatuses.RUNNING };
    };
    const { monitor, fakeCallback } = makeMonitor({
      poller,
      taskTimeoutMinutes: 30,
    });
    monitor.addTask(
      makeTask({
        submittedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      }),
    );

    await monitor.tick();
    await monitor.tick();
    await monitor.tick();

    expect(pollCount).toBe(3);
    // Only one timeout warning despite 3 ticks
    expect(fakeCallback.notifications).toHaveLength(1);
    expect(fakeCallback.notifications[0]?.status).toBe("timeout_warning");
  });

  test("task that completes after timeout warning still gets completed notification", async () => {
    let pollIndex = 0;
    const statuses: CodingStatus[] = [
      { status: CodingTaskStatuses.RUNNING },
      { status: CodingTaskStatuses.COMPLETED },
    ];
    const poller: StatusPoller = async () => {
      const s = statuses[pollIndex];
      if (s === undefined) throw new Error("exhausted");
      pollIndex++;
      return s;
    };
    const { monitor, fakeCallback } = makeMonitor({
      poller,
      resultFetcher: makeScriptedResultFetcher(["final result"]),
      taskTimeoutMinutes: 30,
    });
    monitor.addTask(
      makeTask({
        submittedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      }),
    );

    // First tick: running + past timeout → timeout_warning
    await monitor.tick();
    expect(fakeCallback.notifications).toHaveLength(1);
    expect(fakeCallback.notifications[0]?.status).toBe("timeout_warning");

    // Second tick: completed → completed notification
    await monitor.tick();
    expect(fakeCallback.notifications).toHaveLength(2);
    expect(fakeCallback.notifications[1]?.status).toBe("completed");
    expect(fakeCallback.notifications[1]?.result).toBe("final result");
  });
});

// --- Tick: error handling ---

describe("CodingTaskMonitor tick — error handling", () => {
  test("transient poll failure does not remove task from active map", async () => {
    let callCount = 0;
    const poller: StatusPoller = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("SSH connection refused");
      }
      return { status: CodingTaskStatuses.RUNNING };
    };
    const { monitor } = makeMonitor({ poller });
    monitor.addTask(makeTask());

    // First tick: poll fails
    await monitor.tick();
    expect(monitor.getActiveTasks()).toHaveLength(1);

    // Second tick: poll succeeds, task still there
    await monitor.tick();
    expect(monitor.getActiveTasks()).toHaveLength(1);
  });

  test("multiple tasks are polled independently via Promise.allSettled", async () => {
    const pollResults = new Map<string, CodingStatus>();
    pollResults.set("coding_ok", { status: CodingTaskStatuses.COMPLETED });
    // coding_fail will throw during polling

    const poller: StatusPoller = async (task) => {
      if (task.taskId === "coding_fail") {
        throw new Error("SSH timeout");
      }
      const result = pollResults.get(task.taskId);
      if (result === undefined) throw new Error("unexpected task");
      return result;
    };

    const { monitor, fakeCallback } = makeMonitor({
      poller,
      resultFetcher: makeScriptedResultFetcher(["result for ok"]),
    });
    monitor.addTask(makeTask({ taskId: "coding_ok" }));
    monitor.addTask(makeTask({ taskId: "coding_fail" }));

    await monitor.tick();

    // coding_ok completed and removed
    expect(monitor.getTask("coding_ok")).toBeUndefined();
    expect(fakeCallback.notifications).toHaveLength(1);
    expect(fakeCallback.notifications[0]?.taskId).toBe("coding_ok");

    // coding_fail still active (poll error was non-fatal)
    expect(monitor.getTask("coding_fail")).toBeDefined();
  });
});

// --- Start/stop lifecycle ---

describe("CodingTaskMonitor lifecycle", () => {
  test("stop clears the interval", () => {
    const { monitor } = makeMonitor({
      poller: makeScriptedPoller([]),
    });

    monitor.start();
    // Should not throw
    monitor.stop();
    // Double stop should also not throw
    monitor.stop();
  });
});
