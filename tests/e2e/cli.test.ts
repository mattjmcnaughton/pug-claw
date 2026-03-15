import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const MAIN = resolve(PROJECT_ROOT, "src/main.ts");

// E2E tests spawn the actual CLI process.
// Some tests require external credentials and are skipped by default.
const hasDiscordToken = !!process.env.DISCORD_BOT_TOKEN;

describe("CLI e2e", () => {
  test("exits with error when DISCORD_BOT_TOKEN is missing", async () => {
    const proc = Bun.spawn(["bun", MAIN, "start"], {
      env: { ...process.env, DISCORD_BOT_TOKEN: "" },
      stderr: "pipe",
    });
    await proc.exited;
    expect(proc.exitCode).not.toBe(0);
  });

  test.skipIf(!hasDiscordToken)(
    "starts and connects with valid token",
    async () => {
      // This would test actual Discord connection — skipped without token.
      // Placeholder for when we add a --healthcheck or --dry-run flag.
    },
  );
});
