import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Paths, SecretsProviders } from "../constants.ts";
import { expandTilde } from "./paths.ts";
import type { ConfigFile } from "./schema.ts";

export interface SecretsProvider {
  get(key: string): string | undefined;
  require(key: string): string;
}

class EnvSecretsProvider implements SecretsProvider {
  get(key: string): string | undefined {
    return process.env[key];
  }

  require(key: string): string {
    const value = this.get(key);
    if (value === undefined || value === "") {
      throw new Error(`Required secret "${key}" is not set`);
    }
    return value;
  }
}

class DotenvSecretsProvider implements SecretsProvider {
  private vars: Record<string, string>;

  constructor(dotenvPath: string) {
    this.vars = {};
    if (existsSync(dotenvPath)) {
      const content = readFileSync(dotenvPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        this.vars[key] = value;
      }
    }

    for (const [key, value] of Object.entries(this.vars)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  get(key: string): string | undefined {
    return process.env[key] ?? this.vars[key];
  }

  require(key: string): string {
    const value = this.get(key);
    if (value === undefined || value === "") {
      throw new Error(`Required secret "${key}" is not set`);
    }
    return value;
  }
}

export function createSecretsProvider(
  homeDir: string,
  secretsConfig?: ConfigFile["secrets"],
): SecretsProvider {
  if (secretsConfig?.provider === SecretsProviders.DOTENV) {
    const rawDotenvPath = expandTilde(secretsConfig.dotenv_path ?? Paths.DOT_ENV);
    const dotenvPath = rawDotenvPath.startsWith("/")
      ? rawDotenvPath
      : resolve(homeDir, rawDotenvPath);
    return new DotenvSecretsProvider(dotenvPath);
  }

  return new EnvSecretsProvider();
}
