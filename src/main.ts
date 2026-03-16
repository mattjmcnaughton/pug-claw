#!/usr/bin/env bun
import { resolve } from "node:path";
import { Command } from "commander";
import { runCheckConfig } from "./commands/check-config.ts";
import { runInit } from "./commands/init.ts";
import { runInitService } from "./commands/init-service.ts";
import { Drivers, EnvVars, Paths } from "./constants.ts";
import { ClaudeDriver } from "./drivers/claude.ts";
import { PiDriver } from "./drivers/pi.ts";
import type { Driver } from "./drivers/types.ts";
import { DiscordFrontend } from "./frontends/discord.ts";
import { TuiFrontend } from "./frontends/tui.ts";
import type { Frontend } from "./frontends/types.ts";
import { configureLogger, logger } from "./logger.ts";
import type { ConfigOptions, ResolvedConfig } from "./resources.ts";
import { expandTilde, resolveConfig, toError } from "./resources.ts";
import { buildFullSystemPrompt } from "./skills.ts";

async function startFrontend(
  frontend: Frontend,
  mode: "discord" | "tui",
  opts: ConfigOptions,
): Promise<void> {
  // Resolve homeDir early for logging setup
  const rawHome = opts.home ?? process.env[EnvVars.HOME] ?? Paths.DEFAULT_HOME;
  const homeDir = resolve(expandTilde(rawHome));
  configureLogger(mode, homeDir);

  let config: ResolvedConfig;
  try {
    config = await resolveConfig(opts);
  } catch (err) {
    logger.fatal({ err: toError(err) }, "startup_failed");
    process.exit(1);
  }

  const piDefaultModel = config.drivers.pi?.defaultModel;

  const drivers: Record<string, Driver> = {
    [Drivers.CLAUDE]: new ClaudeDriver(),
    [Drivers.PI]: await PiDriver.create(piDefaultModel),
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

function optsToConfigOptions(
  opts: Record<string, string | undefined>,
): ConfigOptions {
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
  .option("--builtins-only", "Only install/update built-in skills and agents")
  .action(async (opts: { builtinsOnly?: boolean }) => {
    await runInit(opts.builtinsOnly ?? false);
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
