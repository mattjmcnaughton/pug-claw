import type { Client } from "discord.js";
import { chunkMessage, type SchedulerOutputSink } from "./output.ts";

export class DiscordSchedulerOutputSink implements SchedulerOutputSink {
  constructor(private client: Client) {}

  async sendDiscordMessage(channelId: string, text: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !("send" in channel)) {
      throw new Error(`Discord channel ${channelId} is not sendable`);
    }

    for (const chunk of chunkMessage(text)) {
      await channel.send(chunk);
    }
  }
}
