export interface ResolutionInputs {
  runtimeOverride?: string | undefined;
  channelConfig?: string | undefined;
  agentFrontmatter?: string | undefined;
  globalDefault: string;
}

export function resolveDriverName(inputs: ResolutionInputs): string {
  return (
    inputs.runtimeOverride ??
    inputs.channelConfig ??
    inputs.agentFrontmatter ??
    inputs.globalDefault
  );
}

export interface ModelResolutionInputs {
  runtimeOverride?: string | undefined;
  channelConfig?: string | undefined;
  agentFrontmatter?: string | undefined;
  driverDefault: string;
}

export function resolveModelName(inputs: ModelResolutionInputs): string {
  return (
    inputs.runtimeOverride ??
    inputs.channelConfig ??
    inputs.agentFrontmatter ??
    inputs.driverDefault
  );
}
