# Discord Bot Setup

Step-by-step guide to creating a Discord bot and connecting it to pug-claw.

## 1. Create a Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it (e.g., "pug-claw") and click **Create**

## 2. Create the bot user

1. In your application, go to the **Bot** tab
2. Click **Add Bot** (if not already created)
3. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required — pug-claw reads message text)
4. Optionally disable **Public Bot** if you don't want others to invite it

## 3. Get the bot token

1. On the **Bot** tab, click **Reset Token**
2. Copy the token
3. Add it to your `.env` file:

```
DISCORD_BOT_TOKEN=your-token-here
```

> Never commit this token or share it publicly. If compromised, reset it immediately in the Developer Portal.

## 4. Invite the bot to your server

1. Go to the **OAuth2** tab
2. Under **OAuth2 URL Generator**, select scopes:
   - `bot`
3. Under **Bot Permissions**, select:
   - Send Messages
   - Read Message History
   - View Channels
4. Copy the generated URL and open it in your browser
5. Select the server you want to add the bot to and click **Authorize**

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
