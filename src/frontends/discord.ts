import { Client, GatewayIntentBits, type Message } from "discord.js";
import {
  CommandPrefixes,
  Frontends,
  SchedulerMessages,
  SessionScopePrefixes,
} from "../constants.ts";
import { ChannelHandler } from "../channel-handler.ts";
import { ChatCommandRegistry } from "../chat-commands/registry.ts";
import { createChatCommandTree } from "../chat-commands/tree.ts";
import {
  createFrontendCommandActionsController,
  type FrontendRuntimeState,
} from "./command-actions.ts";
import type { Frontend, FrontendContext } from "./types.ts";
import { chunkMessage } from "../scheduler/output.ts";
import { SchedulerRuntime } from "../scheduler/runtime.ts";
import { toError } from "../resources.ts";
import { DiscordSchedulerOutputSink } from "../scheduler/discord-output.ts";
import type { ScheduleSummary } from "../scheduler/types.ts";

interface SendableChannel {
  send(text: string): Promise<unknown>;
}

interface MessageScope {
  sessionChannelId: string;
  settingsChannelId: string;
  bootstrapPrompt?: string;
}

const DiscordFrontendMessages = {
  THREAD_STARTER_PROMPT_PREFIX: "Thread starter message:\n",
  REPLY_ROOT_PROMPT_PREFIX: "Reply root message:\n",
  RELOAD_COMPLETED:
    "Config, agents, skills, and schedules reloaded. All sessions reset.",
  SCHEDULER_DISABLED:
    "Scheduler is disabled on this instance (lock not acquired).\n",
  SCHEDULER_NOT_ACTIVE: "Scheduler is not active on this instance.",
} as const;

function formatUnknownScheduleMessage(scheduleName: string): string {
  return `Unknown schedule "${scheduleName}".`;
}

function formatScheduleAlreadyRunningMessage(scheduleName: string): string {
  return `Schedule "${scheduleName}" is already running.`;
}

function formatTriggeredScheduleMessage(
  scheduleName: string,
  runId: string,
): string {
  return `Triggered schedule "${scheduleName}". run_id: ${runId}`;
}

function formatUnknownCommandMessage(raw: string): string {
  return `Unknown command: \`${CommandPrefixes.DISCORD}${raw}\``;
}

function resolveMessageContent(message: Message): string {
  return message.content.trim();
}

async function resolveReplyRootMessage(message: Message): Promise<Message> {
  let current = await message.fetchReference();
  const seenReferenceIds = new Set<string>();

  // Replies can chain. Walk up references to scope the session to the root reply.
  for (let depth = 0; depth < 20; depth += 1) {
    const referenceMessageId = current.reference?.messageId;
    if (!referenceMessageId || seenReferenceIds.has(referenceMessageId)) {
      break;
    }

    seenReferenceIds.add(referenceMessageId);
    current = await current.fetchReference();
  }

  return current;
}

async function resolveMessageScope(
  message: Message,
  channelHandler: ChannelHandler,
  logger: FrontendContext["logger"],
): Promise<MessageScope> {
  if (message.channel.isThread()) {
    const threadId = message.channelId;
    const threadScopeChannelId = `${SessionScopePrefixes.THREAD}${threadId}`;
    const settingsChannelId = message.channel.parentId ?? threadId;
    let bootstrapPrompt: string | undefined;

    if (!channelHandler.hasSession(threadScopeChannelId)) {
      try {
        const starterMessage = await message.channel.fetchStarterMessage();
        if (starterMessage) {
          const starterContent = resolveMessageContent(starterMessage);
          if (starterContent) {
            bootstrapPrompt =
              DiscordFrontendMessages.THREAD_STARTER_PROMPT_PREFIX +
              starterContent;
          }
        }
      } catch (err) {
        logger.warn(
          {
            err: toError(err),
            channel_id: threadId,
            message_id: message.id,
          },
          "discord_thread_starter_fetch_failed",
        );
      }
    }

    return {
      sessionChannelId: threadScopeChannelId,
      settingsChannelId,
      bootstrapPrompt,
    };
  }

  const settingsChannelId = message.channelId;
  const referenceMessageId = message.reference?.messageId;
  if (!referenceMessageId) {
    return {
      sessionChannelId: message.channelId,
      settingsChannelId,
    };
  }

  let rootMessageId = referenceMessageId;
  let bootstrapPrompt: string | undefined;

  try {
    const rootMessage = await resolveReplyRootMessage(message);
    rootMessageId = rootMessage.id;

    if (
      !channelHandler.hasSession(
        `${SessionScopePrefixes.REPLY}${rootMessageId}`,
      )
    ) {
      const rootMessageContent = resolveMessageContent(rootMessage);
      if (rootMessageContent) {
        bootstrapPrompt =
          DiscordFrontendMessages.REPLY_ROOT_PROMPT_PREFIX + rootMessageContent;
      }
    }
  } catch (err) {
    logger.warn(
      {
        err: toError(err),
        channel_id: message.channelId,
        message_id: message.id,
        reference_message_id: referenceMessageId,
      },
      "discord_reply_reference_fetch_failed",
    );
  }

  return {
    sessionChannelId: `${SessionScopePrefixes.REPLY}${rootMessageId}`,
    settingsChannelId,
    bootstrapPrompt,
  };
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
    blocks.push(DiscordFrontendMessages.SCHEDULER_DISABLED);
  }

  if (summaries.length === 0) {
    blocks.push(SchedulerMessages.SCHEDULES_NONE_CONFIGURED);
    return blocks;
  }

  const lines: string[] = [SchedulerMessages.SCHEDULES_HEADER];
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
    let runtimeState: FrontendRuntimeState = {
      config: ctx.config,
      pluginDirs: ctx.pluginDirs,
      resolveAgent: ctx.resolveAgent,
    };

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    const channelHandler = new ChannelHandler(
      drivers,
      runtimeState.config,
      runtimeState.pluginDirs,
      runtimeState.resolveAgent,
      logger,
      ctx.memoryBackend,
    );
    const commandRegistry = new ChatCommandRegistry(createChatCommandTree());
    const commandActionsController = createFrontendCommandActionsController({
      initialRuntimeState: runtimeState,
      setRuntimeState: (nextRuntimeState: FrontendRuntimeState) => {
        runtimeState = nextRuntimeState;
      },
      channelHandler,
      memoryBackend: ctx.memoryBackend,
      reloadConfig: ctx.reloadConfig,
    });

    const outputSink = new DiscordSchedulerOutputSink(client);
    let schedulerRuntime: SchedulerRuntime | undefined;

    function hasSchedules(): boolean {
      return Object.keys(runtimeState.config.schedules).length > 0;
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
        config: runtimeState.config,
        pluginDirs: runtimeState.pluginDirs,
        resolveAgent: runtimeState.resolveAgent,
        logger,
        outputSink,
        memoryBackend: ctx.memoryBackend,
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

      schedulerRuntime.reload(
        runtimeState.config,
        runtimeState.pluginDirs,
        runtimeState.resolveAgent,
      );
    }

    async function handleCommand(message: Message): Promise<boolean> {
      const content = message.content.trim();
      if (!content.startsWith(CommandPrefixes.DISCORD)) return false;
      if (!("send" in message.channel)) return false;

      const channel = message.channel as SendableChannel;
      const channelId = message.channelId;
      const raw = content.slice(CommandPrefixes.DISCORD.length).trim();
      const isOwner =
        message.author.id === runtimeState.config.discord?.ownerId;

      try {
        const result = await commandRegistry.execute(
          {
            channelId,
            commandPrefix: CommandPrefixes.DISCORD,
            frontend: Frontends.DISCORD,
            isOwner,
            handler: channelHandler,
            actions: commandActionsController.buildActions({
              reload: async () => {
                await commandActionsController.reload();
                syncSchedulerRuntime();
                logger.info({ channel_id: channelId }, "command_reload");
                return DiscordFrontendMessages.RELOAD_COMPLETED;
              },
              listSchedules: async () => {
                const timezone = runtimeState.config.scheduler?.timezone ?? "UTC";
                const summaries = schedulerRuntime?.listSchedules() ?? [];
                return formatSchedulesMessages(
                  summaries,
                  timezone,
                  schedulerRuntime ? schedulerRuntime.isActive() : true,
                );
              },
              runSchedule: async (scheduleName: string) => {
                if (!schedulerRuntime) {
                  return formatUnknownScheduleMessage(scheduleName);
                }

                const result = schedulerRuntime.runSchedule(scheduleName);
                if (!result.ok) {
                  if (result.reason === "inactive") {
                    return DiscordFrontendMessages.SCHEDULER_NOT_ACTIVE;
                  }
                  if (result.reason === "already_running") {
                    return formatScheduleAlreadyRunningMessage(scheduleName);
                  }
                  return formatUnknownScheduleMessage(scheduleName);
                }

                return formatTriggeredScheduleMessage(scheduleName, result.runId);
              },
            }),
          },
          raw,
        );

        if (result === null) {
          await channel.send(formatUnknownCommandMessage(raw));
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
          default_driver: runtimeState.config.defaultDriver,
          default_agent: runtimeState.config.defaultAgent,
          owner_id: runtimeState.config.discord?.ownerId,
          guild_filter: runtimeState.config.discord?.guildId,
        },
        "bot_ready",
      );
    });

    client.on("messageCreate", async (message: Message) => {
      if (message.author.bot) return;

      if (
        runtimeState.config.discord?.guildId &&
        message.guildId !== runtimeState.config.discord.guildId
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
      const { sessionChannelId, settingsChannelId, bootstrapPrompt } =
        await resolveMessageScope(message, channelHandler, logger);

      await channel.sendTyping();

      const typingInterval = setInterval(() => {
        channel.sendTyping().catch(() => {});
      }, 8_000);

      const toolsSeen = new Set<string>();
      const responseText = await channelHandler.handleMessage(
        sessionChannelId,
        message.content,
        (event) => {
          channel.sendTyping().catch(() => {});
          if (event.type === "tool_use" && !toolsSeen.has(event.tool)) {
            toolsSeen.add(event.tool);
            channel.send(`Using ${event.tool}...`).catch(() => {});
          }
        },
        {
          settingsChannelId,
          bootstrapPrompt,
        },
      );

      clearInterval(typingInterval);

      const text = responseText.trim() ? responseText : "(no response)";

      logger.info(
        {
          message_id: message.id,
          channel_id: channelId,
          driver: channelHandler.resolveDriverName(
            sessionChannelId,
            settingsChannelId,
          ),
          response_length: text.length,
        },
        "response_sent",
      );

      await sendText(message.channel, text);
    });

    ensureSchedulerRuntime();

    const token = runtimeState.config.secrets.require("DISCORD_BOT_TOKEN");
    await client.login(token);
  }
}
