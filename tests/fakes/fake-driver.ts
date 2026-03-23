import type {
  Driver,
  DriverEventCallback,
  DriverOptions,
  DriverResponse,
} from "../../src/drivers/types.ts";

export interface FakeSession {
  id: string;
  options: DriverOptions;
}

/**
 * A stateful fake implementing the Driver interface for testing.
 * Tracks sessions and returns scriptable responses.
 */
export class FakeDriver implements Driver {
  readonly name: string;
  readonly availableModels: Record<string, string>;
  readonly defaultModel: string;

  /** All sessions created (including destroyed ones). */
  readonly createdSessions: FakeSession[] = [];

  /** Currently active sessions. */
  private sessions = new Map<string, FakeSession>();

  /** Map prompt substrings to canned responses. Falls back to default. */
  private responseMap = new Map<string, string>();
  private defaultResponse = "fake response";

  private nextSessionId = 1;

  /** If set, createSession will reject with this error. */
  createSessionError?: Error;

  /** If set, query will reject with this error. */
  queryError?: Error;

  constructor(
    options?: Partial<{
      name: string;
      availableModels: Record<string, string>;
      defaultModel: string;
    }>,
  ) {
    this.name = options?.name ?? "fake";
    this.availableModels = options?.availableModels ?? {};
    this.defaultModel = options?.defaultModel ?? "fake-model";
  }

  /** Script a response: when prompt contains `substring`, return `response`. */
  onPrompt(substring: string, response: string): void {
    this.responseMap.set(substring, response);
  }

  /** Set the default response for prompts that don't match any scripted pattern. */
  setDefaultResponse(response: string): void {
    this.defaultResponse = response;
  }

  /** Get an active session by ID, or undefined if it was destroyed / never created. */
  getSession(sessionId: string): FakeSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Number of currently active sessions. */
  get activeSessionCount(): number {
    return this.sessions.size;
  }

  async createSession(options: DriverOptions): Promise<string> {
    if (this.createSessionError) throw this.createSessionError;
    const id = `fake-session-${this.nextSessionId++}`;
    const session: FakeSession = {
      id,
      options: {
        ...options,
        systemPrompt: options.memoryBlock
          ? `${options.systemPrompt}\n\n${options.memoryBlock}`
          : options.systemPrompt,
      },
    };
    this.sessions.set(id, session);
    this.createdSessions.push(session);
    return id;
  }

  async query(
    sessionId: string,
    prompt: string,
    _onEvent?: DriverEventCallback,
  ): Promise<DriverResponse> {
    if (this.queryError) throw this.queryError;
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    // Find first matching scripted response
    let text = this.defaultResponse;
    for (const [substring, response] of this.responseMap) {
      if (prompt.includes(substring)) {
        text = response;
        break;
      }
    }

    return { text, sessionId };
  }

  async destroySession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
