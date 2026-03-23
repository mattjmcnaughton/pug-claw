export interface DriverResponse {
  text: string;
  sessionId: string;
}

export interface DriverOptions {
  systemPrompt: string;
  model?: string;
  tools?: string[];
  skills?: import("../skills.ts").SkillSummary[];
  memoryBlock?: string;
  memoryToolContext?: import("../memory/tools.ts").MemoryToolContext;
  pluginDir?: string;
  cwd?: string;
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
