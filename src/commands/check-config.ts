import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ZodError } from "zod";
import { Paths } from "../constants.ts";
import { ConfigFileSchema, expandTilde } from "../resources.ts";

export function runCheckConfig(path?: string): void {
  const configPath = path
    ? resolve(expandTilde(path))
    : resolve(expandTilde(Paths.DEFAULT_HOME), Paths.CONFIG_FILE);

  // Check file exists
  if (!existsSync(configPath)) {
    console.error(`Error: File not found: ${configPath}`);
    process.exit(1);
  }

  // Try to read and parse JSON
  let parsed: unknown;
  try {
    const content = readFileSync(configPath, "utf-8");
    parsed = JSON.parse(content);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`Error: Invalid JSON in ${configPath}: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }

  // Validate against schema
  const result = ConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    console.error(`Error: Config validation failed for ${configPath}:`);
    for (const issue of (result.error as ZodError).issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      console.error(`  - ${path}: ${issue.message}`);
    }
    process.exit(1);
  }

  console.log(`Config OK: ${configPath}`);
  const data = result.data;
  const summary = [
    `  default_agent: ${data.default_agent ?? "(not set)"}`,
    `  default_driver: ${data.default_driver ?? "(not set)"}`,
    `  drivers: ${data.drivers ? Object.keys(data.drivers).join(", ") : "(none)"}`,
    `  channels: ${data.channels ? Object.keys(data.channels).length : 0}`,
  ];
  console.log(summary.join("\n"));
}
