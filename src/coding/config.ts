import { z } from "zod";
import { CodingDefaults } from "../constants.ts";
import type { CodingConfig } from "./types.ts";

export const CodingConfigSchema = z
  .object({
    vm_host: z.string().min(1),
    ssh_user: z.string().min(1),
    default_agent: z.string().min(1).optional(),
    repos: z.record(z.string(), z.string()).optional(),
    poll_interval_seconds: z.number().int().positive().optional(),
    task_timeout_minutes: z.number().int().positive().optional(),
  })
  .strict();

export type RawCodingConfig = z.infer<typeof CodingConfigSchema>;

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function substituteEnvVars(
  value: string,
  envLookup: (key: string) => string | undefined = (key) => process.env[key],
): string {
  return value.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
    const envValue = envLookup(varName);
    if (envValue === undefined) {
      throw new Error(
        `Environment variable "${varName}" is not set (referenced as \${${varName}} in coding config)`,
      );
    }
    return envValue;
  });
}

export function substituteEnvVarsInConfig(
  raw: Record<string, unknown>,
  envLookup?: (key: string) => string | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      result[key] = substituteEnvVars(value, envLookup);
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = substituteEnvVarsInConfig(
        value as Record<string, unknown>,
        envLookup,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function parseCodingConfig(
  raw: unknown,
  envLookup?: (key: string) => string | undefined,
): CodingConfig {
  const substituted = substituteEnvVarsInConfig(
    raw as Record<string, unknown>,
    envLookup,
  );
  const parsed = CodingConfigSchema.parse(substituted);
  return {
    vmHost: parsed.vm_host,
    sshUser: parsed.ssh_user,
    defaultAgent: parsed.default_agent ?? CodingDefaults.AGENT,
    repos: parsed.repos ?? {},
    pollIntervalSeconds:
      parsed.poll_interval_seconds ?? CodingDefaults.POLL_INTERVAL_SECONDS,
    taskTimeoutMinutes:
      parsed.task_timeout_minutes ?? CodingDefaults.TASK_TIMEOUT_MINUTES,
  };
}
