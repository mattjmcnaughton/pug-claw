import { resolve } from "node:path";
import {
  CombinedAutocompleteProvider,
  Editor,
  type EditorTheme,
  Key,
  Loader,
  Markdown,
  type MarkdownTheme,
  matchesKey,
  ProcessTerminal,
  type SelectListTheme,
  Spacer,
  Text,
  TUI,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import { listAvailableAgents, resolveAgentDir } from "../agents.ts";
import type { Driver } from "../drivers/types.ts";
import { discoverSkills } from "../skills.ts";
import type { Frontend, FrontendContext } from "./types.ts";

const selectListTheme: SelectListTheme = {
  selectedPrefix: (s) => chalk.cyan(s),
  selectedText: (s) => chalk.white(s),
  description: (s) => chalk.gray(s),
  scrollInfo: (s) => chalk.gray(s),
  noMatch: (s) => chalk.gray(s),
};

const editorTheme: EditorTheme = {
  borderColor: (s) => chalk.gray(s),
  selectList: selectListTheme,
};

const markdownTheme: MarkdownTheme = {
  heading: (s) => chalk.bold.cyan(s),
  link: (s) => chalk.underline.blue(s),
  linkUrl: (s) => chalk.gray(s),
  code: (s) => chalk.yellow(s),
  codeBlock: (s) => chalk.white(s),
  codeBlockBorder: (s) => chalk.gray(s),
  quote: (s) => chalk.italic.gray(s),
  quoteBorder: (s) => chalk.gray(s),
  hr: (s) => chalk.gray(s),
  listBullet: (s) => chalk.cyan(s),
  bold: (s) => chalk.bold(s),
  italic: (s) => chalk.italic(s),
  strikethrough: (s) => chalk.strikethrough(s),
  underline: (s) => chalk.underline(s),
};

export class TuiFrontend implements Frontend {
  async start(ctx: FrontendContext): Promise<void> {
    const { drivers, logger } = ctx;
    let { config, buildSystemPrompt } = ctx;
    let agentsDir = config.agentsDir;

    let currentDriverName = config.defaultDriver;
    let currentAgentName = config.defaultAgent;
    let currentModel: string | undefined;
    let currentSessionId: string | undefined;

    function getDriver(): Driver {
      const driver = drivers[currentDriverName];
      if (!driver) throw new Error(`Unknown driver: ${currentDriverName}`);
      return driver;
    }

    async function destroySession() {
      if (currentSessionId) {
        await getDriver().destroySession(currentSessionId);
        currentSessionId = undefined;
      }
    }

    async function ensureSession(): Promise<string> {
      if (!currentSessionId) {
        const driver = getDriver();
        const agentDir = resolve(agentsDir, currentAgentName);
        const systemPrompt = buildSystemPrompt(agentDir);
        const model = currentModel ?? driver.defaultModel;

        currentSessionId = await driver.createSession({
          systemPrompt,
          model,
        });
      }
      return currentSessionId;
    }

    // --- TUI setup ---
    const terminal = new ProcessTerminal();
    const tui = new TUI(terminal);

    function makeHeaderText(): string {
      const d = getDriver();
      return (
        chalk.bold("pug-claw") +
        chalk.gray(
          ` | driver: ${currentDriverName} | model: ${currentModel ?? d.defaultModel} | agent: ${currentAgentName}`,
        )
      );
    }

    let header = new Text(makeHeaderText(), 1, 0);
    const headerSpacer = new Spacer(1);
    tui.addChild(header);
    tui.addChild(headerSpacer);

    function updateHeader() {
      const idx = tui.children.indexOf(header);
      tui.removeChild(header);
      header = new Text(makeHeaderText(), 1, 0);
      if (idx >= 0) {
        const children = [...tui.children];
        tui.removeChild(headerSpacer);
        for (const c of children) tui.removeChild(c);
        tui.addChild(header);
        tui.addChild(headerSpacer);
        for (const c of children) tui.addChild(c);
      } else {
        tui.addChild(header);
      }
      tui.requestRender();
    }

    const autocompleteProvider = new CombinedAutocompleteProvider(
      [
        { name: "new", description: "Start a fresh conversation" },
        { name: "driver", description: "Show/switch driver" },
        { name: "model", description: "Show/switch model" },
        { name: "agent", description: "Show/switch agent" },
        { name: "skills", description: "List skills for current agent" },
        { name: "status", description: "Show current state" },
        { name: "reload", description: "Reload config, agents, and skills" },
        { name: "restart", description: "Restart the process" },
        { name: "quit", description: "Exit" },
      ],
      process.cwd(),
    );

    const editor = new Editor(tui, editorTheme);
    editor.setAutocompleteProvider(autocompleteProvider);

    let loader: Loader | null = null;

    // biome-ignore lint/suspicious/noExplicitAny: pi-tui component types are not exported
    function insertBeforeEditor(component: any) {
      tui.removeChild(editor);
      tui.addChild(component);
      tui.addChild(editor);
    }

    function showInfo(text: string) {
      insertBeforeEditor(new Text(chalk.gray(text), 1, 0));
      insertBeforeEditor(new Spacer(1));
    }

    editor.onSubmit = async (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Handle slash commands
      if (trimmed.startsWith("/")) {
        const parts = trimmed.slice(1).split(/\s+/, 2);
        const cmd = parts[0]?.toLowerCase();
        const arg = parts[1]?.trim() ?? "";

        if (cmd === "quit" || cmd === "exit") {
          await destroySession();
          tui.stop();
          process.exit(0);
        }

        if (cmd === "restart") {
          logger.info("tui_command_restart");
          showInfo("Restarting...");
          tui.stop();
          process.exit(1);
        }

        if (cmd === "reload") {
          try {
            const reloaded = await ctx.reloadConfig();
            config = reloaded.config;
            buildSystemPrompt = reloaded.buildSystemPrompt;
            agentsDir = config.agentsDir;
            await destroySession();
            updateHeader();
            showInfo("Config, agents, and skills reloaded. Session reset.");
            logger.info("tui_command_reload");
          } catch (err) {
            showInfo(
              `Reload failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          return;
        }

        if (cmd === "new") {
          await destroySession();
          showInfo("Session reset. Next message starts a fresh conversation.");
          logger.info("tui_command_new");
          return;
        }

        if (cmd === "driver") {
          if (!arg) {
            const available = Object.keys(drivers)
              .map((k) => `${k}`)
              .join(", ");
            showInfo(
              `Current driver: ${currentDriverName}\nAvailable: ${available}`,
            );
            return;
          }
          if (!drivers[arg]) {
            showInfo(
              `Unknown driver: ${arg}. Available: ${Object.keys(drivers).join(", ")}`,
            );
            return;
          }
          await destroySession();
          currentDriverName = arg;
          currentModel = undefined;
          updateHeader();
          showInfo(`Driver switched to ${arg}. Session reset.`);
          logger.info({ driver: arg }, "tui_command_driver");
          return;
        }

        if (cmd === "model") {
          const d = getDriver();
          if (!arg) {
            const current = currentModel ?? d.defaultModel;
            const aliases = Object.entries(d.availableModels)
              .map(([k, v]) => `  ${k} → ${v}`)
              .join("\n");
            showInfo(
              `Current model: ${current}\nAliases:\n${aliases}\n\nOr use a raw model ID.`,
            );
            return;
          }
          const model = d.availableModels[arg.toLowerCase()] ?? arg;
          await destroySession();
          currentModel = model;
          updateHeader();
          showInfo(`Model switched to ${model}. Session reset.`);
          logger.info({ model }, "tui_command_model");
          return;
        }

        if (cmd === "agent") {
          if (!arg) {
            const available = listAvailableAgents(agentsDir).join(", ");
            showInfo(
              `Current agent: ${currentAgentName}\nAvailable: ${available}`,
            );
            return;
          }
          const agentDir = resolveAgentDir(agentsDir, arg);
          if (!agentDir) {
            showInfo(`Unknown agent: ${arg}`);
            return;
          }
          await destroySession();
          currentAgentName = arg;
          updateHeader();
          showInfo(`Agent switched to ${arg}. Session reset.`);
          logger.info({ agent: arg }, "tui_command_agent");
          return;
        }

        if (cmd === "skills") {
          const agentDir = resolve(agentsDir, currentAgentName);
          const skills = discoverSkills(agentDir);
          if (skills.length === 0) {
            showInfo(`No skills found for agent ${currentAgentName}.`);
          } else {
            const lines = [`Skills for agent ${currentAgentName}:`];
            for (const s of skills) {
              lines.push(`  ${s.name}: ${s.description}`);
            }
            showInfo(lines.join("\n"));
          }
          return;
        }

        if (cmd === "status") {
          const d = getDriver();
          const model = currentModel ?? d.defaultModel;
          showInfo(
            `Driver: ${currentDriverName}\nAgent: ${currentAgentName}\nModel: ${model}\nActive session: ${!!currentSessionId}`,
          );
          return;
        }

        showInfo(`Unknown command: /${cmd}`);
        return;
      }

      // Show user message
      const userMsg = new Text(chalk.bold.blue("you: ") + trimmed, 1, 0);
      insertBeforeEditor(userMsg);
      insertBeforeEditor(new Spacer(1));

      // Show loader
      editor.disableSubmit = true;
      loader = new Loader(
        tui,
        (s) => chalk.cyan(s),
        (s) => chalk.gray(s),
      );
      insertBeforeEditor(loader);
      loader.start();

      let responseText = "";
      try {
        const sessionId = await ensureSession();
        const response = await getDriver().query(sessionId, trimmed);
        responseText = response.text;
      } catch (err) {
        responseText = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      // Remove loader
      if (loader) {
        loader.stop();
        tui.removeChild(loader);
        loader = null;
      }

      if (!responseText.trim()) {
        responseText = "(empty response)";
      }

      const assistantLabel = new Text(chalk.bold.green("assistant:"), 1, 0);
      insertBeforeEditor(assistantLabel);

      const md = new Markdown(responseText, 1, 0, markdownTheme);
      insertBeforeEditor(md);
      insertBeforeEditor(new Spacer(1));

      editor.disableSubmit = false;
      tui.requestRender();
    };

    tui.addChild(editor);
    tui.setFocus(editor);

    tui.addInputListener((data) => {
      if (matchesKey(data, Key.ctrl("c"))) {
        destroySession().then(() => {
          tui.stop();
          process.exit(0);
        });
      }
      return undefined;
    });

    tui.start();

    // Keep the process alive
    await new Promise(() => {});
  }
}
