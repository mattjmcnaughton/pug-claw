#!/usr/bin/env bun
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { Command } from "commander";
import { runCheckConfig } from "./commands/check-config.ts";
import { runExportCommand } from "./commands/export.ts";
import { runImportCommand } from "./commands/import.ts";
import { runInit } from "./commands/init.ts";
import { runInitService } from "./commands/init-service.ts";
import {
  Drivers,
  EnvVars,
  Frontends,
  type FrontendName,
  Paths,
  VERSION,
} from "./constants.ts";
import { ClaudeDriver } from "./drivers/claude.ts";
import { PiDriver } from "./drivers/pi.ts";
import type { Driver } from "./drivers/types.ts";
import { DiscordFrontend } from "./frontends/discord.ts";
import { TuiFrontend } from "./frontends/tui.ts";
import type { Frontend } from "./frontends/types.ts";
import { configureLogger, logger } from "./logger.ts";
import { HuggingFaceEmbeddingProvider } from "./memory/embeddings.ts";
import { MemoryStore } from "./memory/store.ts";
import { generateAgentPlugins } from "./plugins.ts";
import type { ConfigOptions, ResolvedConfig } from "./resources.ts";
import {
  expandTilde,
  resolveConfig,
  resolveLogsDir,
  toError,
} from "./resources.ts";
import { resolveAgent } from "./skills.ts";

function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

async function startFrontend(
  frontend: Frontend,
  mode: FrontendName,
  opts: ConfigOptions,
): Promise<void> {
  // Resolve homeDir early for logging setup
  const rawHome = opts.home ?? process.env[EnvVars.HOME] ?? Paths.DEFAULT_HOME;
  const homeDir = resolve(expandTilde(rawHome));
  const logsDir = resolveLogsDir(homeDir, undefined, opts);
  configureLogger(mode, logsDir);

  const commit = getGitCommit();
  logger.info({ version: VERSION, commit }, "pug_claw_starting");

  let config: ResolvedConfig;
  try {
    config = await resolveConfig(opts);
  } catch (err) {
    logger.fatal({ err: toError(err) }, "startup_failed");
    process.exit(1);
  }

  // Export resolved paths so skill scripts (via Bash) can access them
  process.env[EnvVars.HOME] = config.homeDir;
  process.env[EnvVars.AGENTS_DIR] = config.agentsDir;
  process.env[EnvVars.SKILLS_DIR] = config.skillsDir;
  process.env[EnvVars.INTERNAL_DIR] = config.internalDir;
  process.env[EnvVars.DATA_DIR] = config.dataDir;
  process.env[EnvVars.CODE_DIR] = config.codeDir;
  process.env[EnvVars.LOGS_DIR] = config.logsDir;

  const piDefaultModel = config.drivers[Drivers.PI]?.defaultModel;

  const drivers: Record<string, Driver> = {
    [Drivers.CLAUDE]: new ClaudeDriver(),
    [Drivers.PI]: await PiDriver.create(piDefaultModel),
  };

  logger.info({ drivers: Object.keys(drivers) }, "drivers_initialized");

  const memoryStore = config.memory.enabled
    ? new MemoryStore(
        resolve(config.internalDir, Paths.RUNTIME_DB_FILE),
        logger,
        config.memory.embeddings.enabled
          ? new HuggingFaceEmbeddingProvider(
              config.memory.embeddings.model,
              resolve(config.internalDir, Paths.MODELS_DIR),
            )
          : null,
      )
    : undefined;
  await memoryStore?.init();

  const pluginsDir = resolve(config.internalDir, Paths.PLUGINS_DIR);
  const pluginDirs = generateAgentPlugins(
    config.agentsDir,
    config.skillsDir,
    pluginsDir,
  );

  const reloadConfig = async () => {
    const newConfig = await resolveConfig(opts);
    const newPluginsDir = resolve(newConfig.internalDir, Paths.PLUGINS_DIR);
    const newPluginDirs = generateAgentPlugins(
      newConfig.agentsDir,
      newConfig.skillsDir,
      newPluginsDir,
    );
    return {
      config: newConfig,
      pluginDirs: newPluginDirs,
      resolveAgent: (agentDir: string) =>
        resolveAgent(agentDir, newConfig.skillsDir),
    };
  };

  await frontend.start({
    drivers,
    config,
    pluginDirs,
    resolveAgent: (agentDir: string) =>
      resolveAgent(agentDir, config.skillsDir),
    logger,
    memoryBackend: memoryStore,
    reloadConfig,
  });
}

function addSharedOptions(cmd: Command): Command {
  return cmd
    .option("--home <path>", "Home directory (default: ~/.pug-claw)")
    .option("--agents-dir <path>", "Agents directory override")
    .option("--skills-dir <path>", "Skills directory override")
    .option("--internal-dir <path>", "Internal runtime directory override")
    .option("--data-dir <path>", "Data directory override")
    .option("--code-dir <path>", "Code directory override")
    .option("--logs-dir <path>", "Logs directory override");
}

function optsToConfigOptions(
  opts: Record<string, string | undefined>,
): ConfigOptions {
  return {
    home: opts.home,
    agentsDir: opts.agentsDir,
    skillsDir: opts.skillsDir,
    internalDir: opts.internalDir,
    dataDir: opts.dataDir,
    codeDir: opts.codeDir,
    logsDir: opts.logsDir,
  };
}

function collectStringValues(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

const program = new Command();

program.name("pug-claw").description("AI bot framework").version(VERSION);

addSharedOptions(
  program
    .command("start")
    .description("Start with Discord frontend")
    .action(async (opts) => {
      await startFrontend(
        new DiscordFrontend(),
        Frontends.DISCORD,
        optsToConfigOptions(opts),
      );
    }),
);

addSharedOptions(
  program
    .command("tui")
    .description("Start with TUI frontend")
    .action(async (opts) => {
      await startFrontend(
        new TuiFrontend(),
        Frontends.TUI,
        optsToConfigOptions(opts),
      );
    }),
);

program
  .command("export")
  .description("Create a backup archive")
  .option(
    "--output <path>",
    "Output file path (default: ./pug-claw-backup-{timestamp}.tar.gz)",
  )
  .option(
    "--output-dir <path>",
    "Output directory for the default backup filename",
  )
  .option(
    "--include <dir>",
    "Include optional directory (repeatable: data, code, logs)",
    collectStringValues,
    [],
  )
  .option("--home <path>", "Home directory (default: ~/.pug-claw)")
  .action(
    async (opts: {
      home?: string;
      include?: string[];
      output?: string;
      outputDir?: string;
    }) => {
      await runExportCommand(opts);
    },
  );

program
  .command("import <path>")
  .description("Restore a backup archive")
  .option("--home <path>", "Home directory (default: ~/.pug-claw)")
  .option("--dry-run", "Show what would be restored without writing")
  .option("--force", "Overwrite existing files without prompting")
  .action(
    async (
      path: string,
      opts: { dryRun?: boolean; force?: boolean; home?: string },
    ) => {
      await runImportCommand({
        path,
        home: opts.home,
        dryRun: opts.dryRun,
        force: opts.force,
      });
    },
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
