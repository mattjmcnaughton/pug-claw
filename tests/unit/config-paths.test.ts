import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { EnvVars } from "../../src/constants.ts";
import {
  resolveConfigPaths,
  resolveLogsDir,
  type ConfigOptions,
} from "../../src/config/paths.ts";
import type { ConfigFile } from "../../src/config/schema.ts";

const HOME_DIR = "/tmp/pug-claw-home";

describe("config path resolution seams", () => {
  test("resolveConfigPaths supports injected env values", () => {
    const env = {
      [EnvVars.AGENTS_DIR]: "env-agents",
      [EnvVars.SKILLS_DIR]: "env-skills",
    };

    const paths = resolveConfigPaths(HOME_DIR, {} as ConfigFile, {}, env);
    expect(paths.agentsDir).toBe(resolve(HOME_DIR, "env-agents"));
    expect(paths.skillsDir).toBe(resolve(HOME_DIR, "env-skills"));
  });

  test("CLI overrides still win over injected env values", () => {
    const opts: ConfigOptions = {
      agentsDir: "/override/agents",
    };
    const env = {
      [EnvVars.AGENTS_DIR]: "/env/agents",
    };

    const paths = resolveConfigPaths(HOME_DIR, {} as ConfigFile, opts, env);
    expect(paths.agentsDir).toBe("/override/agents");
  });

  test("resolveLogsDir supports injected relative env override", () => {
    const env = {
      [EnvVars.LOGS_DIR]: "runtime-logs",
    };

    const logsDir = resolveLogsDir(HOME_DIR, {} as ConfigFile, {}, env);
    expect(logsDir).toBe(resolve(HOME_DIR, "runtime-logs"));
  });
});
