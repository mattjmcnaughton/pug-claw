import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import pino from "pino";
import { EnvVars, Frontends, type FrontendName, Paths } from "./constants.ts";

export type Logger = pino.Logger;

export function getLogDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

let _backing: Logger = pino({ level: "warn" }, pino.destination(2));

export const logger: Logger = new Proxy({} as Logger, {
  get(_target, prop, receiver) {
    return Reflect.get(_backing, prop, receiver);
  },
});

export function configureLogger(mode: FrontendName, logsDir: string): void {
  const systemLogDir = resolve(logsDir, Paths.SYSTEM_LOG_DIR);
  mkdirSync(systemLogDir, { recursive: true });

  const logFile = resolve(systemLogDir, `pug-claw-${getLogDateString()}.log`);
  const fileStream = pino.destination(logFile);
  const level = process.env[EnvVars.LOG_LEVEL] ?? "info";

  if (mode === Frontends.DISCORD) {
    const stdoutStream = pino.destination(1);
    _backing = pino(
      { level },
      pino.multistream([
        { stream: stdoutStream, level: level as pino.Level },
        { stream: fileStream, level: level as pino.Level },
      ]),
    );
  } else {
    _backing = pino({ level }, fileStream);
  }
}
