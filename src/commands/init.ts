import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import {
  Defaults,
  Drivers,
  EnvVars,
  Paths,
  SecretsProviders,
} from "../constants.ts";
import type { ConfigFile } from "../resources.ts";
import { expandTilde } from "../resources.ts";

export async function runInit(): Promise<void> {
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

  // Build config
  const config: ConfigFile = {
    default_agent: defaultAgent,
    default_driver: defaultDriver,
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
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(resolve(resolvedHome, Paths.LOG_DIR), { recursive: true });

  // Write config.json
  writeFileSync(
    resolve(resolvedHome, Paths.CONFIG_FILE),
    `${JSON.stringify(config, null, 2)}\n`,
  );

  // Write starter SYSTEM.md if it doesn't exist
  const systemMd = resolve(agentDir, Paths.SYSTEM_MD);
  if (!existsSync(systemMd)) {
    writeFileSync(
      systemMd,
      "You are a helpful, versatile assistant. You can answer questions, have conversations, brainstorm ideas, help with writing, analyze information, and assist with a wide range of tasks.\n\nBe concise and direct in your responses. Adapt your tone and depth to the context of the conversation.\n",
    );
  }

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
