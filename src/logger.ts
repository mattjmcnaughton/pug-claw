import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import pino from "pino";
import { EnvVars, Paths } from "./constants.ts";

export type Logger = pino.Logger;

export function getLogDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Proxy-based logger that always delegates to the current backing instance.
// This ensures that modules importing `logger` at the top level always see
// the configured instance, even if they captured the reference before
// `configureLogger` was called.
let _backing: Logger = pino({ level: "warn" }, pino.destination(2));

export const logger: Logger = new Proxy({} as Logger, {
  get(_target, prop, receiver) {
    return Reflect.get(_backing, prop, receiver);
  },
});

export function configureLogger(
  mode: "discord" | "tui",
  homeDir: string,
): void {
  const logDir = resolve(homeDir, Paths.LOG_DIR);
  mkdirSync(logDir, { recursive: true });

  const logFile = resolve(logDir, `pug-claw-${getLogDateString()}.log`);
  const fileStream = pino.destination(logFile);
  const level = process.env[EnvVars.LOG_LEVEL] ?? "info";

  if (mode === "discord") {
    const stdoutStream = pino.destination(1);
    _backing = pino(
      { level },
      pino.multistream([
        { stream: stdoutStream, level: level as pino.Level },
        { stream: fileStream, level: level as pino.Level },
      ]),
    );
  } else {
    // TUI mode: file only (no stdout pollution)
    _backing = pino({ level }, fileStream);
  }
}
