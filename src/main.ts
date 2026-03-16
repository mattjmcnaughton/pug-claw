#!/usr/bin/env bun
import { resolve } from "node:path";
import { homedir } from "node:os";
import { Command } from "commander";
import { runCheckConfig } from "./commands/check-config.ts";
import { runInit } from "./commands/init.ts";
import { runInitService } from "./commands/init-service.ts";
import { ClaudeDriver } from "./drivers/claude.ts";
import { PiDriver } from "./drivers/pi.ts";
import type { Driver } from "./drivers/types.ts";
import { DiscordFrontend } from "./frontends/discord.ts";
import { TuiFrontend } from "./frontends/tui.ts";
import type { Frontend } from "./frontends/types.ts";
import { configureLogger, logger } from "./logger.ts";
import type { ConfigOptions } from "./resources.ts";
import { resolveConfig } from "./resources.ts";
import { buildFullSystemPrompt } from "./skills.ts";

function expandTilde(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

interface StartOptions extends ConfigOptions {
  // Shared options are inherited from ConfigOptions
}

async function startFrontend(
  frontend: Frontend,
  mode: "discord" | "tui",
  opts: StartOptions,
): Promise<void> {
  // Resolve homeDir early for logging setup
  const rawHome = opts.home ?? process.env.PUG_CLAW_HOME ?? "~/.pug-claw";
  const homeDir = resolve(expandTilde(rawHome));
  configureLogger(mode, homeDir);

  let config: Awaited<ReturnType<typeof resolveConfig>>;
  try {
    config = await resolveConfig(opts);
  } catch (err) {
    logger.fatal(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const piDefaultModel = config.drivers.pi?.defaultModel;

  const drivers: Record<string, Driver> = {
    claude: new ClaudeDriver(),
    pi: await PiDriver.create(piDefaultModel),
  };

  logger.info({ drivers: Object.keys(drivers) }, "drivers_initialized");

  const reloadConfig = async () => {
    const newConfig = await resolveConfig(opts);
    return {
      config: newConfig,
      buildSystemPrompt: (agentDir: string) =>
        buildFullSystemPrompt(agentDir, newConfig.skillsDir),
    };
  };

  await frontend.start({
    drivers,
    config,
    buildSystemPrompt: (agentDir: string) =>
      buildFullSystemPrompt(agentDir, config.skillsDir),
    logger,
    reloadConfig,
  });
}

function addSharedOptions(cmd: Command): Command {
  return cmd
    .option("--home <path>", "Home directory (default: ~/.pug-claw)")
    .option("--agents-dir <path>", "Agents directory override")
    .option("--skills-dir <path>", "Skills directory override")
    .option("--data-dir <path>", "Data directory override");
}

function optsToConfigOptions(opts: Record<string, string>): ConfigOptions {
  return {
    home: opts.home,
    agentsDir: opts.agentsDir,
    skillsDir: opts.skillsDir,
    dataDir: opts.dataDir,
  };
}

const program = new Command();

program.name("pug-claw").description("AI bot framework").version("0.1.0");

addSharedOptions(
  program
    .command("start")
    .description("Start with Discord frontend")
    .action(async (opts) => {
      await startFrontend(
        new DiscordFrontend(),
        "discord",
        optsToConfigOptions(opts),
      );
    }),
);

addSharedOptions(
  program
    .command("tui")
    .description("Start with TUI frontend")
    .action(async (opts) => {
      await startFrontend(new TuiFrontend(), "tui", optsToConfigOptions(opts));
    }),
);

program
  .command("init")
  .description("Initialize pug-claw configuration")
  .action(async () => {
    await runInit();
  });

program
  .command("check-config [path]")
  .description("Validate a pug-claw config file")
  .action((path?: string) => {
    runCheckConfig(path);
  });

program
  .command("init-service")
  .description("Generate a systemd service unit file")
  .action(async () => {
    await runInitService();
  });

await program.parseAsync();
