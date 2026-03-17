import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.ts";
import { appendSkillCatalog } from "../skills.ts";
import type {
  Driver,
  DriverEventCallback,
  DriverOptions,
  DriverResponse,
} from "./types.ts";

interface SessionState {
  sessionId: string;
  options: DriverOptions;
}

export class ClaudeDriver implements Driver {
  readonly name = "claude";
  readonly availableModels: Record<string, string> = {
    sonnet: "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
  };
  readonly defaultModel = "claude-sonnet-4-6";

  private sessions = new Map<string, SessionState>();

  async createSession(options: DriverOptions): Promise<string> {
    const model = options.model ?? this.defaultModel;
    const tools = options.tools ?? ["Read", "Glob", "Grep", "Bash"];

    // Skills are injected differently depending on whether a pluginDir is set.
    // With pluginDir: skills are loaded natively via Claude Code SDK plugins,
    // and we append a hint so the agent knows to use them.
    // Without: fall back to embedding the full skill catalog in the system prompt.
    let systemPrompt = options.systemPrompt;
    if (options.pluginDir && options.skills && options.skills.length > 0) {
      systemPrompt +=
        "\n\nYou have plugin skills loaded in this session. " +
        "When a task matches a skill's description, read the skill's SKILL.md for detailed instructions and use it.";
    } else if (options.skills) {
      systemPrompt = appendSkillCatalog(options.systemPrompt, options.skills);
    }

    let sessionId: string | undefined;

    // Send an initial no-op query to establish the session and capture the session ID.
    for await (const msg of query({
      prompt: "Acknowledge you are ready. Respond with only: Ready.",
      options: {
        allowedTools: tools,
        permissionMode: "bypassPermissions" as const,
        allowDangerouslySkipPermissions: true,
        model,
        systemPrompt,
        cwd: options.cwd,
        plugins: options.pluginDir
          ? [{ type: "local" as const, path: options.pluginDir }]
          : undefined,
      },
    })) {
      if (
        "type" in msg &&
        msg.type === "system" &&
        "subtype" in msg &&
        msg.subtype === "init" &&
        "session_id" in msg
      ) {
        sessionId = msg.session_id as string;
      }
    }

    if (!sessionId) {
      throw new Error("Failed to obtain Claude session ID");
    }

    this.sessions.set(sessionId, { sessionId, options });
    logger.info({ session_id: sessionId, model }, "claude_session_created");
    return sessionId;
  }

  async query(
    sessionId: string,
    prompt: string,
    onEvent?: DriverEventCallback,
  ): Promise<DriverResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown Claude session: ${sessionId}`);
    }

    const { options } = session;
    const model = options.model ?? this.defaultModel;
    const tools = options.tools ?? ["Read", "Glob", "Grep", "Bash"];

    let responseText = "";

    for await (const msg of query({
      prompt,
      options: {
        resume: sessionId,
        allowedTools: tools,
        permissionMode: "bypassPermissions" as const,
        allowDangerouslySkipPermissions: true,
        model,
        cwd: options.cwd,
      },
    })) {
      const msgType =
        "type" in msg
          ? String(msg.type)
          : "result" in msg
            ? "result"
            : "unknown";
      logger.debug({ msg_type: msgType }, "claude_sdk_message");

      if ("result" in msg) {
        responseText = msg.result;
      } else if (
        "type" in msg &&
        msg.type === "tool_progress" &&
        "tool_name" in msg
      ) {
        onEvent?.({ type: "tool_use", tool: String(msg.tool_name) });
      } else if (
        "type" in msg &&
        msg.type === "system" &&
        "subtype" in msg &&
        msg.subtype === "status" &&
        "status" in msg
      ) {
        onEvent?.({ type: "status", message: String(msg.status) });
      } else if (
        "type" in msg &&
        msg.type === "system" &&
        "subtype" in msg &&
        String(msg.subtype) === "elicitation"
      ) {
        logger.warn({ msg_type: msgType }, "claude_elicitation_message");
      }
    }

    return { text: responseText, sessionId };
  }

  async destroySession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    logger.info({ session_id: sessionId }, "claude_session_destroyed");
  }
}
