import pino from "pino";

const transport =
  process.env.NODE_ENV === "production"
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true },
      };

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport,
});

export type Logger = typeof logger;
