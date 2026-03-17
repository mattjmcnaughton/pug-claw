import { resolve } from "node:path";
import { Client, GatewayIntentBits, type Message } from "discord.js";
import {
  listAvailableAgents,
  parseAgentSystemMd,
  resolveAgentDir,
} from "../agents.ts";
import { Limits } from "../constants.ts";
import type { Driver } from "../drivers/types.ts";
import { resolveDriverName as resolveDriverNameFromInputs } from "../resolve.ts";
import { expandTilde, getChannelConfig, toError } from "../resources.ts";
import type { ResolvedAgent } from "../skills.ts";
import { discoverSkills } from "../skills.ts";
import type { Frontend, FrontendContext } from "./types.ts";

export class DiscordFrontend implements Frontend {
  async start(ctx: FrontendContext): Promise<void> {
    const { drivers, logger } = ctx;
    let { config, resolveAgent, pluginDirs } = ctx;
    let agentsDir = config.agentsDir;

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Per-channel state
    const channelDrivers = new Map<string, string>();
    const channelModels = new Map<string, string>();
    const channelAgents = new Map<string, string>();
    const channelSessions = new Map<string, string>();
    const channelResolvedAgents = new Map<string, ResolvedAgent>();

    function getResolvedAgent(channelId: string): ResolvedAgent {
      const cached = channelResolvedAgents.get(channelId);
      if (cached) return cached;
      const agentName = resolveAgentName(channelId);
      const agentDir = resolve(agentsDir, agentName);
      const resolved = resolveAgent(agentDir);
      channelResolvedAgents.set(channelId, resolved);
      return resolved;
    }

    function resolveChannelDriverName(channelId: string): string {
      const resolved = getResolvedAgent(channelId);
      return resolveDriverNameFromInputs({
        runtimeOverride: channelDrivers.get(channelId),
        channelConfig: getChannelConfig(config, channelId).driver,
        agentFrontmatter: resolved.driver,
        globalDefault: config.defaultDriver,
      });
    }

    function resolveDriver(channelId: string): Driver {
      const name = resolveChannelDriverName(channelId);
      const driver = drivers[name];
      if (!driver) throw new Error(`Unknown driver: ${name}`);
      return driver;
    }

    function resolveAgentName(channelId: string): string {
      return (
        channelAgents.get(channelId) ??
        getChannelConfig(config, channelId).agent ??
        config.defaultAgent
      );
    }

    function resolveChannelModel(channelId: string): string | undefined {
      const resolved = getResolvedAgent(channelId);
      const channelCfg = getChannelConfig(config, channelId);
      return channelModels.get(channelId) ?? channelCfg.model ?? resolved.model;
    }

    async function destroySession(channelId: string) {
      const sessionId = channelSessions.get(channelId);
      if (sessionId) {
        const driver = resolveDriver(channelId);
        await driver.destroySession(sessionId);
        channelSessions.delete(channelId);
      }
    }

    async function handleCommand(message: Message): Promise<boolean> {
      const content = message.content.trim();
      if (!content.startsWith("!")) return false;
      if (!("send" in message.channel)) return false;

      const parts = content.slice(1).split(/\s+/, 2);
      const cmd = parts[0]?.toLowerCase();
      const arg = parts[1]?.trim() ?? "";
      const channelId = message.channelId;

      if (cmd === "new") {
        await destroySession(channelId);
        await message.channel.send(
          "Session reset. Next message starts a fresh conversation.",
        );
        logger.info({ channel_id: channelId }, "command_new");
      } else if (cmd === "driver") {
        if (!arg) {
          const current = resolveChannelDriverName(channelId);
          const available = Object.keys(drivers)
            .map((k) => `\`${k}\``)
            .join(", ");
          await message.channel.send(
            `Current driver: \`${current}\`\nAvailable: ${available}`,
          );
          return true;
        }
        if (!drivers[arg]) {
          const available = Object.keys(drivers)
            .map((k) => `\`${k}\``)
            .join(", ");
          await message.channel.send(
            `Unknown driver \`${arg}\`. Available: ${available}`,
          );
          return true;
        }
        channelDrivers.set(channelId, arg);
        channelModels.delete(channelId);
        await destroySession(channelId);
        await message.channel.send(
          `Driver switched to \`${arg}\`. Session reset.`,
        );
        logger.info({ channel_id: channelId, driver: arg }, "command_driver");
      } else if (cmd === "model") {
        const driver = resolveDriver(channelId);
        if (!arg) {
          const current = resolveChannelModel(channelId) ?? driver.defaultModel;
          const aliases = Object.entries(driver.availableModels)
            .map(([k, v]) => `\`${k}\` → ${v}`)
            .join("\n");
          await message.channel.send(
            `Current model: \`${current}\`\nAvailable aliases:\n${aliases}\n\nOr use a raw model ID.`,
          );
          return true;
        }
        const model = driver.availableModels[arg.toLowerCase()] ?? arg;
        channelModels.set(channelId, model);
        await destroySession(channelId);
        await message.channel.send(
          `Model switched to \`${model}\`. Session reset.`,
        );
        logger.info({ channel_id: channelId, model }, "command_model");
      } else if (cmd === "agent") {
        if (!arg) {
          const current = resolveAgentName(channelId);
          const available = listAvailableAgents(agentsDir)
            .map((name) => `\`${name}\``)
            .join(", ");
          await message.channel.send(
            `Current agent: \`${current}\`\nAvailable: ${available}`,
          );
          return true;
        }
        const agentDir = resolveAgentDir(agentsDir, arg);
        if (!agentDir) {
          await message.channel.send(
            `Unknown agent \`${arg}\`. No agent with SYSTEM.md found at \`agents/${arg}/\`.`,
          );
          return true;
        }
        channelAgents.set(channelId, arg);
        channelResolvedAgents.delete(channelId);
        await destroySession(channelId);
        await message.channel.send(
          `Agent switched to \`${arg}\`. Session reset.`,
        );
        logger.info({ channel_id: channelId, agent: arg }, "command_agent");
      } else if (cmd === "skills") {
        const agentName = resolveAgentName(channelId);
        const agentDir = resolve(agentsDir, agentName);
        const parsed = parseAgentSystemMd(agentDir);
        const skills = discoverSkills(
          agentDir,
          config.skillsDir,
          parsed.meta.allowedSkills,
        );
        if (skills.length === 0) {
          await message.channel.send(
            `No skills found for agent \`${agentName}\`.`,
          );
        } else {
          const lines = [`**Skills for agent \`${agentName}\`:**`];
          for (const s of skills) {
            lines.push(`- **${s.name}**: ${s.description}`);
          }
          await message.channel.send(lines.join("\n"));
        }
      } else if (cmd === "status") {
        const driverName = resolveChannelDriverName(channelId);
        const driver = resolveDriver(channelId);
        const model = resolveChannelModel(channelId) ?? driver.defaultModel;
        const agentName = resolveAgentName(channelId);
        const hasSession = channelSessions.has(channelId);
        await message.channel.send(
          `Driver: \`${driverName}\`\nAgent: \`${agentName}\`\nModel: \`${model}\`\nActive session: \`${hasSession}\``,
        );
      } else if (cmd === "restart") {
        if (message.author.id !== config.discord?.ownerId) {
          await message.channel.send(
            "Only the bot owner can use this command.",
          );
          return true;
        }
        logger.info({ channel_id: channelId }, "command_restart");
        await message.channel.send("Restarting...");
        process.exit(1);
      } else if (cmd === "reload") {
        if (message.author.id !== config.discord?.ownerId) {
          await message.channel.send(
            "Only the bot owner can use this command.",
          );
          return true;
        }
        try {
          const reloaded = await ctx.reloadConfig();
          config = reloaded.config;
          resolveAgent = reloaded.resolveAgent;
          pluginDirs = reloaded.pluginDirs;
          agentsDir = config.agentsDir;
          channelResolvedAgents.clear();
          // Destroy all active sessions so they pick up new config
          const sessionChannelIds = [...channelSessions.keys()];
          for (const chId of sessionChannelIds) {
            await destroySession(chId);
          }
          await message.channel.send(
            "Config, agents, and skills reloaded. All sessions reset.",
          );
          logger.info({ channel_id: channelId }, "command_reload");
        } catch (err) {
          const error = toError(err);
          logger.error({ err: error }, "reload_error");
          await message.channel.send(`Reload failed: ${error.message}`);
        }
      } else if (cmd === "help") {
        await message.channel.send(
          "**Commands:**\n" +
            "`!new` — Start a fresh conversation\n" +
            "`!driver [name]` — Show/switch driver (resets session)\n" +
            "`!model [name]` — Show/switch model (resets session)\n" +
            "`!agent [name]` — Show/switch agent (resets session)\n" +
            "`!skills` — List skills for the current agent\n" +
            "`!status` — Show current driver, agent, model, and session state\n" +
            "`!reload` — Reload config, agents, and skills from disk\n" +
            "`!restart` — Restart the process (requires systemd)\n" +
            "`!help` — Show this message",
        );
      } else {
        return false;
      }

      return true;
    }

    client.on("ready", () => {
      logger.info(
        {
          bot_user: client.user?.tag,
          bot_id: client.user?.id,
          guilds: client.guilds.cache.map((g) => ({ id: g.id, name: g.name })),
          default_driver: config.defaultDriver,
          default_agent: config.defaultAgent,
          owner_id: config.discord?.ownerId,
          guild_filter: config.discord?.guildId,
        },
        "bot_ready",
      );
    });

    client.on("messageCreate", async (message: Message) => {
      if (message.author.bot) return;

      // Guild filter: ignore messages from other guilds if configured
      if (
        config.discord?.guildId &&
        message.guildId !== config.discord.guildId
      ) {
        return;
      }

      logger.info(
        {
          message_id: message.id,
          channel_id: message.channelId,
          channel_name: "name" in message.channel ? message.channel.name : null,
          guild_id: message.guildId,
          author_id: message.author.id,
          author_name: message.author.tag,
          content_length: message.content.length,
        },
        "message_received",
      );

      if (await handleCommand(message)) return;
      if (!("send" in message.channel)) return;

      const channel = message.channel;
      const channelId = message.channelId;
      const driver = resolveDriver(channelId);

      // Create session if needed
      if (!channelSessions.has(channelId)) {
        const resolved = getResolvedAgent(channelId);
        const model = resolveChannelModel(channelId) ?? driver.defaultModel;
        const tools = getChannelConfig(config, channelId).tools;

        try {
          const agentName = resolveAgentName(channelId);
          const driverName = resolveChannelDriverName(channelId);
          const driverCwd = config.drivers[driverName]?.cwd;
          const cwd = driverCwd
            ? resolve(expandTilde(driverCwd))
            : config.homeDir;

          const sessionId = await driver.createSession({
            systemPrompt: resolved.systemPrompt,
            model,
            tools,
            skills: resolved.skills,
            pluginDir: pluginDirs.get(agentName),
            cwd,
          });
          channelSessions.set(channelId, sessionId);
        } catch (err) {
          const error = toError(err);
          logger.error(
            { err: error, channel_id: channelId },
            "session_create_error",
          );
          await message.channel.send(error.message);
          return;
        }
      }

      const sessionId = channelSessions.get(channelId);
      if (!sessionId) return;
      await channel.sendTyping();

      const typingInterval = setInterval(() => {
        channel.sendTyping().catch(() => {});
      }, 8_000);

      let responseText: string;
      try {
        const toolsSeen = new Set<string>();
        const response = await driver.query(
          sessionId,
          message.content,
          (event) => {
            channel.sendTyping().catch(() => {});
            if (event.type === "tool_use" && !toolsSeen.has(event.tool)) {
              toolsSeen.add(event.tool);
              channel.send(`Using ${event.tool}...`).catch(() => {});
            }
          },
        );
        responseText = response.text;
      } catch (err) {
        const error = toError(err);
        logger.error({ err: error, channel_id: channelId }, "query_error");
        responseText = error.message;
      } finally {
        clearInterval(typingInterval);
      }

      if (!responseText.trim()) {
        responseText = "(no response)";
      }

      logger.info(
        {
          message_id: message.id,
          channel_id: channelId,
          driver: driver.name,
          response_length: responseText.length,
        },
        "response_sent",
      );

      // Discord message length limit
      for (
        let i = 0;
        i < responseText.length;
        i += Limits.DISCORD_MESSAGE_LENGTH
      ) {
        await message.channel.send(
          responseText.slice(i, i + Limits.DISCORD_MESSAGE_LENGTH),
        );
      }
    });

    const token = config.secrets.require("DISCORD_BOT_TOKEN");
    await client.login(token);
  }
}
