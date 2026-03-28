#!/usr/bin/env bun
import { Command } from "commander";
import { toError } from "../resources.ts";
import { ProcessSshExecutor } from "./ssh.ts";

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

await program.parseAsync();
