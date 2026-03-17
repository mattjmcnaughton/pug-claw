import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.ts";
import { appendSkillCatalog } from "../skills.ts";
import type {
  Driver,
  DriverEventCallback,
  DriverOptions,
  DriverResponse,
} from "./types.ts";

interface ResolvedSessionOptions {
  model: string;
  tools: string[];
  systemPrompt: string;
  cwd?: string;
  plugins?: { type: "local"; path: string }[];
}

interface SessionState {
  sessionId: string;
  resolved: ResolvedSessionOptions;
}

export class ClaudeDriver implements Driver {
  readonly name = "claude";
  readonly availableModels: Record<string, string> = {
    sonnet: "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
  };
  readonly defaultModel = "claude-sonnet-4-6";

  private sessions = new Map<string, SessionState>();

  private resolveSessionOptions(
    options: DriverOptions,
  ): ResolvedSessionOptions {
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

    return {
      model,
      tools,
      systemPrompt,
      cwd: options.cwd,
      plugins: options.pluginDir
        ? [{ type: "local" as const, path: options.pluginDir }]
        : undefined,
    };
  }

  private buildSdkOptions(resolved: ResolvedSessionOptions, resume?: string) {
    return {
      ...(resume ? { resume } : {}),
      allowedTools: resolved.tools,
      permissionMode: "bypassPermissions" as const,
      allowDangerouslySkipPermissions: true,
      model: resolved.model,
      systemPrompt: resolved.systemPrompt,
      cwd: resolved.cwd,
      plugins: resolved.plugins,
    };
  }

  async createSession(options: DriverOptions): Promise<string> {
    const resolved = this.resolveSessionOptions(options);

    logger.info(
      { systemPrompt: resolved.systemPrompt },
      "claude_session_system_prompt",
    );

    let sessionId: string | undefined;

    // Send an initial no-op query to establish the session and capture the session ID.
    for await (const msg of query({
      prompt: "Acknowledge you are ready. Respond with only: Ready.",
      options: this.buildSdkOptions(resolved),
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

    this.sessions.set(sessionId, { sessionId, resolved });
    logger.info(
      { session_id: sessionId, model: resolved.model },
      "claude_session_created",
    );
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

    let responseText = "";
    const toolsSeen = new Set<string>();

    for await (const msg of query({
      prompt,
      options: this.buildSdkOptions(session.resolved, sessionId),
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
        const toolUseId = "tool_use_id" in msg ? String(msg.tool_use_id) : "";
        if (toolUseId && !toolsSeen.has(toolUseId)) {
          toolsSeen.add(toolUseId);
          logger.info(
            {
              session_id: sessionId,
              tool: String(msg.tool_name),
              tool_use_id: toolUseId,
            },
            "claude_tool_call_start",
          );
        }
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
