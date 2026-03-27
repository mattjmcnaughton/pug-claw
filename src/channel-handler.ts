import { resolve } from "node:path";
import {
  listAvailableAgents,
  parseAgentSystemMd,
  resolveAgentDir,
} from "./agents.ts";
import type { Driver, DriverEventCallback } from "./drivers/types.ts";
import { buildMemoryBlockForAgent } from "./memory/injection.ts";
import {
  buildMemoryToolInstructions,
  type MemoryToolContext,
} from "./memory/tools.ts";
import type { MemoryBackend } from "./memory/types.ts";
import type { Logger } from "./logger.ts";
import {
  resolveDriverName as resolveDriverNameFromInputs,
  resolveModelName as resolveModelNameFromInputs,
} from "./resolve.ts";
import { expandTilde, getChannelConfig, toError } from "./resources.ts";
import type { ResolvedConfig } from "./resources.ts";
import type { ResolvedAgent, SkillSummary } from "./skills.ts";
import { discoverSkills } from "./skills.ts";

export interface ChannelState {
  driverOverride?: string | undefined;
  modelOverride?: string | undefined;
  agentOverride?: string | undefined;
  sessionId?: string | undefined;
  sessionDriverName?: string | undefined;
  resolvedAgentName?: string | undefined;
  resolvedAgent?: ResolvedAgent | undefined;
}

export interface HandleMessageOptions {
  settingsChannelId?: string | undefined;
  bootstrapPrompt?: string | undefined;
}

export class ChannelHandler {
  private channels = new Map<string, ChannelState>();

  constructor(
    private drivers: Record<string, Driver>,
    private config: ResolvedConfig,
    private pluginDirs: Map<string, string>,
    private resolveAgentFn: (agentDir: string) => ResolvedAgent,
    private logger: Logger,
    private memoryBackend?: MemoryBackend,
  ) {}

  private getState(channelId: string): ChannelState {
    let state = this.channels.get(channelId);
    if (!state) {
      state = {};
      this.channels.set(channelId, state);
    }
    return state;
  }

  private getResolvedAgent(
    channelId: string,
    settingsChannelId = channelId,
  ): ResolvedAgent {
    const agentName = this.resolveAgentName(channelId, settingsChannelId);
    const state = this.getState(channelId);
    if (state.resolvedAgent && state.resolvedAgentName === agentName) {
      return state.resolvedAgent;
    }
    const agentDir = resolve(this.config.agentsDir, agentName);
    const resolved = this.resolveAgentFn(agentDir);
    state.resolvedAgentName = agentName;
    state.resolvedAgent = resolved;
    return resolved;
  }

  private resolveOverride(
    channelId: string,
    settingsChannelId: string,
    key: "driverOverride" | "modelOverride" | "agentOverride",
  ): string | undefined {
    const channelOverride = this.getState(channelId)[key];
    if (channelOverride !== undefined) {
      return channelOverride;
    }

    if (settingsChannelId !== channelId) {
      return this.getState(settingsChannelId)[key];
    }

    return undefined;
  }

  resolveDriverName(channelId: string, settingsChannelId = channelId): string {
    const resolved = this.getResolvedAgent(channelId, settingsChannelId);
    return resolveDriverNameFromInputs({
      runtimeOverride: this.resolveOverride(
        channelId,
        settingsChannelId,
        "driverOverride",
      ),
      channelConfig: getChannelConfig(this.config, settingsChannelId).driver,
      agentFrontmatter: resolved.driver,
      globalDefault: this.config.defaultDriver,
    });
  }

  private resolveDriver(
    channelId: string,
    settingsChannelId = channelId,
  ): Driver {
    const name = this.resolveDriverName(channelId, settingsChannelId);
    const driver = this.drivers[name];
    if (!driver) throw new Error(`Unknown driver: ${name}`);
    return driver;
  }

  getAvailableDriverNames(): string[] {
    return Object.keys(this.drivers).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  getAvailableModelAliases(
    channelId: string,
    settingsChannelId = channelId,
  ): Record<string, string> {
    return this.resolveDriver(channelId, settingsChannelId).availableModels;
  }

  getAvailableAgentNames(): string[] {
    return listAvailableAgents(this.config.agentsDir);
  }

  resolveAgentName(channelId: string, settingsChannelId = channelId): string {
    return (
      this.resolveOverride(channelId, settingsChannelId, "agentOverride") ??
      getChannelConfig(this.config, settingsChannelId).agent ??
      this.config.defaultAgent
    );
  }

  resolveModelName(channelId: string, settingsChannelId = channelId): string {
    const resolved = this.getResolvedAgent(channelId, settingsChannelId);
    const driver = this.resolveDriver(channelId, settingsChannelId);
    const channelCfg = getChannelConfig(this.config, settingsChannelId);
    return resolveModelNameFromInputs({
      runtimeOverride: this.resolveOverride(
        channelId,
        settingsChannelId,
        "modelOverride",
      ),
      channelConfig: channelCfg.model,
      agentFrontmatter: resolved.model,
      driverDefault: driver.defaultModel,
    });
  }

  private getMemoryToolContext(
    channelId: string,
    settingsChannelId = channelId,
  ): MemoryToolContext | undefined {
    if (!this.memoryBackend || !this.config.memory.enabled) {
      return undefined;
    }

    const resolved = this.getResolvedAgent(channelId, settingsChannelId);
    if (!resolved.memory) {
      return undefined;
    }

    const agentName = this.resolveAgentName(channelId, settingsChannelId);
    return {
      memoryBackend: this.memoryBackend,
      actor: {
        type: "agent",
        agentName,
        createdBy: `agent:${agentName}`,
        source: "agent",
      },
    };
  }

  private async buildMemoryBlock(
    channelId: string,
    settingsChannelId = channelId,
  ): Promise<string | undefined> {
    const memoryToolContext = this.getMemoryToolContext(
      channelId,
      settingsChannelId,
    );
    if (!memoryToolContext) {
      return undefined;
    }

    const memoryBlock = await buildMemoryBlockForAgent(
      memoryToolContext.memoryBackend,
      memoryToolContext.actor.agentName ??
        this.resolveAgentName(channelId, settingsChannelId),
      this.config.memory.injectionBudgetTokens,
    );

    return memoryBlock || undefined;
  }

  async ensureSession(
    channelId: string,
    settingsChannelId = channelId,
  ): Promise<string> {
    const state = this.getState(channelId);
    if (state.sessionId) return state.sessionId;

    const driver = this.resolveDriver(channelId, settingsChannelId);
    const resolved = this.getResolvedAgent(channelId, settingsChannelId);
    const model = this.resolveModelName(channelId, settingsChannelId);
    const tools = getChannelConfig(this.config, settingsChannelId).tools;
    const agentName = this.resolveAgentName(channelId, settingsChannelId);
    const driverName = this.resolveDriverName(channelId, settingsChannelId);
    const driverCwd = this.config.drivers[driverName]?.cwd;
    const cwd = driverCwd
      ? resolve(expandTilde(driverCwd))
      : this.config.homeDir;
    const memoryToolContext = this.getMemoryToolContext(
      channelId,
      settingsChannelId,
    );
    const memoryBlock = await this.buildMemoryBlock(
      channelId,
      settingsChannelId,
    );
    const systemPrompt = memoryToolContext
      ? `${resolved.systemPrompt}\n\n${buildMemoryToolInstructions()}`
      : resolved.systemPrompt;

    const sessionId = await driver.createSession({
      systemPrompt,
      model,
      tools,
      skills: resolved.skills,
      memoryBlock,
      memoryToolContext,
      pluginDir: this.pluginDirs.get(agentName),
      cwd,
      timezone: this.config.timezone,
    });
    state.sessionId = sessionId;
    state.sessionDriverName = driverName;
    return sessionId;
  }

  async destroySession(channelId: string): Promise<void> {
    const state = this.getState(channelId);
    if (state.sessionId) {
      const driverName =
        state.sessionDriverName ?? this.resolveDriverName(channelId);
      const driver = this.drivers[driverName];
      if (!driver) {
        throw new Error(`Unknown driver: ${driverName}`);
      }
      await driver.destroySession(state.sessionId);
      state.sessionId = undefined;
      state.sessionDriverName = undefined;
    }
  }

  async destroyAllSessions(): Promise<void> {
    for (const channelId of this.channels.keys()) {
      await this.destroySession(channelId);
    }
  }

  async reload(
    config: ResolvedConfig,
    pluginDirs: Map<string, string>,
    resolveAgentFn: (agentDir: string) => ResolvedAgent,
  ): Promise<void> {
    this.config = config;
    this.pluginDirs = pluginDirs;
    this.resolveAgentFn = resolveAgentFn;
    // Clear cached resolved agents
    for (const state of this.channels.values()) {
      state.resolvedAgentName = undefined;
      state.resolvedAgent = undefined;
    }
    await this.destroyAllSessions();
  }

  async resetSession(channelId: string): Promise<void> {
    await this.destroySession(channelId);
    this.logger.info({ channel_id: channelId }, "command_new");
  }

  async setDriverOverride(
    channelId: string,
    driverName: string,
  ): Promise<boolean> {
    if (!this.drivers[driverName]) {
      return false;
    }
    const state = this.getState(channelId);
    state.driverOverride = driverName;
    state.modelOverride = undefined;
    state.resolvedAgentName = undefined;
    state.resolvedAgent = undefined;
    await this.destroySession(channelId);
    this.logger.info(
      { channel_id: channelId, driver: driverName },
      "command_driver",
    );
    return true;
  }

  async setModelOverride(
    channelId: string,
    modelInput: string,
  ): Promise<string> {
    const driver = this.resolveDriver(channelId);
    const model =
      driver.availableModels[modelInput.toLowerCase()] ?? modelInput;
    const state = this.getState(channelId);
    state.modelOverride = model;
    await this.destroySession(channelId);
    this.logger.info({ channel_id: channelId, model }, "command_model");
    return model;
  }

  async setAgentOverride(
    channelId: string,
    agentName: string,
  ): Promise<boolean> {
    const agentDir = resolveAgentDir(this.config.agentsDir, agentName);
    if (!agentDir) {
      return false;
    }
    const state = this.getState(channelId);
    state.agentOverride = agentName;
    state.resolvedAgentName = undefined;
    state.resolvedAgent = undefined;
    await this.destroySession(channelId);
    this.logger.info(
      { channel_id: channelId, agent: agentName },
      "command_agent",
    );
    return true;
  }

  getAgentSkills(channelId: string): {
    agentName: string;
    skills: SkillSummary[];
  } {
    const agentName = this.resolveAgentName(channelId);
    const agentDir = resolve(this.config.agentsDir, agentName);
    const parsed = parseAgentSystemMd(agentDir);
    const skills = discoverSkills(
      agentDir,
      this.config.skillsDir,
      parsed.meta.allowedSkills,
    );
    return { agentName, skills };
  }

  getStatus(channelId: string): {
    driverName: string;
    model: string;
    agentName: string;
    hasSession: boolean;
  } {
    return {
      driverName: this.resolveDriverName(channelId),
      model: this.resolveModelName(channelId),
      agentName: this.resolveAgentName(channelId),
      hasSession: !!this.getState(channelId).sessionId,
    };
  }

  hasSession(channelId: string): boolean {
    return !!this.channels.get(channelId)?.sessionId;
  }

  async handleMessage(
    channelId: string,
    prompt: string,
    onEvent?: DriverEventCallback,
    options: HandleMessageOptions = {},
  ): Promise<string> {
    try {
      const settingsChannelId = options.settingsChannelId ?? channelId;
      const state = this.getState(channelId);
      const hadSession = !!state.sessionId;
      const sessionId = await this.ensureSession(channelId, settingsChannelId);
      const driverName =
        this.getState(channelId).sessionDriverName ??
        this.resolveDriverName(channelId, settingsChannelId);
      const driver = this.drivers[driverName];
      if (!driver) {
        throw new Error(`Unknown driver: ${driverName}`);
      }
      const bootstrapPrompt = options.bootstrapPrompt?.trim();
      const queryPrompt =
        !hadSession && bootstrapPrompt
          ? `${bootstrapPrompt}\n\nUser message:\n${prompt}`
          : prompt;
      const response = await driver.query(sessionId, queryPrompt, onEvent);
      return response.text;
    } catch (err) {
      const error = toError(err);
      this.logger.error({ err: error, channel_id: channelId }, "query_error");
      return error.message;
    }
  }
}
