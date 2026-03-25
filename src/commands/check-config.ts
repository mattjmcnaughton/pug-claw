import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ZodError } from "zod";
import { CommandResults, type CommandResult } from "./types.ts";
import { Paths } from "../constants.ts";
import {
  type ConfigFile,
  ConfigFileSchema,
  expandTilde,
  resolveConfigPaths,
  toError,
  validateConfigSemantics,
} from "../resources.ts";

export function runCheckConfig(path?: string): CommandResult {
  const configPath = path
    ? resolve(expandTilde(path))
    : resolve(expandTilde(Paths.DEFAULT_HOME), Paths.CONFIG_FILE);

  // Check file exists
  if (!existsSync(configPath)) {
    console.error(`Error: File not found: ${configPath}`);
    return CommandResults.error;
  }

  // Try to read and parse JSON
  let parsed: unknown;
  try {
    const content = readFileSync(configPath, "utf-8");
    parsed = JSON.parse(content);
  } catch (err) {
    const error = toError(err);
    console.error(`Error: Invalid JSON in ${configPath}: ${error.message}`);
    console.error(error.stack);
    return CommandResults.error;
  }

  // Validate against schema
  const result = ConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    console.error(`Error: Config validation failed for ${configPath}:`);
    for (const issue of (result.error as ZodError).issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      console.error(`  - ${path}: ${issue.message}`);
    }
    return CommandResults.error;
  }

  const data = result.data as ConfigFile;

  try {
    const homeDir = dirname(configPath);
    const paths = resolveConfigPaths(homeDir, data);
    validateConfigSemantics(data, homeDir, paths);
  } catch (err) {
    const error = toError(err);
    console.error(`Error: Config validation failed for ${configPath}:`);
    console.error(`  - ${error.message}`);
    return CommandResults.error;
  }

  console.log(`Config OK: ${configPath}`);
  const summary = [
    `  default_agent: ${data.default_agent ?? "(not set)"}`,
    `  default_driver: ${data.default_driver ?? "(not set)"}`,
    `  drivers: ${data.drivers ? Object.keys(data.drivers).join(", ") : "(none)"}`,
    `  channels: ${data.channels ? Object.keys(data.channels).length : 0}`,
    `  schedules: ${data.schedules ? Object.keys(data.schedules).length : 0}`,
  ];
  console.log(summary.join("\n"));
  return CommandResults.success;
}
