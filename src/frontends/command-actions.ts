import { dryRunBackup, exportBackup } from "../backup/export.ts";
import {
  renderBackupDryRunMessage,
  renderBackupExportMessage,
} from "../backup/render.ts";
import type { ChannelHandler } from "../channel-handler.ts";
import type { ChatCommandActions } from "../chat-commands/types.ts";
import { buildMemoryCommandActions } from "../memory/actions.ts";
import type { MemoryBackend } from "../memory/types.ts";
import type { ResolvedConfig } from "../resources.ts";
import type { ResolvedAgent } from "../skills.ts";
import type { FrontendContext } from "./types.ts";

export interface FrontendRuntimeState {
  config: ResolvedConfig;
  pluginDirs: Map<string, string>;
  resolveAgent: (agentDir: string) => ResolvedAgent;
}

interface FrontendCommandActionsControllerOptions {
  initialRuntimeState: FrontendRuntimeState;
  setRuntimeState: (state: FrontendRuntimeState) => void;
  channelHandler: ChannelHandler;
  memoryBackend?: MemoryBackend | undefined;
  reloadConfig: FrontendContext["reloadConfig"];
}

export interface FrontendCommandActionsController {
  reload: () => Promise<void>;
  buildActions: (overrides?: Partial<ChatCommandActions>) => ChatCommandActions;
}

export function createFrontendCommandActionsController(
  options: FrontendCommandActionsControllerOptions,
): FrontendCommandActionsController {
  let runtimeState = options.initialRuntimeState;
  let memoryActions = buildMemoryCommandActions({
    memoryBackend: options.memoryBackend,
    config: runtimeState.config,
    resolveAgentName: (channelId: string) =>
      options.channelHandler.resolveAgentName(channelId),
    getAvailableAgentNames: () =>
      options.channelHandler.getAvailableAgentNames(),
  });

  const reload = async (): Promise<void> => {
    const reloaded = await options.reloadConfig();
    runtimeState = {
      config: reloaded.config,
      pluginDirs: reloaded.pluginDirs,
      resolveAgent: reloaded.resolveAgent,
    };
    options.setRuntimeState(runtimeState);

    await options.channelHandler.reload(
      runtimeState.config,
      runtimeState.pluginDirs,
      runtimeState.resolveAgent,
    );

    memoryActions = buildMemoryCommandActions({
      memoryBackend: options.memoryBackend,
      config: runtimeState.config,
      resolveAgentName: (channelId: string) =>
        options.channelHandler.resolveAgentName(channelId),
      getAvailableAgentNames: () =>
        options.channelHandler.getAvailableAgentNames(),
    });
  };

  const buildActions = (
    overrides: Partial<ChatCommandActions> = {},
  ): ChatCommandActions => {
    return {
      reload: async () => {
        await reload();
        return undefined;
      },
      exportBackup: async () => {
        const result = await exportBackup(runtimeState.config);
        return renderBackupExportMessage(result);
      },
      dryRunBackup: async () => {
        return renderBackupDryRunMessage(dryRunBackup(runtimeState.config));
      },
      ...memoryActions,
      ...overrides,
    };
  };

  return {
    reload,
    buildActions,
  };
}
