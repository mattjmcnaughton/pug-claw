# Discord Bot Setup

Step-by-step guide to creating a Discord bot and connecting it to pug-claw.

## 1. Create a Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it (e.g., "pug-claw") and click **Create**

## 2. Configure the bot

1. In your application, go to the **Bot** tab
2. Click **Reset Token**, copy the token, and add it to your `.env` file:

```
DISCORD_BOT_TOKEN=your-token-here
```

> Never commit this token or share it publicly. If compromised, reset it immediately in the Developer Portal.

3. Ensure **Public Bot** is enabled
4. Under **Privileged Gateway Intents**, enable all three:
   - **Presence Intent**
   - **Server Members Intent**
   - **Message Content Intent** (required — pug-claw reads message text)

## 3. Invite the bot to your server

1. Go to the **OAuth2** tab
2. Under **Scopes**, select `bot`
3. Under **Bot Permissions**, select:
   - **General Permissions:** Manage Roles, Manage Channels, View Channels, Manage Events, Create Events, Manage Expressions, Create Expressions
   - **Text Permissions:** Send Messages, Create Public Threads, Create Private Threads, Send Messages in Threads, Manage Messages, Pin Messages, Manage Threads, Embed Links, Attach Files, Read Message History, Mention Everyone, Add Reactions, Create Polls, Send Voice Messages
4. Under **Integration Type**, select **Guild Install**
5. Copy the **Generated URL** and open it in your browser
6. Select the server you want to add the bot to and click **Authorize**

## 4. Lock down the bot

Once the bot has been invited to your server, go back to the **Bot** tab and disable **Public Bot** to prevent others from inviting it.

## 5. Verify

Start pug-claw and check the logs for a `bot_ready` event showing your bot's tag and the guilds it has joined:

```bash
bun start
```

Send a message in any channel the bot can see. It should respond.

## Required gateway intents

| Intent | Why |
|--------|-----|
| Guilds | Track which servers the bot is in |
| Guild Messages | Receive messages in server channels |
| Presence | Receive presence update events (privileged) |
| Server Members | Receive events for guild member updates (privileged) |
| Message Content | Read the text content of messages (privileged) |

## Troubleshooting

**Bot comes online but doesn't respond:**
- Verify **Message Content Intent** is enabled in the Developer Portal
- Check that the bot has permission to read and send messages in the channel
- Look at the logs for errors

**"Missing Access" errors:**
- Re-invite the bot with the correct permissions using the OAuth2 URL generator

**Token errors:**
- Ensure `DISCORD_BOT_TOKEN` is set in your `.env` file
- If the token was recently reset, make sure you're using the new one
