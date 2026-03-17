#!/usr/bin/env python3
"""Discord bot CLI for reading server data via discord.py."""

import asyncio
import json
import os
import sys

import discord


DISCORD_BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN")

if not DISCORD_BOT_TOKEN:
    print(json.dumps({"success": False, "error": "DISCORD_BOT_TOKEN not set"}))
    sys.exit(1)


def parse_args(args: list[str]) -> dict[str, str]:
    parsed = {}
    for arg in args:
        if arg.startswith("--") and "=" in arg:
            key, value = arg[2:].split("=", 1)
            parsed[key] = value
    return parsed


def output(data: object) -> None:
    print(json.dumps({"success": True, "data": data}))


def error(message: str) -> None:
    print(json.dumps({"success": False, "error": message}))
    sys.exit(1)


async def with_client(fn):
    intents = discord.Intents.default()
    intents.members = True
    intents.message_content = True
    client = discord.Client(intents=intents)

    ready = asyncio.Event()

    @client.event
    async def on_ready():
        ready.set()

    await client.login(DISCORD_BOT_TOKEN)
    asyncio.ensure_future(client.connect())
    await ready.wait()
    try:
        return await fn(client)
    finally:
        await client.close()


async def main() -> None:
    if len(sys.argv) < 2:
        error("No command specified")

    command = sys.argv[1]
    opts = parse_args(sys.argv[2:])

    match command:
        case "list-channels":
            guild_id = opts.get("guild-id")
            if not guild_id:
                error("--guild-id is required")

            async def run(client: discord.Client):
                guild = await client.fetch_guild(int(guild_id))
                channels = await guild.fetch_channels()
                output([
                    {
                        "id": str(c.id),
                        "name": c.name,
                        "type": str(c.type),
                        "parentId": str(c.category_id) if c.category_id else None,
                    }
                    for c in channels
                ])

            await with_client(run)

        case "read-messages":
            channel_id = opts.get("channel-id")
            if not channel_id:
                error("--channel-id is required")
            limit = min(int(opts.get("limit", "25")), 100)
            before_id = opts.get("before")

            async def run(client: discord.Client):
                channel = await client.fetch_channel(int(channel_id))
                if not isinstance(channel, discord.abc.Messageable):
                    error("Channel not found or not text-based")
                kwargs = {"limit": limit}
                if before_id:
                    kwargs["before"] = discord.Object(id=int(before_id))
                messages = [m async for m in channel.history(**kwargs)]
                output([
                    {
                        "id": str(m.id),
                        "author": {"id": str(m.author.id), "username": m.author.name},
                        "content": m.content,
                        "timestamp": int(m.created_at.timestamp() * 1000),
                    }
                    for m in messages
                ])

            await with_client(run)

        case "list-members":
            guild_id = opts.get("guild-id")
            if not guild_id:
                error("--guild-id is required")
            limit = min(int(opts.get("limit", "100")), 1000)

            async def run(client: discord.Client):
                guild = await client.fetch_guild(int(guild_id))
                members = [m async for m in guild.fetch_members(limit=limit)]
                output([
                    {
                        "id": str(m.id),
                        "username": m.name,
                        "displayName": m.display_name,
                        "roles": [r.name for r in m.roles],
                    }
                    for m in members
                ])

            await with_client(run)

        case "get-guild":
            guild_id = opts.get("guild-id")
            if not guild_id:
                error("--guild-id is required")

            async def run(client: discord.Client):
                guild = await client.fetch_guild(int(guild_id))
                output({
                    "id": str(guild.id),
                    "name": guild.name,
                    "memberCount": guild.approximate_member_count,
                    "ownerId": str(guild.owner_id),
                    "createdAt": int(guild.created_at.timestamp() * 1000),
                })

            await with_client(run)

        case "get-channel":
            channel_id = opts.get("channel-id")
            if not channel_id:
                error("--channel-id is required")

            async def run(client: discord.Client):
                channel = await client.fetch_channel(int(channel_id))
                if not channel:
                    error("Channel not found")
                result = {
                    "id": str(channel.id),
                    "type": str(channel.type),
                }
                if hasattr(channel, "name"):
                    result["name"] = channel.name
                if hasattr(channel, "topic"):
                    result["topic"] = channel.topic
                if hasattr(channel, "category_id"):
                    result["parentId"] = str(channel.category_id) if channel.category_id else None
                output(result)

            await with_client(run)

        case _:
            error(
                f"Unknown command: {command}. "
                "Available: list-channels, read-messages, list-members, get-guild, get-channel"
            )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        error(str(e))
