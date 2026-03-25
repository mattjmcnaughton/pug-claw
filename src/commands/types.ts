export const CommandExitCodes = {
  SUCCESS: 0,
  FAILURE: 1,
} as const;

export type CommandResult =
  | {
      status: "success";
      exitCode: typeof CommandExitCodes.SUCCESS;
    }
  | {
      status: "cancelled";
      exitCode: typeof CommandExitCodes.SUCCESS;
    }
  | {
      status: "error";
      exitCode: typeof CommandExitCodes.FAILURE;
    };

export const CommandResults = {
  success: {
    status: "success",
    exitCode: CommandExitCodes.SUCCESS,
  } as const,
  cancelled: {
    status: "cancelled",
    exitCode: CommandExitCodes.SUCCESS,
  } as const,
  error: {
    status: "error",
    exitCode: CommandExitCodes.FAILURE,
  } as const,
};
