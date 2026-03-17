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
import { appendSkillCatalog } from "../skills.ts";
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

  private constructor(defaultModel: string) {
    this.defaultModel = defaultModel;
    this.authStorage = AuthStorage.create();
    this.modelRegistry = new ModelRegistry(this.authStorage);
  }

  static async create(defaultModel?: string): Promise<PiDriver> {
    const model = defaultModel ?? "openrouter/minimax/minimax-m2.5";
    return new PiDriver(model);
  }

  private static readonly CODEX_PROVIDERS = new Set(["openai-codex"]);

  private resolveModel(modelStr: string): {
    model: Model<Api>;
    provider: string;
  } {
    const slashIdx = modelStr.indexOf("/");
    if (slashIdx === -1) {
      throw new Error(
        `Pi model must be in "provider/model-id" format, got: "${modelStr}"`,
      );
    }

    const provider = modelStr.slice(0, slashIdx);
    const modelId = modelStr.slice(slashIdx + 1);
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

    // Append skill catalog to system prompt for Pi (no native plugin support)
    const systemPrompt = options.skills
      ? appendSkillCatalog(options.systemPrompt, options.skills)
      : options.systemPrompt;

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

    let responseText = "";

    const unsubscribe = piSession.session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        responseText += event.assistantMessageEvent.delta;
      } else if (event.type === "tool_execution_start" && "toolName" in event) {
        onEvent?.({ type: "tool_use", tool: String(event.toolName) });
      }
    });

    try {
      await piSession.session.prompt(prompt);
    } catch (err) {
      logger.error(
        { err: toError(err), session_id: sessionId },
        "pi_query_error",
      );
      responseText = "Sorry, something went wrong.";
    }

    unsubscribe();

    return { text: responseText, sessionId };
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
