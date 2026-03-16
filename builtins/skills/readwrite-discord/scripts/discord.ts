#!/usr/bin/env bun
import { Client, GatewayIntentBits, ChannelType } from "discord.js";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.log(JSON.stringify({ success: false, error: "DISCORD_BOT_TOKEN not set" }));
  process.exit(1);
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match && match[1] && match[2]) {
      parsed[match[1]] = match[2];
    }
  }
  return parsed;
}

function output(data: unknown): void {
  console.log(JSON.stringify({ success: true, data }));
}

function error(message: string): void {
  console.log(JSON.stringify({ success: false, error: message }));
  process.exit(1);
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
    ],
  });

  try {
    await client.login(DISCORD_BOT_TOKEN);
    await new Promise<void>((resolve) => {
      client.once("ready", () => resolve());
    });
    return await fn(client);
  } finally {
    client.destroy();
  }
}

const command = process.argv[2];
const opts = parseArgs(process.argv.slice(3));

async function main(): Promise<void> {
  switch (command) {
    case "list-channels": {
      const guildId = opts["guild-id"];
      if (!guildId) error("--guild-id is required");
      await withClient(async (client) => {
        const guild = await client.guilds.fetch(guildId!);
        const channels = await guild.channels.fetch();
        output(
          channels
            .filter((c) => c !== null)
            .map((c) => ({
              id: c!.id,
              name: c!.name,
              type: ChannelType[c!.type],
              parentId: c!.parentId,
            }))
        );
      });
      break;
    }

    case "read-messages": {
      const channelId = opts["channel-id"];
      if (!channelId) error("--channel-id is required");
      const limit = Math.min(Number(opts["limit"] ?? "25"), 100);
      await withClient(async (client) => {
        const channel = await client.channels.fetch(channelId!);
        if (!channel || !channel.isTextBased()) error("Channel not found or not text-based");
        const messages = await (channel as any).messages.fetch({
          limit,
          ...(opts["before"] ? { before: opts["before"] } : {}),
        });
        output(
          messages.map((m: any) => ({
            id: m.id,
            author: { id: m.author.id, username: m.author.username },
            content: m.content,
            timestamp: m.createdTimestamp,
          }))
        );
      });
      break;
    }

    case "list-members": {
      const guildId = opts["guild-id"];
      if (!guildId) error("--guild-id is required");
      const limit = Math.min(Number(opts["limit"] ?? "100"), 1000);
      await withClient(async (client) => {
        const guild = await client.guilds.fetch(guildId!);
        const members = await guild.members.fetch({ limit });
        output(
          members.map((m) => ({
            id: m.id,
            username: m.user.username,
            displayName: m.displayName,
            roles: m.roles.cache.map((r) => r.name),
          }))
        );
      });
      break;
    }

    case "get-guild": {
      const guildId = opts["guild-id"];
      if (!guildId) error("--guild-id is required");
      await withClient(async (client) => {
        const guild = await client.guilds.fetch(guildId!);
        output({
          id: guild.id,
          name: guild.name,
          memberCount: guild.memberCount,
          ownerId: guild.ownerId,
          createdAt: guild.createdTimestamp,
        });
      });
      break;
    }

    case "get-channel": {
      const channelId = opts["channel-id"];
      if (!channelId) error("--channel-id is required");
      await withClient(async (client) => {
        const channel = await client.channels.fetch(channelId!);
        if (!channel) error("Channel not found");
        output({
          id: channel!.id,
          type: ChannelType[channel!.type],
          ...(("name" in channel!) ? { name: (channel as any).name } : {}),
          ...(("topic" in channel!) ? { topic: (channel as any).topic } : {}),
          ...(("parentId" in channel!) ? { parentId: (channel as any).parentId } : {}),
        });
      });
      break;
    }

    case "send-message": {
      const channelId = opts["channel-id"];
      const content = opts["content"];
      if (!channelId) error("--channel-id is required");
      if (!content) error("--content is required");
      await withClient(async (client) => {
        const channel = await client.channels.fetch(channelId!);
        if (!channel || !channel.isTextBased()) error("Channel not found or not text-based");
        const msg = await (channel as any).send(content);
        output({ id: msg.id, channelId: msg.channelId });
      });
      break;
    }

    case "create-channel": {
      const guildId = opts["guild-id"];
      const name = opts["name"];
      if (!guildId) error("--guild-id is required");
      if (!name) error("--name is required");
      await withClient(async (client) => {
        const guild = await client.guilds.fetch(guildId!);
        const channel = await guild.channels.create({
          name: name!,
          type: ChannelType.GuildText,
          ...(opts["topic"] ? { topic: opts["topic"] } : {}),
          ...(opts["category-id"] ? { parent: opts["category-id"] } : {}),
        });
        output({ id: channel.id, name: channel.name });
      });
      break;
    }

    case "modify-channel": {
      const channelId = opts["channel-id"];
      if (!channelId) error("--channel-id is required");
      await withClient(async (client) => {
        const channel = await client.channels.fetch(channelId!);
        if (!channel) error("Channel not found");
        const updated = await (channel as any).edit({
          ...(opts["name"] ? { name: opts["name"] } : {}),
          ...(opts["topic"] ? { topic: opts["topic"] } : {}),
        });
        output({ id: updated.id, name: updated.name });
      });
      break;
    }

    case "delete-channel": {
      const channelId = opts["channel-id"];
      if (!channelId) error("--channel-id is required");
      await withClient(async (client) => {
        const channel = await client.channels.fetch(channelId!);
        if (!channel) error("Channel not found");
        await (channel as any).delete();
        output({ deleted: channelId });
      });
      break;
    }

    case "add-reaction": {
      const channelId = opts["channel-id"];
      const messageId = opts["message-id"];
      const emoji = opts["emoji"];
      if (!channelId) error("--channel-id is required");
      if (!messageId) error("--message-id is required");
      if (!emoji) error("--emoji is required");
      await withClient(async (client) => {
        const channel = await client.channels.fetch(channelId!);
        if (!channel || !channel.isTextBased()) error("Channel not found or not text-based");
        const message = await (channel as any).messages.fetch(messageId);
        await message.react(emoji);
        output({ reacted: true, messageId, emoji });
      });
      break;
    }

    default:
      error(`Unknown command: ${command}. Available: list-channels, read-messages, list-members, get-guild, get-channel, send-message, create-channel, modify-channel, delete-channel, add-reaction`);
  }
}

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err));
});
