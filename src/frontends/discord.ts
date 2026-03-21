import { Client, GatewayIntentBits, type Message } from "discord.js";
import { Frontends } from "../constants.ts";
import { ChannelHandler } from "../channel-handler.ts";
import { ChatCommandRegistry } from "../chat-commands/registry.ts";
import { createChatCommandTree } from "../chat-commands/tree.ts";
import { toError } from "../resources.ts";
import { DiscordSchedulerOutputSink } from "../scheduler/discord-output.ts";
import { chunkMessage } from "../scheduler/output.ts";
import { SchedulerRuntime } from "../scheduler/runtime.ts";
import type { ScheduleSummary } from "../scheduler/types.ts";
import type { Frontend, FrontendContext } from "./types.ts";

interface SendableChannel {
  send(text: string): Promise<unknown>;
}

function formatDateTime(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });

  const parts = formatter.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")} ${values.get("hour")}:${values.get("minute")} ${values.get("timeZoneName")}`;
}

function formatSchedulesMessages(
  summaries: ScheduleSummary[],
  timezone: string,
  schedulerActive: boolean,
): string[] {
  const blocks: string[] = [];

  if (!schedulerActive) {
    blocks.push(
      "Scheduler is disabled on this instance (lock not acquired).\n",
    );
  }

  if (summaries.length === 0) {
    blocks.push("**Schedules**\n(none configured)");
    return blocks;
  }

  const lines = ["**Schedules**"];
  for (const summary of summaries) {
    const schedule = summary.schedule;
    const enabledText = schedule.enabled ? "enabled" : "disabled";
    const stateText = summary.currentlyRunning ? "running" : "idle";
    const outputText = schedule.output
      ? `<#${schedule.output.channelId}>`
      : "none";
    const nextText =
      schedule.enabled && summary.nextRunAt
        ? formatDateTime(summary.nextRunAt, timezone)
        : "disabled";
    const lastText = summary.lastRun
      ? `${summary.lastRun.status} at ${formatDateTime(new Date(summary.lastRun.startedAt), timezone)}`
      : "never";

    lines.push(`- \`${schedule.name}\` — ${enabledText}, ${stateText}`);
    lines.push(`  cron: \`${schedule.cron}\` (\`${timezone}\`)`);
    lines.push(`  agent: \`${schedule.agent}\``);
    lines.push(`  output: ${outputText}`);
    lines.push(`  next: \`${nextText}\``);
    lines.push(`  last: \`${lastText}\``);
  }

  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > 1900 && current) {
      blocks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) {
    blocks.push(current);
  }

  return blocks;
}

async function sendText(channel: SendableChannel, text: string): Promise<void> {
  for (const chunk of chunkMessage(text)) {
    await channel.send(chunk);
  }
}

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
    );
    const commandRegistry = new ChatCommandRegistry(createChatCommandTree());

    const outputSink = new DiscordSchedulerOutputSink(client);
    let schedulerRuntime: SchedulerRuntime | undefined;

    function hasSchedules(): boolean {
      return Object.keys(config.schedules).length > 0;
    }

    function ensureSchedulerRuntime(): void {
      if (!hasSchedules()) {
        return;
      }
      if (schedulerRuntime) {
        return;
      }
      schedulerRuntime = new SchedulerRuntime({
        drivers,
        config,
        pluginDirs,
        resolveAgent,
        logger,
        outputSink,
      });
      schedulerRuntime.initialize();
    }

    function syncSchedulerRuntime(): void {
      if (!hasSchedules()) {
        if (schedulerRuntime) {
          schedulerRuntime.stop();
          schedulerRuntime = undefined;
        }
        return;
      }

      if (!schedulerRuntime) {
        ensureSchedulerRuntime();
        return;
      }

      schedulerRuntime.reload(config, pluginDirs, resolveAgent);
    }

    async function handleCommand(message: Message): Promise<boolean> {
      const content = message.content.trim();
      if (!content.startsWith("!")) return false;
      if (!("send" in message.channel)) return false;

      const channel = message.channel as SendableChannel;
      const channelId = message.channelId;
      const raw = content.slice(1).trim();
      const isOwner = message.author.id === config.discord?.ownerId;

      try {
        const result = await commandRegistry.execute(
          {
            channelId,
            commandPrefix: "!",
            frontend: Frontends.DISCORD,
            isOwner,
            handler: channelHandler,
            actions: {
              reload: async () => {
                const reloaded = await ctx.reloadConfig();
                config = reloaded.config;
                resolveAgent = reloaded.resolveAgent;
                pluginDirs = reloaded.pluginDirs;
                await channelHandler.reload(config, pluginDirs, resolveAgent);
                syncSchedulerRuntime();
                logger.info({ channel_id: channelId }, "command_reload");
                return "Config, agents, skills, and schedules reloaded. All sessions reset.";
              },
              listSchedules: async () => {
                const timezone = config.scheduler?.timezone ?? "UTC";
                const summaries = schedulerRuntime?.listSchedules() ?? [];
                return formatSchedulesMessages(
                  summaries,
                  timezone,
                  schedulerRuntime ? schedulerRuntime.isActive() : true,
                );
              },
              runSchedule: async (scheduleName: string) => {
                if (!schedulerRuntime) {
                  return `Unknown schedule "${scheduleName}".`;
                }

                const result = schedulerRuntime.runSchedule(scheduleName);
                if (!result.ok) {
                  if (result.reason === "inactive") {
                    return "Scheduler is not active on this instance.";
                  }
                  if (result.reason === "already_running") {
                    return `Schedule "${scheduleName}" is already running.`;
                  }
                  return `Unknown schedule "${scheduleName}".`;
                }

                return `Triggered schedule "${scheduleName}". run_id: ${result.runId}`;
              },
            },
          },
          raw,
        );

        if (result === null) {
          await channel.send(`Unknown command: \`!${raw}\``);
          return true;
        }

        const messages = result.messages ?? [result.message];
        for (const text of messages) {
          await sendText(channel, text);
        }

        if (result.action === "restart") {
          logger.info({ channel_id: channelId }, "command_restart");
          process.exit(1);
        }
        return true;
      } catch (err) {
        const error = toError(err);
        logger.error({ err: error }, "command_error");
        await channel.send(`Command failed: ${error.message}`);
        return true;
      }
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

      await sendText(message.channel, text);
    });

    ensureSchedulerRuntime();

    const token = config.secrets.require("DISCORD_BOT_TOKEN");
    await client.login(token);
  }
}
