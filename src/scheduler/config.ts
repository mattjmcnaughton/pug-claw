import type { ResolvedConfig } from "../resources.ts";
import type { ResolvedSchedule } from "./types.ts";

export function getResolvedSchedules(
  config: ResolvedConfig,
): ResolvedSchedule[] {
  return Object.entries(config.schedules)
    .map(([name, schedule]) => ({
      name,
      description: schedule.description,
      enabled: schedule.enabled,
      cron: schedule.cron,
      agent: schedule.agent,
      driver: schedule.driver,
      model: schedule.model,
      prompt: schedule.prompt,
      output: schedule.output,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
