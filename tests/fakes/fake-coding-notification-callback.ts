import type { CodingNotification } from "../../src/coding/types.ts";

export class FakeCodingNotificationCallback {
  readonly notifications: CodingNotification[] = [];

  readonly callback = async (
    notification: CodingNotification,
  ): Promise<void> => {
    this.notifications.push(notification);
  };
}
