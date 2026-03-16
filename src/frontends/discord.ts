import { resolve } from "node:path";
import { Client, GatewayIntentBits, type Message } from "discord.js";
import { listAvailableAgents, resolveAgentDir } from "../agents.ts";
import type { Driver } from "../drivers/types.ts";
import { getChannelConfig } from "../resources.ts";
import { discoverSkills } from "../skills.ts";
import type { Frontend, FrontendContext } from "./types.ts";

export class DiscordFrontend implements Frontend {
  async start(ctx: FrontendContext): Promise<void> {
    const { drivers, logger } = ctx;
    let { config, buildSystemPrompt } = ctx;
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

    function resolveDriverName(channelId: string): string {
      return (
        channelDrivers.get(channelId) ??
        getChannelConfig(config, channelId).driver ??
        config.defaultDriver
      );
    }

    function resolveDriver(channelId: string): Driver {
      const name = resolveDriverName(channelId);
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

    function resolveModel(channelId: string): string | undefined {
      return (
        channelModels.get(channelId) ??
        getChannelConfig(config, channelId).model
      );
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
          const current = resolveDriverName(channelId);
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
          const current = resolveModel(channelId) ?? driver.defaultModel;
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
        await destroySession(channelId);
        await message.channel.send(
          `Agent switched to \`${arg}\`. Session reset.`,
        );
        logger.info({ channel_id: channelId, agent: arg }, "command_agent");
      } else if (cmd === "skills") {
        const agentName = resolveAgentName(channelId);
        const agentDir = resolve(agentsDir, agentName);
        const skills = discoverSkills(agentDir);
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
        const driverName = resolveDriverName(channelId);
        const driver = resolveDriver(channelId);
        const model = resolveModel(channelId) ?? driver.defaultModel;
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
        logger.info("command_restart");
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
          buildSystemPrompt = reloaded.buildSystemPrompt;
          agentsDir = config.agentsDir;
          // Destroy all active sessions so they pick up new config
          const sessionChannelIds = [...channelSessions.keys()];
          for (const channelId of sessionChannelIds) {
            await destroySession(channelId);
          }
          await message.channel.send(
            "Config, agents, and skills reloaded. All sessions reset.",
          );
          logger.info("command_reload");
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error({ error: errMsg }, "reload_error");
          await message.channel.send(`Reload failed: ${errMsg}`);
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

      const channelId = message.channelId;
      const driver = resolveDriver(channelId);
      const agentName = resolveAgentName(channelId);
      const agentDir = resolve(agentsDir, agentName);

      // Create session if needed
      if (!channelSessions.has(channelId)) {
        const systemPrompt = buildSystemPrompt(agentDir);
        const model = resolveModel(channelId) ?? driver.defaultModel;
        const tools = getChannelConfig(config, channelId).tools;

        try {
          const sessionId = await driver.createSession({
            systemPrompt,
            model,
            tools,
          });
          channelSessions.set(channelId, sessionId);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(
            { error: errMsg, channel_id: channelId },
            "session_create_error",
          );
          await message.channel.send(errMsg);
          return;
        }
      }

      const sessionId = channelSessions.get(channelId);
      if (!sessionId) return;
      await message.channel.sendTyping();

      let responseText: string;
      try {
        const response = await driver.query(sessionId, message.content);
        responseText = response.text;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ error: errMsg, channel_id: channelId }, "query_error");
        responseText = errMsg;
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

      // Discord 2000-char limit
      for (let i = 0; i < responseText.length; i += 2000) {
        await message.channel.send(responseText.slice(i, i + 2000));
      }
    });

    const token = config.secrets.require("DISCORD_BOT_TOKEN");
    await client.login(token);
  }
}
