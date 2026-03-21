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
import { ChannelHandler } from "../channel-handler.ts";
import { toError } from "../resources.ts";
import type { Frontend, FrontendContext } from "./types.ts";

const TUI_CHANNEL_ID = "tui";

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
    let { config, resolveAgent, pluginDirs } = ctx;

    const channelHandler = new ChannelHandler(
      drivers,
      config,
      pluginDirs,
      resolveAgent,
      logger,
      "/",
    );

    // --- TUI setup ---
    const terminal = new ProcessTerminal();
    const tui = new TUI(terminal);

    function makeHeaderText(): string {
      const effectiveDriver = channelHandler.resolveDriverName(TUI_CHANNEL_ID);
      const effectiveModel = channelHandler.resolveModelName(TUI_CHANNEL_ID);
      const agentName = channelHandler.resolveAgentName(TUI_CHANNEL_ID);
      return (
        chalk.bold("pug-claw") +
        chalk.gray(
          ` | driver: ${effectiveDriver} | model: ${effectiveModel} | agent: ${agentName}`,
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
        const cmd = parts[0]?.toLowerCase() ?? "";
        const arg = parts[1]?.trim() ?? "";

        // Frontend-specific commands
        if (cmd === "quit" || cmd === "exit") {
          await channelHandler.destroySession(TUI_CHANNEL_ID);
          tui.stop();
          process.exit(0);
        }

        if (cmd === "restart") {
          logger.info({}, "tui_command_restart");
          showInfo("Restarting...");
          tui.stop();
          process.exit(1);
        }

        if (cmd === "reload") {
          try {
            const reloaded = await ctx.reloadConfig();
            config = reloaded.config;
            resolveAgent = reloaded.resolveAgent;
            pluginDirs = reloaded.pluginDirs;
            await channelHandler.reload(config, pluginDirs, resolveAgent);
            updateHeader();
            showInfo("Config, agents, and skills reloaded. Session reset.");
            logger.info({}, "tui_command_reload");
          } catch (err) {
            const error = toError(err);
            logger.error({ err: error }, "tui_reload_error");
            showInfo(`Reload failed: ${error.message}`);
          }
          return;
        }

        // Delegate to ChannelHandler for shared commands
        const result = await channelHandler.handleCommand(
          TUI_CHANNEL_ID,
          cmd,
          arg,
        );
        if (result !== null) {
          showInfo(result);
          updateHeader();
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

      const responseText = await channelHandler.handleMessage(
        TUI_CHANNEL_ID,
        trimmed,
      );

      // Remove loader
      if (loader) {
        loader.stop();
        tui.removeChild(loader);
        loader = null;
      }

      const displayText = responseText.trim()
        ? responseText
        : "(empty response)";

      const assistantLabel = new Text(chalk.bold.green("assistant:"), 1, 0);
      insertBeforeEditor(assistantLabel);

      const md = new Markdown(displayText, 1, 0, markdownTheme);
      insertBeforeEditor(md);
      insertBeforeEditor(new Spacer(1));

      editor.disableSubmit = false;
      tui.requestRender();
    };

    tui.addChild(editor);
    tui.setFocus(editor);

    tui.addInputListener((data) => {
      if (matchesKey(data, Key.ctrl("c"))) {
        channelHandler.destroySession(TUI_CHANNEL_ID).then(() => {
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
