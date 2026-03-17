export interface DriverResponse {
  text: string;
  sessionId: string;
}

export interface DriverOptions {
  systemPrompt: string;
  model?: string;
  tools?: string[];
  skills?: import("../skills.ts").SkillSummary[];
  pluginDir?: string;
  cwd?: string;
}

export interface Driver {
  readonly name: string;
  readonly availableModels: Record<string, string>;
  readonly defaultModel: string;
  createSession(options: DriverOptions): Promise<string>;
  query(sessionId: string, prompt: string): Promise<DriverResponse>;
  destroySession(sessionId: string): Promise<void>;
}
