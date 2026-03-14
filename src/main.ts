import { dirname, resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { ClaudeDriver } from "./drivers/claude.ts";
import { PiDriver } from "./drivers/pi.ts";
import type { Driver } from "./drivers/types.ts";
import { DiscordFrontend } from "./frontends/discord.ts";
import { TuiFrontend } from "./frontends/tui.ts";
import { logger } from "./logger.ts";
import { buildFullSystemPrompt } from "./skills.ts";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const AGENTS_DIR = resolve(ROOT, "agents");
const CONFIG_PATH = resolve(ROOT, "agents.json");

const config = await loadConfig(CONFIG_PATH);

// Determine frontend mode
const mode = process.argv.includes("--tui") ? "tui" : "discord";

// Initialize drivers
const piDefaultModel = config.drivers.pi?.default_model;

const drivers: Record<string, Driver> = {
  claude: new ClaudeDriver(),
  pi: await PiDriver.create(piDefaultModel),
};

logger.info({ drivers: Object.keys(drivers) }, "drivers_initialized");

// Select frontend
const frontend = mode === "tui" ? new TuiFrontend() : new DiscordFrontend();

logger.info({ mode }, "starting_frontend");

await frontend.start({
  drivers,
  config,
  agentsDir: AGENTS_DIR,
  buildSystemPrompt: buildFullSystemPrompt,
  logger,
});
