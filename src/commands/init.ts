import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import yaml from "js-yaml";
import {
  Defaults,
  Drivers,
  EnvVars,
  FrontmatterMetadata,
  ManagedBy,
  Paths,
  SecretsProviders,
} from "../constants.ts";
import { logger } from "../logger.ts";
import type { ConfigFile } from "../resources.ts";
import { expandTilde } from "../resources.ts";

function isManagedByPugClaw(filePath: string): boolean {
  try {
    const text = readFileSync(filePath, "utf-8");
    const parts = text.split("---", 3);
    if (parts.length < 3 || parts[0]?.trim() !== "") return false;
    const frontmatter = parts[1];
    if (!frontmatter?.trim()) return false;
    const meta = yaml.load(frontmatter);
    if (typeof meta !== "object" || meta === null) return false;
    const record = meta as Record<string, unknown>;
    const metadata = record.metadata;
    if (typeof metadata !== "object" || metadata === null) return false;
    return (
      (metadata as Record<string, unknown>)[FrontmatterMetadata.MANAGED_BY] ===
      ManagedBy.PUG_CLAW
    );
  } catch {
    return false;
  }
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

export function installBuiltins(homeDir: string): {
  installed: number;
  updated: number;
  skipped: number;
} {
  const builtinsDir = resolve(import.meta.dir, "../../builtins");
  let installed = 0;
  let updated = 0;
  let skipped = 0;

  const categories = [
    { src: "skills", dest: Paths.SKILLS_DIR, markerFile: Paths.SKILL_MD },
    { src: "agents", dest: Paths.AGENTS_DIR, markerFile: Paths.SYSTEM_MD },
  ];

  for (const category of categories) {
    const srcDir = resolve(builtinsDir, category.src);
    const destDir = resolve(homeDir, category.dest);

    if (!existsSync(srcDir)) continue;

    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const srcItemDir = resolve(srcDir, entry.name);
      const destItemDir = resolve(destDir, entry.name);
      const destMarker = resolve(destItemDir, category.markerFile);

      if (existsSync(destMarker)) {
        if (isManagedByPugClaw(destMarker)) {
          copyDirRecursive(srcItemDir, destItemDir);
          updated++;
          logger.info(
            { name: entry.name, type: category.src },
            "builtin_updated",
          );
        } else {
          skipped++;
          logger.info(
            { name: entry.name, type: category.src },
            "builtin_skipped_user_owned",
          );
        }
      } else {
        copyDirRecursive(srcItemDir, destItemDir);
        installed++;
        logger.info(
          { name: entry.name, type: category.src },
          "builtin_installed",
        );
      }
    }
  }

  return { installed, updated, skipped };
}

export async function runInit(builtinsOnly = false): Promise<void> {
  if (builtinsOnly) {
    p.intro("pug-claw init --builtins-only");
    const envHome = process.env[EnvVars.HOME];
    const rawHome = envHome ?? Paths.DEFAULT_HOME;
    const resolvedHome = resolve(expandTilde(rawHome));

    if (!existsSync(resolvedHome)) {
      p.cancel(
        `Home directory not found: ${resolvedHome}\nRun \`pug-claw init\` first.`,
      );
      process.exit(1);
    }

    mkdirSync(resolve(resolvedHome, Paths.SKILLS_DIR), { recursive: true });
    mkdirSync(resolve(resolvedHome, Paths.AGENTS_DIR), { recursive: true });
    mkdirSync(resolve(resolvedHome, Paths.PLUGINS_DIR), { recursive: true });

    const result = installBuiltins(resolvedHome);
    p.note(
      [
        `Installed: ${result.installed}`,
        `Updated:   ${result.updated}`,
        `Skipped:   ${result.skipped}`,
      ].join("\n"),
      "Built-in skills and agents",
    );
    p.outro("Done!");
    return;
  }

  p.intro("pug-claw init");

  const envHome = process.env[EnvVars.HOME];

  const homeDir = await p.text({
    message: "Where should pug-claw live?",
    initialValue: envHome ?? Paths.DEFAULT_HOME,
    validate: (val) => {
      if (!val?.trim()) return "Path cannot be empty";
    },
  });

  if (p.isCancel(homeDir)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const resolvedHome = resolve(expandTilde(homeDir));

  if (existsSync(resolve(resolvedHome, Paths.CONFIG_FILE))) {
    const overwrite = await p.confirm({
      message: `${resolvedHome}/${Paths.CONFIG_FILE} already exists. Overwrite?`,
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Init cancelled.");
      process.exit(0);
    }
  }

  const defaultAgent = await p.text({
    message: "Default agent name?",
    initialValue: Defaults.AGENT,
    validate: (val) => {
      if (!val?.trim()) return "Agent name cannot be empty";
      if (/[/\\]/.test(val ?? "")) return "Agent name cannot contain slashes";
    },
  });

  if (p.isCancel(defaultAgent)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const defaultDriver = await p.select({
    message: "Default driver?",
    options: [
      {
        value: Drivers.CLAUDE,
        label: Drivers.CLAUDE,
        hint: "Anthropic Claude",
      },
      { value: Drivers.PI, label: Drivers.PI, hint: "Pi coding agent" },
    ],
    initialValue: Drivers.CLAUDE,
  });

  if (p.isCancel(defaultDriver)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const secretsProvider = await p.select({
    message: "Secrets provider?",
    options: [
      {
        value: SecretsProviders.ENV,
        label: SecretsProviders.ENV,
        hint: "Read secrets from environment variables",
      },
      {
        value: SecretsProviders.DOTENV,
        label: SecretsProviders.DOTENV,
        hint: "Read secrets from a .env file (env vars still override)",
      },
    ],
    initialValue: Defaults.SECRETS_PROVIDER,
  });

  if (p.isCancel(secretsProvider)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  let dotenvPath: string = Paths.DOT_ENV;
  if (secretsProvider === SecretsProviders.DOTENV) {
    const dotenvInput = await p.text({
      message: "Path to .env file (relative to home dir, or absolute)?",
      initialValue: Paths.DOT_ENV,
      validate: (val) => {
        if (!val?.trim()) return "Path cannot be empty";
      },
    });

    if (p.isCancel(dotenvInput)) {
      p.cancel("Init cancelled.");
      process.exit(0);
    }
    dotenvPath = dotenvInput;
  }

  const guildId = await p.text({
    message: "Discord guild ID? (optional, press Enter to skip)",
    initialValue: "",
  });

  if (p.isCancel(guildId)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  let ownerId = "";
  if (guildId) {
    const ownerInput = await p.text({
      message: "Discord owner ID?",
      initialValue: "",
    });

    if (p.isCancel(ownerInput)) {
      p.cancel("Init cancelled.");
      process.exit(0);
    }
    ownerId = ownerInput;
  }

  const serverTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  // Build config
  const config: ConfigFile = {
    default_agent: defaultAgent,
    default_driver: defaultDriver,
    scheduler: {
      timezone: serverTimezone,
    },
    drivers: {
      [Drivers.CLAUDE]: {},
      [Drivers.PI]: {},
    },
    channels: {},
    ...(secretsProvider === SecretsProviders.DOTENV
      ? {
          secrets: {
            provider: SecretsProviders.DOTENV,
            dotenv_path: dotenvPath,
          },
        }
      : {}),
    ...(guildId
      ? {
          discord: {
            guild_id: guildId,
            ...(ownerId ? { owner_id: ownerId } : {}),
          },
        }
      : {}),
  };

  // Create directory structure
  const spinner = p.spinner();
  spinner.start("Creating directory structure");

  const agentsDir = resolve(resolvedHome, Paths.AGENTS_DIR);
  const agentDir = resolve(agentsDir, defaultAgent);
  const skillsDir = resolve(resolvedHome, Paths.SKILLS_DIR);
  const dataDir = resolve(resolvedHome, Paths.DATA_DIR);

  mkdirSync(agentDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(resolve(resolvedHome, Paths.PLUGINS_DIR), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(resolve(resolvedHome, Paths.LOGS_DIR, Paths.SYSTEM_LOG_DIR), {
    recursive: true,
  });

  // Write config.json
  writeFileSync(
    resolve(resolvedHome, Paths.CONFIG_FILE),
    `${JSON.stringify(config, null, 2)}\n`,
  );

  // Install built-in skills and agents
  installBuiltins(resolvedHome);

  // Write .env template if dotenv provider selected
  let resolvedDotenvPath: string | undefined;
  if (secretsProvider === SecretsProviders.DOTENV) {
    const expanded = expandTilde(dotenvPath);
    resolvedDotenvPath = expanded.startsWith("/")
      ? expanded
      : resolve(resolvedHome, expanded);
    if (!existsSync(resolvedDotenvPath)) {
      writeFileSync(
        resolvedDotenvPath,
        "# pug-claw secrets\n# DISCORD_BOT_TOKEN=your-token-here\n",
      );
    }
  }

  spinner.stop("Directory structure created");

  p.note(
    [
      `Home:     ${resolvedHome}`,
      `Config:   ${resolve(resolvedHome, Paths.CONFIG_FILE)}`,
      `Agents:   ${agentsDir}`,
      `Skills:   ${skillsDir}`,
      `Data:     ${dataDir}`,
      `Agent:    ${agentDir}/${Paths.SYSTEM_MD}`,
      ...(resolvedDotenvPath ? [`Secrets:  ${resolvedDotenvPath}`] : []),
    ].join("\n"),
    "Created files",
  );

  p.outro("Done! Run `pug-claw start` or `pug-claw tui` to get started.");
}
