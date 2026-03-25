export interface DriverResponse {
  text: string;
  sessionId: string;
}

export interface DriverOptions {
  systemPrompt: string;
  model?: string | undefined;
  tools?: string[] | undefined;
  skills?: import("../skills.ts").SkillSummary[] | undefined;
  memoryBlock?: string | undefined;
  memoryToolContext?:
    | import("../memory/tools.ts").MemoryToolContext
    | undefined;
  pluginDir?: string | undefined;
  cwd?: string | undefined;
}

export type DriverEvent =
  | { type: "tool_use"; tool: string }
  | { type: "status"; message: string };

export type DriverEventCallback = (event: DriverEvent) => void;

export interface Driver {
  readonly name: string;
  readonly availableModels: Record<string, string>;
  readonly defaultModel: string;
  createSession(options: DriverOptions): Promise<string>;
  query(
    sessionId: string,
    prompt: string,
    onEvent?: DriverEventCallback,
  ): Promise<DriverResponse>;
  destroySession(sessionId: string): Promise<void>;
}
