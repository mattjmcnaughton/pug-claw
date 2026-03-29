import { AcpxClient } from "./acpx.ts";
import { ProcessSshExecutor } from "./ssh.ts";
import { TmuxClient } from "./tmux.ts";
import type {
  CodingConfig,
  CodingSessionInfo,
  CodingSessionRef,
  CodingStatus,
  CodingSubmitOptions,
  ExecResult,
  SshExecutor,
  TmuxSession,
} from "./types.ts";

interface CodingClientDeps {
  ssh: SshExecutor;
  tmux: TmuxClient;
  acpx: AcpxClient;
}

export class CodingClient {
  private readonly ssh: SshExecutor;
  private readonly tmux: TmuxClient;
  private readonly acpx: AcpxClient;

  constructor(deps: CodingClientDeps) {
    this.ssh = deps.ssh;
    this.tmux = deps.tmux;
    this.acpx = deps.acpx;
  }

  // --- Layer 1: SSH execution ---

  async exec(command: string): Promise<ExecResult> {
    return this.ssh.exec(command);
  }

  // --- Layer 2: tmux ---

  async tmuxStart(name: string, command: string): Promise<void> {
    return this.tmux.start(name, command);
  }

  async tmuxRead(name: string, lines?: number): Promise<string> {
    return this.tmux.read(name, lines);
  }

  async tmuxSend(name: string, keys: string): Promise<void> {
    return this.tmux.send(name, keys);
  }

  async tmuxList(): Promise<TmuxSession[]> {
    return this.tmux.list();
  }

  async tmuxKill(name: string): Promise<void> {
    return this.tmux.kill(name);
  }

  // --- Layer 3: acpx ---

  async codingSubmit(options: CodingSubmitOptions): Promise<string> {
    return this.acpx.submit(options);
  }

  async codingStatus(options: CodingSessionRef): Promise<CodingStatus> {
    return this.acpx.status(options);
  }

  async codingResult(options: CodingSessionRef): Promise<string> {
    return this.acpx.result(options);
  }

  async codingCancel(options: CodingSessionRef): Promise<void> {
    return this.acpx.cancel(options);
  }

  async codingSessions(agent?: string): Promise<CodingSessionInfo[]> {
    return this.acpx.sessions(agent);
  }

  async clone(url: string, path?: string): Promise<string> {
    return this.acpx.clone(url, path);
  }
}

export function createCodingClient(config: CodingConfig): CodingClient {
  const ssh = new ProcessSshExecutor(config.vmHost, config.sshUser);
  const tmux = new TmuxClient(ssh);
  const acpx = new AcpxClient(ssh);
  return new CodingClient({ ssh, tmux, acpx });
}
