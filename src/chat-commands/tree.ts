import type {
  ChatCommandContext,
  ChatCommandNode,
  ChatCommandResult,
} from "./types.ts";

function text(
  message: string,
  action?: ChatCommandResult["action"],
): ChatCommandResult {
  return { message, action };
}

function formatCodeList(values: string[]): string {
  if (values.length === 0) {
    return "(none)";
  }
  return values.map((value) => `\`${value}\``).join(", ");
}

function formatModelAliases(aliases: Record<string, string>): string {
  const entries = Object.entries(aliases).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) {
    return "(none configured)";
  }
  return entries.map(([key, value]) => `\`${key}\` → ${value}`).join("\n");
}

function unknownSubcommand(
  ctx: ChatCommandContext,
  path: string[],
  args: string[],
): ChatCommandResult {
  return text(`Unknown command \`${ctx.formatCommand([...path, ...args])}\`.`);
}

function showOrUnknown(
  ctx: ChatCommandContext,
  path: string[],
  args: string[],
): ChatCommandResult {
  if (args.length === 0) {
    return text(ctx.formatHelp(path));
  }
  return unknownSubcommand(ctx, path, args);
}

export function createChatCommandTree(): ChatCommandNode {
  return {
    name: "root",
    description: "Chat commands",
    children: {
      agent: {
        name: "agent",
        description: "Inspect and change the active agent",
        children: {
          list: {
            name: "list",
            description: "List available agents",
            execute: async (ctx) => {
              const available = formatCodeList(
                ctx.handler.getAvailableAgentNames(),
              );
              return text(`Available agents: ${available}`);
            },
          },
          set: {
            name: "set",
            description: "Switch agent (resets session)",
            usage: "agent set <name>",
            execute: async (ctx, args) => {
              const agentName = args.join(" ").trim();
              if (!agentName) {
                return text(ctx.formatHelp(["agent", "set"]));
              }
              const ok = await ctx.handler.setAgentOverride(
                ctx.channelId,
                agentName,
              );
              if (!ok) {
                return text(
                  `Unknown agent \`${agentName}\`. No agent with SYSTEM.md found at \`agents/${agentName}/\`.`,
                );
              }
              return text(`Agent switched to \`${agentName}\`. Session reset.`);
            },
          },
          show: {
            name: "show",
            description: "Show the current agent",
            execute: async (ctx) => {
              const current = ctx.handler.resolveAgentName(ctx.channelId);
              const available = formatCodeList(
                ctx.handler.getAvailableAgentNames(),
              );
              return text(
                `Current agent: \`${current}\`\nAvailable: ${available}`,
              );
            },
          },
          skills: {
            name: "skills",
            description: "List skills for the current agent",
            execute: async (ctx) => {
              const { agentName, skills } = ctx.handler.getAgentSkills(
                ctx.channelId,
              );
              if (skills.length === 0) {
                return text(`No skills found for agent \`${agentName}\`.`);
              }
              const lines = [`**Skills for agent \`${agentName}\`:**`];
              for (const skill of skills) {
                lines.push(`- **${skill.name}**: ${skill.description}`);
              }
              return text(lines.join("\n"));
            },
          },
        },
        execute: async (ctx, args) => showOrUnknown(ctx, ["agent"], args),
      },
      driver: {
        name: "driver",
        description: "Inspect and change the active driver",
        children: {
          list: {
            name: "list",
            description: "List available drivers",
            execute: async (ctx) => {
              const available = formatCodeList(
                ctx.handler.getAvailableDriverNames(),
              );
              return text(`Available drivers: ${available}`);
            },
          },
          set: {
            name: "set",
            description: "Switch driver (resets session)",
            usage: "driver set <name>",
            execute: async (ctx, args) => {
              const driverName = args.join(" ").trim();
              if (!driverName) {
                return text(ctx.formatHelp(["driver", "set"]));
              }
              const ok = await ctx.handler.setDriverOverride(
                ctx.channelId,
                driverName,
              );
              if (!ok) {
                const available = formatCodeList(
                  ctx.handler.getAvailableDriverNames(),
                );
                return text(
                  `Unknown driver \`${driverName}\`. Available: ${available}`,
                );
              }
              return text(
                `Driver switched to \`${driverName}\`. Session reset.`,
              );
            },
          },
          show: {
            name: "show",
            description: "Show the current driver",
            execute: async (ctx) => {
              const current = ctx.handler.resolveDriverName(ctx.channelId);
              const available = formatCodeList(
                ctx.handler.getAvailableDriverNames(),
              );
              return text(
                `Current driver: \`${current}\`\nAvailable: ${available}`,
              );
            },
          },
        },
        execute: async (ctx, args) => showOrUnknown(ctx, ["driver"], args),
      },
      help: {
        name: "help",
        description: "Show available commands",
        usage: "help [command]",
        execute: async (ctx, args) =>
          text(ctx.formatHelp(args.map((arg) => arg.toLowerCase()))),
      },
      model: {
        name: "model",
        description: "Inspect and change the active model",
        children: {
          list: {
            name: "list",
            description: "List available model aliases",
            execute: async (ctx) => {
              const aliases = ctx.handler.getAvailableModelAliases(
                ctx.channelId,
              );
              return text(
                `Available aliases:\n${formatModelAliases(aliases)}\n\nOr use a raw model ID.`,
              );
            },
          },
          set: {
            name: "set",
            description: "Switch model (resets session)",
            usage: "model set <name>",
            execute: async (ctx, args) => {
              const modelInput = args.join(" ").trim();
              if (!modelInput) {
                return text(ctx.formatHelp(["model", "set"]));
              }
              const model = await ctx.handler.setModelOverride(
                ctx.channelId,
                modelInput,
              );
              return text(`Model switched to \`${model}\`. Session reset.`);
            },
          },
          show: {
            name: "show",
            description: "Show the current model",
            execute: async (ctx) => {
              const current = ctx.handler.resolveModelName(ctx.channelId);
              const aliases = ctx.handler.getAvailableModelAliases(
                ctx.channelId,
              );
              return text(
                `Current model: \`${current}\`\nAvailable aliases:\n${formatModelAliases(aliases)}\n\nOr use a raw model ID.`,
              );
            },
          },
        },
        execute: async (ctx, args) => showOrUnknown(ctx, ["model"], args),
      },
      schedule: {
        name: "schedule",
        description: "Inspect or trigger configured schedules",
        frontends: ["discord"],
        ownerOnly: true,
        children: {
          list: {
            name: "list",
            description: "List configured schedules",
            execute: async (ctx, args) => {
              if (args.length > 0) {
                return unknownSubcommand(ctx, ["schedule", "list"], args);
              }
              const messages = await ctx.actions.listSchedules?.();
              if (!messages) {
                return text("Scheduler commands are not available.");
              }
              return {
                message: messages[0] ?? "**Schedules**\n(none configured)",
                messages,
              };
            },
          },
          run: {
            name: "run",
            description: "Manually run a configured schedule",
            usage: "schedule run <name>",
            execute: async (ctx, args) => {
              const scheduleName = args.join(" ").trim();
              if (!scheduleName) {
                return text(`Usage: \`${ctx.commandPrefix}schedule run <name>\``);
              }
              const runSchedule = ctx.actions.runSchedule;
              if (!runSchedule) {
                return text("Scheduler commands are not available.");
              }
              return text(await runSchedule(scheduleName));
            },
          },
        },
        execute: async (ctx) =>
          text(
            `Usage: \`${ctx.commandPrefix}schedule run <name>\`\nOr use \`${ctx.commandPrefix}schedule list\` to list configured schedules.`,
          ),
      },
      session: {
        name: "session",
        description: "Inspect or reset the current session",
        children: {
          new: {
            name: "new",
            description: "Start a fresh conversation",
            execute: async (ctx, args) => {
              if (args.length > 0) {
                return unknownSubcommand(ctx, ["session", "new"], args);
              }
              await ctx.handler.resetSession(ctx.channelId);
              return text(
                "Session reset. Next message starts a fresh conversation.",
              );
            },
          },
          status: {
            name: "status",
            description: "Show current driver, agent, model, and session state",
            execute: async (ctx, args) => {
              if (args.length > 0) {
                return unknownSubcommand(ctx, ["session", "status"], args);
              }
              const status = ctx.handler.getStatus(ctx.channelId);
              return text(
                `Driver: \`${status.driverName}\`\nAgent: \`${status.agentName}\`\nModel: \`${status.model}\`\nActive session: \`${status.hasSession}\``,
              );
            },
          },
        },
        execute: async (ctx, args) => showOrUnknown(ctx, ["session"], args),
      },
      system: {
        name: "system",
        description: "Reload, restart, or quit the frontend",
        children: {
          quit: {
            name: "quit",
            description: "Quit the TUI frontend",
            frontends: ["tui"],
            execute: async (ctx, args) => {
              if (args.length > 0) {
                return unknownSubcommand(ctx, ["system", "quit"], args);
              }
              return text("Quitting...", "quit");
            },
          },
          reload: {
            name: "reload",
            description: "Reload config, agents, and skills from disk",
            ownerOnly: true,
            execute: async (ctx, args) => {
              if (args.length > 0) {
                return unknownSubcommand(ctx, ["system", "reload"], args);
              }
              const message = await ctx.actions.reload();
              return text(
                message ??
                  "Config, agents, and skills reloaded. All sessions reset.",
              );
            },
          },
          restart: {
            name: "restart",
            description: "Restart the frontend process",
            ownerOnly: true,
            execute: async (ctx, args) => {
              if (args.length > 0) {
                return unknownSubcommand(ctx, ["system", "restart"], args);
              }
              return text("Restarting...", "restart");
            },
          },
        },
        execute: async (ctx, args) => showOrUnknown(ctx, ["system"], args),
      },
    },
  };
}
