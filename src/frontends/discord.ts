import { Client, GatewayIntentBits, type Message } from "discord.js";
import { ChannelHandler } from "../channel-handler.ts";
import { Limits } from "../constants.ts";
import { toError } from "../resources.ts";
import type { Frontend, FrontendContext } from "./types.ts";

export class DiscordFrontend implements Frontend {
  async start(ctx: FrontendContext): Promise<void> {
    const { drivers, logger } = ctx;
    let { config, resolveAgent, pluginDirs } = ctx;

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    const channelHandler = new ChannelHandler(
      drivers,
      config,
      pluginDirs,
      resolveAgent,
      logger,
      "!",
    );

    async function handleCommand(message: Message): Promise<boolean> {
      const content = message.content.trim();
      if (!content.startsWith("!")) return false;
      if (!("send" in message.channel)) return false;

      const parts = content.slice(1).split(/\s+/, 2);
      const cmd = parts[0]?.toLowerCase() ?? "";
      const arg = parts[1]?.trim() ?? "";
      const channelId = message.channelId;

      // Owner-only commands stay in the frontend
      if (cmd === "restart") {
        if (message.author.id !== config.discord?.ownerId) {
          await message.channel.send(
            "Only the bot owner can use this command.",
          );
          return true;
        }
        logger.info({ channel_id: channelId }, "command_restart");
        await message.channel.send("Restarting...");
        process.exit(1);
      }

      if (cmd === "reload") {
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
          await channelHandler.reload(config, pluginDirs, resolveAgent);
          await message.channel.send(
            "Config, agents, and skills reloaded. All sessions reset.",
          );
          logger.info({ channel_id: channelId }, "command_reload");
        } catch (err) {
          const error = toError(err);
          logger.error({ err: error }, "reload_error");
          await message.channel.send(`Reload failed: ${error.message}`);
        }
        return true;
      }

      // Delegate to ChannelHandler for shared commands
      const result = await channelHandler.handleCommand(channelId, cmd, arg);
      if (result !== null) {
        // Append frontend-specific commands to help text
        if (cmd === "help") {
          await message.channel.send(
            result +
              "\n" +
              "`!reload` — Reload config, agents, and skills from disk\n" +
              "`!restart` — Restart the process (requires systemd)",
          );
        } else {
          await message.channel.send(result);
        }
        return true;
      }

      return false;
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

      await channel.sendTyping();

      const typingInterval = setInterval(() => {
        channel.sendTyping().catch(() => {});
      }, 8_000);

      const toolsSeen = new Set<string>();
      const responseText = await channelHandler.handleMessage(
        channelId,
        message.content,
        (event) => {
          channel.sendTyping().catch(() => {});
          if (event.type === "tool_use" && !toolsSeen.has(event.tool)) {
            toolsSeen.add(event.tool);
            channel.send(`Using ${event.tool}...`).catch(() => {});
          }
        },
      );

      clearInterval(typingInterval);

      const text = responseText.trim() ? responseText : "(no response)";

      logger.info(
        {
          message_id: message.id,
          channel_id: channelId,
          driver: channelHandler.resolveDriverName(channelId),
          response_length: text.length,
        },
        "response_sent",
      );

      for (let i = 0; i < text.length; i += Limits.DISCORD_MESSAGE_LENGTH) {
        await message.channel.send(
          text.slice(i, i + Limits.DISCORD_MESSAGE_LENGTH),
        );
      }
    });

    const token = config.secrets.require("DISCORD_BOT_TOKEN");
    await client.login(token);
  }
}
