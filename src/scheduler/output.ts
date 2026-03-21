import { Limits } from "../constants.ts";

export interface SchedulerOutputSink {
  sendDiscordMessage(channelId: string, text: string): Promise<void>;
}

export function chunkMessage(text: string): string[] {
  if (!text) {
    return [""];
  }

  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += Limits.DISCORD_MESSAGE_LENGTH) {
    chunks.push(text.slice(i, i + Limits.DISCORD_MESSAGE_LENGTH));
  }
  return chunks;
}
