import { resolve } from "node:path";
import { homedir } from "node:os";
import { EnvVars, Paths } from "../constants.ts";
import type { ConfigFile } from "./schema.ts";

export interface ConfigOptions {
  home?: string;
  agentsDir?: string;
  skillsDir?: string;
  internalDir?: string;
  dataDir?: string;
  codeDir?: string;
  logsDir?: string;
}

export interface ResolvedConfigPaths {
  agentsDir: string;
  skillsDir: string;
  internalDir: string;
  dataDir: string;
  codeDir: string;
  logsDir: string;
}

export function expandTilde(pathValue: string): string {
  if (pathValue.startsWith("~/") || pathValue === "~") {
    return resolve(homedir(), pathValue.slice(2));
  }
  return pathValue;
}

function resolvePathWithOverrides(
  homeDir: string,
  defaultRelative: string,
  configValue: string | undefined,
  envVar: string | undefined,
  cliFlag: string | undefined,
): string {
  if (cliFlag) return resolve(expandTilde(cliFlag));
  if (envVar) {
    const expanded = expandTilde(envVar);
    if (expanded.startsWith("/")) return expanded;
    return resolve(homeDir, expanded);
  }
  if (configValue) {
    const expanded = expandTilde(configValue);
    if (expanded.startsWith("/")) return expanded;
    return resolve(homeDir, expanded);
  }
  return resolve(homeDir, defaultRelative);
}

export function resolveLogsDir(
  homeDir: string,
  rawConfig?: ConfigFile,
  opts: ConfigOptions = {},
): string {
  return resolvePathWithOverrides(
    homeDir,
    Paths.LOGS_DIR,
    rawConfig?.paths?.logs_dir,
    process.env[EnvVars.LOGS_DIR],
    opts.logsDir,
  );
}

export function resolveConfigPaths(
  homeDir: string,
  rawConfig: ConfigFile,
  opts: ConfigOptions = {},
): ResolvedConfigPaths {
  const agentsDir = resolvePathWithOverrides(
    homeDir,
    Paths.AGENTS_DIR,
    rawConfig.paths?.agents_dir,
    process.env[EnvVars.AGENTS_DIR],
    opts.agentsDir,
  );

  const skillsDir = resolvePathWithOverrides(
    homeDir,
    Paths.SKILLS_DIR,
    rawConfig.paths?.skills_dir,
    process.env[EnvVars.SKILLS_DIR],
    opts.skillsDir,
  );

  const internalDir = resolvePathWithOverrides(
    homeDir,
    Paths.INTERNAL_DIR,
    rawConfig.paths?.internal_dir,
    process.env[EnvVars.INTERNAL_DIR],
    opts.internalDir,
  );

  const dataDir = resolvePathWithOverrides(
    homeDir,
    Paths.DATA_DIR,
    rawConfig.paths?.data_dir,
    process.env[EnvVars.DATA_DIR],
    opts.dataDir,
  );

  const codeDir = resolvePathWithOverrides(
    homeDir,
    Paths.CODE_DIR,
    rawConfig.paths?.code_dir,
    process.env[EnvVars.CODE_DIR],
    opts.codeDir,
  );

  const logsDir = resolveLogsDir(homeDir, rawConfig, opts);

  return {
    agentsDir,
    skillsDir,
    internalDir,
    dataDir,
    codeDir,
    logsDir,
  };
}

export function resolveConfigRelativePath(
  homeDir: string,
  configValue: string | undefined,
): string | undefined {
  if (!configValue) {
    return undefined;
  }

  const expanded = expandTilde(configValue);
  if (expanded.startsWith("/")) {
    return expanded;
  }
  return resolve(homeDir, expanded);
}
