import { resolve } from "node:path";
import {
  listAvailableAgents,
  parseAgentSystemMd,
  resolveAgentDir,
} from "./agents.ts";
import type { Driver, DriverEventCallback } from "./drivers/types.ts";
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
  driverOverride?: string;
  modelOverride?: string;
  agentOverride?: string;
  sessionId?: string;
  resolvedAgent?: ResolvedAgent;
}

export class ChannelHandler {
  private channels = new Map<string, ChannelState>();

  constructor(
    private drivers: Record<string, Driver>,
    private config: ResolvedConfig,
    private pluginDirs: Map<string, string>,
    private resolveAgentFn: (agentDir: string) => ResolvedAgent,
    private logger: Logger,
  ) {}

  private getState(channelId: string): ChannelState {
    let state = this.channels.get(channelId);
    if (!state) {
      state = {};
      this.channels.set(channelId, state);
    }
    return state;
  }

  private getResolvedAgent(channelId: string): ResolvedAgent {
    const state = this.getState(channelId);
    if (state.resolvedAgent) return state.resolvedAgent;
    const agentName = this.resolveAgentName(channelId);
    const agentDir = resolve(this.config.agentsDir, agentName);
    const resolved = this.resolveAgentFn(agentDir);
    state.resolvedAgent = resolved;
    return resolved;
  }

  resolveDriverName(channelId: string): string {
    const resolved = this.getResolvedAgent(channelId);
    return resolveDriverNameFromInputs({
      runtimeOverride: this.getState(channelId).driverOverride,
      channelConfig: getChannelConfig(this.config, channelId).driver,
      agentFrontmatter: resolved.driver,
      globalDefault: this.config.defaultDriver,
    });
  }

  private resolveDriver(channelId: string): Driver {
    const name = this.resolveDriverName(channelId);
    const driver = this.drivers[name];
    if (!driver) throw new Error(`Unknown driver: ${name}`);
    return driver;
  }

  getAvailableDriverNames(): string[] {
    return Object.keys(this.drivers).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  getAvailableModelAliases(channelId: string): Record<string, string> {
    return this.resolveDriver(channelId).availableModels;
  }

  getAvailableAgentNames(): string[] {
    return listAvailableAgents(this.config.agentsDir);
  }

  resolveAgentName(channelId: string): string {
    return (
      this.getState(channelId).agentOverride ??
      getChannelConfig(this.config, channelId).agent ??
      this.config.defaultAgent
    );
  }

  resolveModelName(channelId: string): string {
    const resolved = this.getResolvedAgent(channelId);
    const driver = this.resolveDriver(channelId);
    const channelCfg = getChannelConfig(this.config, channelId);
    return resolveModelNameFromInputs({
      runtimeOverride: this.getState(channelId).modelOverride,
      channelConfig: channelCfg.model,
      agentFrontmatter: resolved.model,
      driverDefault: driver.defaultModel,
    });
  }

  async ensureSession(channelId: string): Promise<string> {
    const state = this.getState(channelId);
    if (state.sessionId) return state.sessionId;

    const driver = this.resolveDriver(channelId);
    const resolved = this.getResolvedAgent(channelId);
    const model = this.resolveModelName(channelId);
    const tools = getChannelConfig(this.config, channelId).tools;
    const agentName = this.resolveAgentName(channelId);
    const driverName = this.resolveDriverName(channelId);
    const driverCwd = this.config.drivers[driverName]?.cwd;
    const cwd = driverCwd
      ? resolve(expandTilde(driverCwd))
      : this.config.homeDir;

    const sessionId = await driver.createSession({
      systemPrompt: resolved.systemPrompt,
      model,
      tools,
      skills: resolved.skills,
      pluginDir: this.pluginDirs.get(agentName),
      cwd,
    });
    state.sessionId = sessionId;
    return sessionId;
  }

  async destroySession(channelId: string): Promise<void> {
    const state = this.getState(channelId);
    if (state.sessionId) {
      const driver = this.resolveDriver(channelId);
      await driver.destroySession(state.sessionId);
      state.sessionId = undefined;
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

  async handleMessage(
    channelId: string,
    prompt: string,
    onEvent?: DriverEventCallback,
  ): Promise<string> {
    try {
      const sessionId = await this.ensureSession(channelId);
      const driver = this.resolveDriver(channelId);
      const response = await driver.query(sessionId, prompt, onEvent);
      return response.text;
    } catch (err) {
      const error = toError(err);
      this.logger.error({ err: error, channel_id: channelId }, "query_error");
      return error.message;
    }
  }
}
