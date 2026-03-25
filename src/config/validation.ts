import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Cron } from "croner";
import { Defaults, Drivers, Paths } from "../constants.ts";
import { expandTilde, type ResolvedConfigPaths } from "./paths.ts";
import type { ConfigFile, ResolvedScheduleConfig } from "./schema.ts";

type ToErrorFn = (err: unknown) => Error;

function validateTimezone(timezone: string, toError: ToErrorFn): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch (err) {
    throw new Error(
      `Invalid scheduler timezone "${timezone}": ${toError(err).message}`,
    );
  }
}

function validateCronExpression(
  cronExpression: string,
  timezone: string,
  toError: ToErrorFn,
): void {
  try {
    new Cron(cronExpression, {
      paused: true,
      timezone,
      mode: "5-part",
    });
  } catch (err) {
    throw new Error(
      `Invalid cron expression "${cronExpression}": ${toError(err).message}`,
    );
  }
}

function isKnownDriverName(driverName: string): boolean {
  return Object.values(Drivers).includes(
    driverName as (typeof Drivers)[keyof typeof Drivers],
  );
}

export function validateConfigSemantics(
  rawConfig: ConfigFile,
  homeDir: string,
  paths: ResolvedConfigPaths,
  toError: ToErrorFn,
): void {
  const defaultDriver = rawConfig.default_driver ?? Defaults.DRIVER;
  if (!isKnownDriverName(defaultDriver)) {
    throw new Error(`Unknown default driver: ${defaultDriver}`);
  }

  const timezone = rawConfig.scheduler?.timezone;
  if (timezone) {
    validateTimezone(timezone, toError);
  }

  for (const [channelId, channel] of Object.entries(rawConfig.channels ?? {})) {
    if (channel.driver && !isKnownDriverName(channel.driver)) {
      throw new Error(
        `Channel "${channelId}" references unknown driver "${channel.driver}"`,
      );
    }
  }

  for (const [name, schedule] of Object.entries(rawConfig.schedules ?? {})) {
    if (!timezone) {
      throw new Error(
        `scheduler.timezone is required when schedules are configured (missing for schedule "${name}")`,
      );
    }

    validateCronExpression(schedule.cron, timezone, toError);

    const agentSystemPath = resolve(paths.agentsDir, schedule.agent, Paths.SYSTEM_MD);
    if (!existsSync(agentSystemPath)) {
      throw new Error(
        `Schedule "${name}" references unknown agent "${schedule.agent}" at ${agentSystemPath}`,
      );
    }

    const driverName = schedule.driver ?? defaultDriver;
    if (!isKnownDriverName(driverName)) {
      throw new Error(
        `Schedule "${name}" references unknown driver "${driverName}"`,
      );
    }
  }

  const dotenvPath = rawConfig.secrets?.dotenv_path;
  if (dotenvPath) {
    const expanded = expandTilde(dotenvPath);
    if (!expanded.startsWith("/")) {
      resolve(homeDir, expanded);
    }
  }
}

export function normalizeSchedules(
  rawSchedules: ConfigFile["schedules"],
): Record<string, ResolvedScheduleConfig> {
  const schedules: Record<string, ResolvedScheduleConfig> = {};

  for (const [name, schedule] of Object.entries(rawSchedules ?? {})) {
    schedules[name] = {
      description: schedule.description,
      enabled: schedule.enabled ?? true,
      cron: schedule.cron,
      agent: schedule.agent,
      driver: schedule.driver,
      model: schedule.model,
      prompt: schedule.prompt,
      output: schedule.output
        ? {
            type: schedule.output.type,
            channelId: schedule.output.channel_id,
          }
        : undefined,
    };
  }

  return schedules;
}
