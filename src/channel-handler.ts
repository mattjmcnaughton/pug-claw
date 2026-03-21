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
import type { ResolvedAgent } from "./skills.ts";
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
    private commandPrefix: string,
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

  async handleCommand(
    channelId: string,
    cmd: string,
    arg: string,
  ): Promise<string | null> {
    const p = this.commandPrefix;

    if (cmd === "new") {
      await this.destroySession(channelId);
      this.logger.info({ channel_id: channelId }, "command_new");
      return "Session reset. Next message starts a fresh conversation.";
    }

    if (cmd === "driver") {
      if (!arg) {
        const current = this.resolveDriverName(channelId);
        const available = Object.keys(this.drivers)
          .map((k) => `\`${k}\``)
          .join(", ");
        return `Current driver: \`${current}\`\nAvailable: ${available}`;
      }
      if (!this.drivers[arg]) {
        const available = Object.keys(this.drivers)
          .map((k) => `\`${k}\``)
          .join(", ");
        return `Unknown driver \`${arg}\`. Available: ${available}`;
      }
      const state = this.getState(channelId);
      state.driverOverride = arg;
      state.modelOverride = undefined;
      state.resolvedAgent = undefined;
      await this.destroySession(channelId);
      this.logger.info(
        { channel_id: channelId, driver: arg },
        "command_driver",
      );
      return `Driver switched to \`${arg}\`. Session reset.`;
    }

    if (cmd === "model") {
      const driver = this.resolveDriver(channelId);
      if (!arg) {
        const current = this.resolveModelName(channelId);
        const aliases = Object.entries(driver.availableModels)
          .map(([k, v]) => `\`${k}\` → ${v}`)
          .join("\n");
        return `Current model: \`${current}\`\nAvailable aliases:\n${aliases}\n\nOr use a raw model ID.`;
      }
      const model = driver.availableModels[arg.toLowerCase()] ?? arg;
      const state = this.getState(channelId);
      state.modelOverride = model;
      await this.destroySession(channelId);
      this.logger.info({ channel_id: channelId, model }, "command_model");
      return `Model switched to \`${model}\`. Session reset.`;
    }

    if (cmd === "agent") {
      if (!arg) {
        const current = this.resolveAgentName(channelId);
        const available = listAvailableAgents(this.config.agentsDir)
          .map((name) => `\`${name}\``)
          .join(", ");
        return `Current agent: \`${current}\`\nAvailable: ${available}`;
      }
      const agentDir = resolveAgentDir(this.config.agentsDir, arg);
      if (!agentDir) {
        return `Unknown agent \`${arg}\`. No agent with SYSTEM.md found at \`agents/${arg}/\`.`;
      }
      const state = this.getState(channelId);
      state.agentOverride = arg;
      state.resolvedAgent = undefined;
      await this.destroySession(channelId);
      this.logger.info({ channel_id: channelId, agent: arg }, "command_agent");
      return `Agent switched to \`${arg}\`. Session reset.`;
    }

    if (cmd === "skills") {
      const agentName = this.resolveAgentName(channelId);
      const agentDir = resolve(this.config.agentsDir, agentName);
      const parsed = parseAgentSystemMd(agentDir);
      const skills = discoverSkills(
        agentDir,
        this.config.skillsDir,
        parsed.meta.allowedSkills,
      );
      if (skills.length === 0) {
        return `No skills found for agent \`${agentName}\`.`;
      }
      const lines = [`**Skills for agent \`${agentName}\`:**`];
      for (const s of skills) {
        lines.push(`- **${s.name}**: ${s.description}`);
      }
      return lines.join("\n");
    }

    if (cmd === "status") {
      const driverName = this.resolveDriverName(channelId);
      const model = this.resolveModelName(channelId);
      const agentName = this.resolveAgentName(channelId);
      const hasSession = !!this.getState(channelId).sessionId;
      return `Driver: \`${driverName}\`\nAgent: \`${agentName}\`\nModel: \`${model}\`\nActive session: \`${hasSession}\``;
    }

    if (cmd === "help") {
      return (
        "**Commands:**\n" +
        `\`${p}new\` — Start a fresh conversation\n` +
        `\`${p}driver [name]\` — Show/switch driver (resets session)\n` +
        `\`${p}model [name]\` — Show/switch model (resets session)\n` +
        `\`${p}agent [name]\` — Show/switch agent (resets session)\n` +
        `\`${p}skills\` — List skills for the current agent\n` +
        `\`${p}status\` — Show current driver, agent, model, and session state\n` +
        `\`${p}help\` — Show this message`
      );
    }

    return null;
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
