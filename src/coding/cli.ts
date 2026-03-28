#!/usr/bin/env bun
import { Command } from "commander";
import { toError } from "../resources.ts";
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

await program.parseAsync();
