import { type Api, getModel, type Model } from "@mariozechner/pi-ai";
import {
  type AgentSession,
  AuthStorage,
  codingTools,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { logger } from "../logger.ts";
import { toError } from "../resources.ts";
import { appendSkillCatalog, buildEnvironmentBlock } from "../skills.ts";
import type {
  Driver,
  DriverEventCallback,
  DriverOptions,
  DriverResponse,
} from "./types.ts";

interface PiSession {
  session: AgentSession;
  unsubscribe: () => void;
}

export function parsePiModelString(modelStr: string): {
  provider: string;
  modelId: string;
} {
  const slashIdx = modelStr.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(
      `Pi model must be in "provider/model-id" format, got: "${modelStr}"`,
    );
  }
  return {
    provider: modelStr.slice(0, slashIdx),
    modelId: modelStr.slice(slashIdx + 1),
  };
}

export function buildPiSystemPrompt(
  basePrompt: string,
  skills?: DriverOptions["skills"],
): string {
  let systemPrompt = skills
    ? appendSkillCatalog(basePrompt, skills)
    : basePrompt;

  if (skills && skills.length > 0) {
    systemPrompt +=
      "\n\nIMPORTANT: Only use the skills listed above. " +
      "Do not search the filesystem for additional skills or capabilities beyond what is listed.";
  } else {
    systemPrompt +=
      "\n\nIMPORTANT: You have no skills loaded in this session. " +
      "Do not search the filesystem for skills or capabilities. " +
      "Respond using only your built-in knowledge and tools.";
  }

  systemPrompt += buildEnvironmentBlock();
  return systemPrompt;
}

export interface PiEventHandlerResult {
  getText: () => string;
  handleEvent: (event: { type: string; [key: string]: unknown }) => void;
}

export function createPiEventHandler(
  sessionId: string,
  onEvent?: DriverEventCallback,
): PiEventHandlerResult {
  let responseText = "";

  function handleEvent(event: { type: string; [key: string]: unknown }): void {
    if (
      event.type === "message_update" &&
      (event.assistantMessageEvent as { type: string } | undefined)?.type ===
        "text_delta"
    ) {
      responseText +=
        (event.assistantMessageEvent as { delta: string }).delta ?? "";
    } else if (event.type === "tool_execution_start") {
      logger.info(
        {
          session_id: sessionId,
          tool: event.toolName,
          tool_call_id: event.toolCallId,
          args: event.args,
        },
        "pi_tool_call_start",
      );
      onEvent?.({ type: "tool_use", tool: String(event.toolName) });
    } else if (event.type === "tool_execution_end") {
      logger.info(
        {
          session_id: sessionId,
          tool: event.toolName,
          tool_call_id: event.toolCallId,
          is_error: event.isError,
        },
        "pi_tool_call_end",
      );
    }
  }

  return {
    getText: () => responseText,
    handleEvent,
  };
}

export class PiDriver implements Driver {
  readonly name = "pi";
  readonly availableModels: Record<string, string> = {
    minimax: "openrouter/minimax/minimax-m2.5",
    gpt: "openai-codex/gpt-5.4",
  };
  readonly defaultModel: string;

  private authStorage: ReturnType<typeof AuthStorage.create>;
  private modelRegistry: ModelRegistry;
  private sessions = new Map<string, PiSession>();
  private sessionCounter = 0;

  private static readonly CODEX_PROVIDERS = new Set(["openai-codex"]);

  private constructor(defaultModel: string) {
    this.defaultModel = defaultModel;
    this.authStorage = AuthStorage.create();
    this.modelRegistry = new ModelRegistry(this.authStorage);
  }

  static async create(defaultModel?: string): Promise<PiDriver> {
    const model = defaultModel ?? "openrouter/minimax/minimax-m2.5";
    return new PiDriver(model);
  }

  private resolveModel(modelStr: string): {
    model: Model<Api>;
    provider: string;
  } {
    const { provider, modelId } = parsePiModelString(modelStr);
    // biome-ignore lint/suspicious/noExplicitAny: pi-ai uses narrow union types for provider/model params
    const model = getModel(provider as any, modelId as any);
    if (!model) {
      throw new Error(
        `Pi model not found: provider="${provider}", id="${modelId}"`,
      );
    }
    return { model, provider };
  }

  private async checkCodexAuth(provider: string): Promise<void> {
    if (!PiDriver.CODEX_PROVIDERS.has(provider)) return;

    const available = await this.modelRegistry.getAvailable();
    const hasCodexAuth = available.some(
      (m) => m.provider === provider || m.id.startsWith(provider),
    );

    if (!hasCodexAuth) {
      throw new Error(
        `OpenAI Codex OAuth credentials not found.\n` +
          `Run: pi login  (then select openai-codex)\n` +
          `Or:  cd ~/.pi/agent && bunx @mariozechner/pi-ai login openai-codex\n` +
          `Then restart the bot.`,
      );
    }
  }

  async createSession(options: DriverOptions): Promise<string> {
    const modelStr = options.model ?? this.defaultModel;
    const { model, provider } = this.resolveModel(modelStr);
    await this.checkCodexAuth(provider);

    const systemPrompt = buildPiSystemPrompt(
      options.systemPrompt,
      options.skills,
    );

    logger.info({ systemPrompt }, "pi_session_system_prompt");

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });

    const loader = new DefaultResourceLoader({
      settingsManager,
      systemPromptOverride: () => systemPrompt,
    });
    await loader.reload();

    const { session } = await createAgentSession({
      model,
      thinkingLevel: "off",
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
      resourceLoader: loader,
      tools: codingTools,
    });

    const sessionId = `pi-${++this.sessionCounter}`;

    const piSession: PiSession = {
      session,
      unsubscribe: () => {},
    };

    this.sessions.set(sessionId, piSession);
    logger.info(
      { session_id: sessionId, model: modelStr },
      "pi_session_created",
    );
    return sessionId;
  }

  async query(
    sessionId: string,
    prompt: string,
    onEvent?: DriverEventCallback,
  ): Promise<DriverResponse> {
    const piSession = this.sessions.get(sessionId);
    if (!piSession) {
      throw new Error(`Unknown Pi session: ${sessionId}`);
    }

    const handler = createPiEventHandler(sessionId, onEvent);

    const unsubscribe = piSession.session.subscribe(
      // biome-ignore lint/suspicious/noExplicitAny: Pi session event types are complex internal types
      handler.handleEvent as any,
    );

    try {
      await piSession.session.prompt(prompt);
    } catch (err) {
      logger.error(
        { err: toError(err), session_id: sessionId },
        "pi_query_error",
      );
      return { text: "Sorry, something went wrong.", sessionId };
    }

    unsubscribe();

    return { text: handler.getText(), sessionId };
  }

  async destroySession(sessionId: string): Promise<void> {
    const piSession = this.sessions.get(sessionId);
    if (piSession) {
      piSession.session.dispose();
      this.sessions.delete(sessionId);
      logger.info({ session_id: sessionId }, "pi_session_destroyed");
    }
  }
}
