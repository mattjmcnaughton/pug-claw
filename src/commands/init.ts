import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import * as p from "@clack/prompts";

function expandTilde(path: string): string {
  if (path.startsWith("~/") || path === "~") {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

export async function runInit(): Promise<void> {
  p.intro("pug-claw init");

  const envHome = process.env.PUG_CLAW_HOME;

  const homeDir = await p.text({
    message: "Where should pug-claw live?",
    initialValue: envHome ?? "~/.pug-claw",
    validate: (val) => {
      if (!val?.trim()) return "Path cannot be empty";
    },
  });

  if (p.isCancel(homeDir)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const resolvedHome = resolve(expandTilde(homeDir));

  if (existsSync(resolve(resolvedHome, "config.json"))) {
    const overwrite = await p.confirm({
      message: `${resolvedHome}/config.json already exists. Overwrite?`,
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Init cancelled.");
      process.exit(0);
    }
  }

  const defaultAgent = await p.text({
    message: "Default agent name?",
    initialValue: "default",
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
      { value: "claude", label: "claude", hint: "Anthropic Claude" },
      { value: "pi", label: "pi", hint: "Pi coding agent" },
    ],
    initialValue: "claude",
  });

  if (p.isCancel(defaultDriver)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const secretsProvider = await p.select({
    message: "Secrets provider?",
    options: [
      {
        value: "env",
        label: "env",
        hint: "Read secrets from environment variables",
      },
      {
        value: "dotenv",
        label: "dotenv",
        hint: "Read secrets from a .env file (env vars still override)",
      },
    ],
    initialValue: "env",
  });

  if (p.isCancel(secretsProvider)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  let dotenvPath = ".env";
  if (secretsProvider === "dotenv") {
    const dotenvInput = await p.text({
      message: "Path to .env file (relative to home dir, or absolute)?",
      initialValue: ".env",
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
  // biome-ignore lint/suspicious/noExplicitAny: building dynamic JSON
  const config: Record<string, any> = {
    default_agent: defaultAgent,
    default_driver: defaultDriver,
    drivers: {
      claude: {},
      pi: {},
    },
    channels: {},
  };

  if (secretsProvider === "dotenv") {
    config.secrets = { provider: "dotenv", dotenv_path: dotenvPath };
  }

  if (guildId) {
    config.discord = {
      guild_id: guildId,
      ...(ownerId ? { owner_id: ownerId } : {}),
    };
  }

  // Create directory structure
  const spinner = p.spinner();
  spinner.start("Creating directory structure");

  const agentsDir = resolve(resolvedHome, "agents");
  const agentDir = resolve(agentsDir, defaultAgent);
  const skillsDir = resolve(resolvedHome, "skills");
  const dataDir = resolve(resolvedHome, "data");

  mkdirSync(agentDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(resolve(resolvedHome, "logs", "system"), { recursive: true });

  // Write config.json
  writeFileSync(
    resolve(resolvedHome, "config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );

  // Write starter SYSTEM.md if it doesn't exist
  const systemMd = resolve(agentDir, "SYSTEM.md");
  if (!existsSync(systemMd)) {
    writeFileSync(
      systemMd,
      "You are a helpful, versatile assistant. You can answer questions, have conversations, brainstorm ideas, help with writing, analyze information, and assist with a wide range of tasks.\n\nBe concise and direct in your responses. Adapt your tone and depth to the context of the conversation.\n",
    );
  }

  // Write .env template if dotenv provider selected
  let resolvedDotenvPath: string | undefined;
  if (secretsProvider === "dotenv") {
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
      `Config:   ${resolve(resolvedHome, "config.json")}`,
      `Agents:   ${agentsDir}`,
      `Skills:   ${skillsDir}`,
      `Data:     ${dataDir}`,
      `Agent:    ${agentDir}/SYSTEM.md`,
      ...(resolvedDotenvPath ? [`Secrets:  ${resolvedDotenvPath}`] : []),
    ].join("\n"),
    "Created files",
  );

  p.outro("Done! Run `pug-claw start` or `pug-claw tui` to get started.");
}
