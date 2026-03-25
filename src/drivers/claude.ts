import {
  createSdkMcpServer,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { Drivers } from "../constants.ts";
import { logger } from "../logger.ts";
import { memoryToolSchemas } from "../memory/tool-schema.ts";
import { buildFinalSystemPrompt } from "../prompt.ts";
import type {
  Driver,
  DriverEventCallback,
  DriverOptions,
  DriverResponse,
} from "./types.ts";

export interface ResolvedSessionOptions {
  model: string;
  tools: string[];
  systemPrompt: string;
  cwd?: string;
  plugins?: { type: "local"; path: string }[];
  mcpServers?: Record<string, ReturnType<typeof createSdkMcpServer>>;
}

interface SessionState {
  sessionId: string;
  resolved: ResolvedSessionOptions;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TOOLS = ["Read", "Glob", "Grep", "Bash"];

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function createMemoryMcpServer(
  memoryToolContext: NonNullable<DriverOptions["memoryToolContext"]>,
) {
  return createSdkMcpServer({
    name: "memory",
    tools: memoryToolSchemas.map((memoryTool) =>
      tool(
        memoryTool.name,
        memoryTool.description,
        memoryTool.claudeParameters,
        async (args) => {
          const result = await memoryTool.execute(memoryToolContext, args);
          const text = memoryTool.formatClaudeResult
            ? memoryTool.formatClaudeResult(result)
            : JSON.stringify(result);
          return textResult(text);
        },
      ),
    ),
  });
}

export function resolveClaudeSessionOptions(
  options: DriverOptions,
  defaultModel = DEFAULT_MODEL,
): ResolvedSessionOptions {
  const model = options.model ?? defaultModel;
  const tools = options.tools ?? DEFAULT_TOOLS;

  const systemPrompt = buildFinalSystemPrompt(options.systemPrompt, {
    skills: options.skills,
    memoryBlock: options.memoryBlock,
    pluginHint: !!options.pluginDir,
  });

  return {
    model,
    tools,
    systemPrompt,
    cwd: options.cwd,
    plugins: options.pluginDir
      ? [{ type: "local" as const, path: options.pluginDir }]
      : undefined,
    mcpServers: options.memoryToolContext
      ? {
          memory: createMemoryMcpServer(options.memoryToolContext),
        }
      : undefined,
  };
}

export function buildClaudeSdkOptions(
  resolved: ResolvedSessionOptions,
  resume?: string,
) {
  return {
    ...(resume ? { resume } : {}),
    allowedTools: resolved.tools,
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    model: resolved.model,
    systemPrompt: resolved.systemPrompt,
    cwd: resolved.cwd,
    plugins: resolved.plugins,
    mcpServers: resolved.mcpServers,
  };
}

type SdkMessage = Record<string, unknown>;

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readMessageField(msg: SdkMessage, key: string): string | undefined {
  return readString(msg[key]);
}

export interface ClaudeEventResult {
  text: string;
  sessionId?: string;
}

export async function processClaudeEvents(
  messages: AsyncIterable<SdkMessage>,
  sessionId: string,
  onEvent?: DriverEventCallback,
): Promise<ClaudeEventResult> {
  let responseText = "";
  let extractedSessionId: string | undefined;
  const toolsSeen = new Set<string>();

  for await (const msg of messages) {
    const msgTypeValue = readMessageField(msg, "type");
    const msgType = msgTypeValue ?? (readMessageField(msg, "result") ? "result" : "unknown");
    logger.debug({ msg_type: msgType }, "claude_sdk_message");

    const resultText = readMessageField(msg, "result");
    if (resultText !== undefined) {
      responseText = resultText;
    } else if (
      msgTypeValue === "system" &&
      readMessageField(msg, "subtype") === "init"
    ) {
      extractedSessionId = readMessageField(msg, "session_id");
    } else if (msgTypeValue === "tool_progress") {
      const toolName = readMessageField(msg, "tool_name");
      if (!toolName) {
        continue;
      }

      const toolUseId = readMessageField(msg, "tool_use_id") ?? "";
      if (toolUseId && !toolsSeen.has(toolUseId)) {
        toolsSeen.add(toolUseId);
        logger.info(
          {
            session_id: sessionId,
            tool: toolName,
            tool_use_id: toolUseId,
          },
          "claude_tool_call_start",
        );
      }
      onEvent?.({ type: "tool_use", tool: toolName });
    } else if (
      msgTypeValue === "system" &&
      readMessageField(msg, "subtype") === "status"
    ) {
      const statusMessage = readMessageField(msg, "status");
      if (statusMessage) {
        onEvent?.({ type: "status", message: statusMessage });
      }
    } else if (
      msgTypeValue === "system" &&
      readMessageField(msg, "subtype") === "elicitation"
    ) {
      logger.warn({ msg_type: msgType }, "claude_elicitation_message");
    }
  }

  return { text: responseText, sessionId: extractedSessionId };
}

export class ClaudeDriver implements Driver {
  readonly name = Drivers.CLAUDE;
  readonly availableModels: Record<string, string> = {
    sonnet: "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
  };
  readonly defaultModel = DEFAULT_MODEL;

  private sessions = new Map<string, SessionState>();

  async createSession(options: DriverOptions): Promise<string> {
    const resolved = resolveClaudeSessionOptions(options, this.defaultModel);

    logger.info(
      { systemPrompt: resolved.systemPrompt },
      "claude_session_system_prompt",
    );

    const result = await processClaudeEvents(
      query({
        prompt: "Acknowledge you are ready. Respond with only: Ready.",
        options: buildClaudeSdkOptions(resolved),
      }),
      "",
    );

    const sessionId = result.sessionId;
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

    const result = await processClaudeEvents(
      query({
        prompt,
        options: buildClaudeSdkOptions(session.resolved, sessionId),
      }),
      sessionId,
      onEvent,
    );

    return { text: result.text, sessionId };
  }

  async destroySession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    logger.info({ session_id: sessionId }, "claude_session_destroyed");
  }
}
