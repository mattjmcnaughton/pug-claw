import type {
  ExecResult,
  SshExecOptions,
  SshExecutor,
} from "../../src/coding/types.ts";

export interface FakeSshCall {
  command: string;
  stdin?: string | undefined;
}

/**
 * A stateful fake implementing the SshExecutor interface for testing.
 * Records all calls and returns scripted responses.
 */
export class FakeSshExecutor implements SshExecutor {
  /** All exec() calls recorded in order. */
  readonly calls: FakeSshCall[] = [];

  /** Map command substrings to canned responses. First match wins. */
  private responseMap = new Map<string, ExecResult>();

  private _defaultResponse: ExecResult = {
    stdout: "",
    stderr: "",
    exitCode: 0,
  };

  /** Script a response: when command contains `substring`, return `response`. */
  onCommand(substring: string, response: ExecResult): void {
    this.responseMap.set(substring, response);
  }

  /** Set the default response for commands that don't match any scripted pattern. */
  setDefaultResponse(response: ExecResult): void {
    this._defaultResponse = response;
  }

  async exec(command: string, options?: SshExecOptions): Promise<ExecResult> {
    this.calls.push({
      command,
      stdin: options?.stdin,
    });

    for (const [substring, response] of this.responseMap) {
      if (command.includes(substring)) {
        return response;
      }
    }

    return this._defaultResponse;
  }
}
