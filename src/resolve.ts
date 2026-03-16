export interface ResolutionInputs {
  runtimeOverride?: string;
  channelConfig?: string;
  agentFrontmatter?: string;
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
  runtimeOverride?: string;
  channelConfig?: string;
  agentFrontmatter?: string;
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
