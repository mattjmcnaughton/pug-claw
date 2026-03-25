import type { CommandPrefix, FrontendName } from "../constants.ts";
import type { SkillSummary } from "../skills.ts";

export type ChatCommandFrontend = FrontendName;
export type ChatCommandAction = "quit" | "restart";
export type ModelAliasMap = Readonly<Record<string, string>>;

export interface ChatCommandResult {
  message: string;
  messages?: string[];
  action?: ChatCommandAction;
}

export interface ChatCommandStatus {
  driverName: string;
  model: string;
  agentName: string;
  hasSession: boolean;
}

export interface ChatCommandHandler {
  resetSession(channelId: string): Promise<void>;
  resolveDriverName(channelId: string): string;
  resolveModelName(channelId: string): string;
  resolveAgentName(channelId: string): string;
  getAvailableDriverNames(): string[];
  getAvailableModelAliases(channelId: string): ModelAliasMap;
  getAvailableAgentNames(): string[];
  getAgentSkills(channelId: string): {
    agentName: string;
    skills: SkillSummary[];
  };
  getStatus(channelId: string): ChatCommandStatus;
  setDriverOverride(channelId: string, driverName: string): Promise<boolean>;
  setModelOverride(channelId: string, modelInput: string): Promise<string>;
  setAgentOverride(channelId: string, agentName: string): Promise<boolean>;
}

export interface ChatCommandActions {
  reload(): Promise<string | undefined>;
  exportBackup?(): Promise<string>;
  dryRunBackup?(): Promise<string>;
  showMemory?(channelId: string, scopeInput?: string): Promise<string>;
  searchMemory?(channelId: string, query: string): Promise<string>;
  rememberMemory?(channelId: string, text: string): Promise<string>;
  rememberScopedMemory?(
    channelId: string,
    scopeInput: string,
    text: string,
  ): Promise<string>;
  forgetMemory?(channelId: string, idOrPrefix: string): Promise<string>;
  exportMemory?(channelId: string, scopeInput?: string): Promise<string>;
  memoryStats?(): Promise<string>;
  reindexMemory?(): Promise<string>;
  listSchedules?(): Promise<string[]>;
  runSchedule?(name: string): Promise<string>;
}

export interface ChatCommandEnvironment {
  channelId: string;
  commandPrefix: CommandPrefix;
  frontend: ChatCommandFrontend;
  isOwner: boolean;
  handler: ChatCommandHandler;
  actions: ChatCommandActions;
}

export interface ChatCommandContext extends ChatCommandEnvironment {
  formatHelp: (path?: string[]) => string;
  formatCommand: (path: string[]) => string;
  run: (path: string[], args?: string[]) => Promise<ChatCommandResult | null>;
}

export interface ChatCommandNode {
  name: string;
  description: string;
  usage?: string;
  hidden?: boolean;
  frontends?: ChatCommandFrontend[];
  ownerOnly?: boolean;
  children?: Record<string, ChatCommandNode>;
  execute?: (
    ctx: ChatCommandContext,
    args: string[],
  ) => Promise<ChatCommandResult | null>;
}
