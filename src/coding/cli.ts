#!/usr/bin/env bun
import { Command } from "commander";
import { toError } from "../resources.ts";
import { AcpxClient } from "./acpx.ts";
import { ProcessSshExecutor } from "./ssh.ts";
import { TmuxClient } from "./tmux.ts";

const program = new Command();

program.name("coding").description("Pug-claw coding module CLI");

program
  .command("exec")
  .description("Execute a command on a remote VM via SSH")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .requiredOption("--command <cmd>", "Command to execute")
  .option("--stdin <text>", "Text to pipe via stdin")
  .action(
    async (opts: {
      host: string;
      user: string;
      command: string;
      stdin?: string;
    }) => {
      try {
        const ssh = new ProcessSshExecutor(opts.host, opts.user);
        const result = await ssh.exec(
          opts.command,
          opts.stdin !== undefined ? { stdin: opts.stdin } : undefined,
        );

        if (result.stdout) {
          process.stdout.write(result.stdout);
        }
        if (result.stderr) {
          process.stderr.write(result.stderr);
        }
        process.exit(result.exitCode);
      } catch (err) {
        const error = toError(err);
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    },
  );

const tmuxCmd = program
  .command("tmux")
  .description("Manage tmux sessions on a remote VM");

tmuxCmd
  .command("start")
  .description("Create a named tmux session and run a command")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .requiredOption("--name <name>", "Session name")
  .requiredOption("--command <cmd>", "Command to run in the session")
  .action(
    async (opts: {
      host: string;
      user: string;
      name: string;
      command: string;
    }) => {
      try {
        const ssh = new ProcessSshExecutor(opts.host, opts.user);
        const tmux = new TmuxClient(ssh);
        await tmux.start(opts.name, opts.command);
        console.log(`Session "${opts.name}" started.`);
      } catch (err) {
        const error = toError(err);
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    },
  );

tmuxCmd
  .command("read")
  .description("Capture pane output from a tmux session")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .requiredOption("--name <name>", "Session name")
  .option("--lines <n>", "Number of lines to capture", "100")
  .action(
    async (opts: {
      host: string;
      user: string;
      name: string;
      lines: string;
    }) => {
      try {
        const ssh = new ProcessSshExecutor(opts.host, opts.user);
        const tmux = new TmuxClient(ssh);
        const output = await tmux.read(
          opts.name,
          Number.parseInt(opts.lines, 10),
        );
        process.stdout.write(output);
      } catch (err) {
        const error = toError(err);
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    },
  );

tmuxCmd
  .command("send")
  .description("Send keys/text to a running tmux session")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .requiredOption("--name <name>", "Session name")
  .requiredOption("--keys <text>", "Keys/text to send")
  .action(
    async (opts: {
      host: string;
      user: string;
      name: string;
      keys: string;
    }) => {
      try {
        const ssh = new ProcessSshExecutor(opts.host, opts.user);
        const tmux = new TmuxClient(ssh);
        await tmux.send(opts.name, opts.keys);
        console.log(`Keys sent to session "${opts.name}".`);
      } catch (err) {
        const error = toError(err);
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    },
  );

tmuxCmd
  .command("list")
  .description("List active tmux sessions")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .action(async (opts: { host: string; user: string }) => {
    try {
      const ssh = new ProcessSshExecutor(opts.host, opts.user);
      const tmux = new TmuxClient(ssh);
      const sessions = await tmux.list();
      if (sessions.length === 0) {
        console.log("No active sessions.");
      } else {
        for (const s of sessions) {
          console.log(`${s.name}  ${s.lastActivity}`);
        }
      }
    } catch (err) {
      const error = toError(err);
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

tmuxCmd
  .command("kill")
  .description("Kill a tmux session")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .requiredOption("--name <name>", "Session name")
  .action(async (opts: { host: string; user: string; name: string }) => {
    try {
      const ssh = new ProcessSshExecutor(opts.host, opts.user);
      const tmux = new TmuxClient(ssh);
      await tmux.kill(opts.name);
      console.log(`Session "${opts.name}" killed.`);
    } catch (err) {
      const error = toError(err);
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

const codingCmd = program
  .command("coding")
  .description("Manage coding sessions via acpx");

codingCmd
  .command("submit")
  .description("Submit a coding prompt")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .requiredOption("--cwd <path>", "Remote working directory")
  .requiredOption("--prompt <text>", "Prompt to send")
  .option("--agent <agent>", "Agent to use (claude, codex, pi)")
  .option("--session-name <name>", "Session name")
  .action(
    async (opts: {
      host: string;
      user: string;
      cwd: string;
      prompt: string;
      agent?: string;
      sessionName?: string;
    }) => {
      try {
        const ssh = new ProcessSshExecutor(opts.host, opts.user);
        const acpx = new AcpxClient(ssh);
        const sessionId = await acpx.submit({
          cwd: opts.cwd,
          prompt: opts.prompt,
          agent: opts.agent,
          sessionName: opts.sessionName,
        });
        console.log(sessionId);
      } catch (err) {
        const error = toError(err);
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    },
  );

codingCmd
  .command("status")
  .description("Check coding session status")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .requiredOption("--cwd <path>", "Remote working directory")
  .option("--agent <agent>", "Agent to use")
  .option("--session-name <name>", "Session name")
  .action(
    async (opts: {
      host: string;
      user: string;
      cwd: string;
      agent?: string;
      sessionName?: string;
    }) => {
      try {
        const ssh = new ProcessSshExecutor(opts.host, opts.user);
        const acpx = new AcpxClient(ssh);
        const status = await acpx.status({
          cwd: opts.cwd,
          agent: opts.agent,
          sessionName: opts.sessionName,
        });
        console.log(JSON.stringify(status));
      } catch (err) {
        const error = toError(err);
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    },
  );

codingCmd
  .command("result")
  .description("Get coding session result")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .requiredOption("--cwd <path>", "Remote working directory")
  .option("--agent <agent>", "Agent to use")
  .option("--session-name <name>", "Session name")
  .action(
    async (opts: {
      host: string;
      user: string;
      cwd: string;
      agent?: string;
      sessionName?: string;
    }) => {
      try {
        const ssh = new ProcessSshExecutor(opts.host, opts.user);
        const acpx = new AcpxClient(ssh);
        const result = await acpx.result({
          cwd: opts.cwd,
          agent: opts.agent,
          sessionName: opts.sessionName,
        });
        process.stdout.write(result);
      } catch (err) {
        const error = toError(err);
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    },
  );

codingCmd
  .command("cancel")
  .description("Cancel a coding session")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .requiredOption("--cwd <path>", "Remote working directory")
  .option("--agent <agent>", "Agent to use")
  .option("--session-name <name>", "Session name")
  .action(
    async (opts: {
      host: string;
      user: string;
      cwd: string;
      agent?: string;
      sessionName?: string;
    }) => {
      try {
        const ssh = new ProcessSshExecutor(opts.host, opts.user);
        const acpx = new AcpxClient(ssh);
        await acpx.cancel({
          cwd: opts.cwd,
          agent: opts.agent,
          sessionName: opts.sessionName,
        });
        console.log("Session cancelled.");
      } catch (err) {
        const error = toError(err);
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    },
  );

codingCmd
  .command("sessions")
  .description("List coding sessions")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .option("--agent <agent>", "Agent to use")
  .action(async (opts: { host: string; user: string; agent?: string }) => {
    try {
      const ssh = new ProcessSshExecutor(opts.host, opts.user);
      const acpx = new AcpxClient(ssh);
      const sessions = await acpx.sessions(opts.agent);
      if (sessions.length === 0) {
        console.log("No sessions found.");
      } else {
        for (const s of sessions) {
          console.log(`${s.sessionId}  ${s.agent}  ${s.status}`);
        }
      }
    } catch (err) {
      const error = toError(err);
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("clone")
  .description("Clone a git repository on a remote VM")
  .requiredOption("--host <host>", "SSH host")
  .requiredOption("--user <user>", "SSH user")
  .requiredOption("--url <url>", "Git repository URL")
  .option("--path <path>", "Destination path")
  .action(
    async (opts: {
      host: string;
      user: string;
      url: string;
      path?: string;
    }) => {
      try {
        const ssh = new ProcessSshExecutor(opts.host, opts.user);
        const acpx = new AcpxClient(ssh);
        const clonedPath = await acpx.clone(opts.url, opts.path);
        console.log(clonedPath);
      } catch (err) {
        const error = toError(err);
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    },
  );

await program.parseAsync();
