import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import pino from "pino";

export type Logger = pino.Logger;

export function getLogDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Default logger: stderr at warn level (safe for TUI and CLI commands)
export let logger: Logger = pino({ level: "warn" }, pino.destination(2));

export function configureLogger(
  mode: "discord" | "tui",
  homeDir: string,
): void {
  const logDir = resolve(homeDir, "logs", "system");
  mkdirSync(logDir, { recursive: true });

  const logFile = resolve(logDir, `pug-claw-${getLogDateString()}.log`);
  const fileStream = pino.destination(logFile);
  const level = process.env.LOG_LEVEL ?? "info";

  if (mode === "discord") {
    const stdoutStream = pino.destination(1);
    logger = pino(
      { level },
      pino.multistream([
        { stream: stdoutStream, level: level as pino.Level },
        { stream: fileStream, level: level as pino.Level },
      ]),
    );
  } else {
    // TUI mode: file only (no stdout pollution)
    logger = pino({ level }, fileStream);
  }
}
