import type {
  ChatCommandContext,
  ChatCommandEnvironment,
  ChatCommandNode,
  ChatCommandResult,
} from "./types.ts";

interface ChatCommandMatch {
  node: ChatCommandNode;
  path: string[];
  args: string[];
}

interface ChatCommandPathAccess {
  node: ChatCommandNode | null;
  blockedByOwner: boolean;
}

export class ChatCommandRegistry {
  constructor(private readonly root: ChatCommandNode) {}

  async execute(
    env: ChatCommandEnvironment,
    raw: string,
  ): Promise<ChatCommandResult | null> {
    const words = this.splitWords(raw);
    if (words.length === 0) return null;

    const match = this.resolve(words);
    if (!match) return null;

    const access = this.inspectPath(match.path, env);
    if (!access.node) return null;
    if (access.blockedByOwner) {
      return { message: "Only the bot owner can use this command." };
    }
    if (!access.node.execute) return null;

    return access.node.execute(this.createContext(env), match.args);
  }

  async run(
    env: ChatCommandEnvironment,
    path: string[],
    args: string[] = [],
  ): Promise<ChatCommandResult | null> {
    const access = this.inspectPath(path, env);
    if (!access.node?.execute) return null;
    if (access.blockedByOwner) {
      return { message: "Only the bot owner can use this command." };
    }
    return access.node.execute(this.createContext(env), args);
  }

  formatHelp(env: ChatCommandEnvironment, path: string[] = []): string {
    if (path.length === 0) {
      const lines = ["**Commands:**"];
      for (const child of this.visibleChildren(this.root, env)) {
        lines.push(
          `\`${this.formatUsage(env, child, [child.name])}\` — ${child.description}`,
        );
      }
      lines.push(
        "",
        `Use \`${env.commandPrefix}help <command>\` to see subcommands.`,
      );
      return lines.join("\n");
    }

    const node = this.findNode(path, env);
    if (!node) {
      return `Unknown command \`${this.formatCommand(env, path)}\`.`;
    }

    const lines = [
      `\`${this.formatUsage(env, node, path)}\` — ${node.description}`,
    ];
    const children = this.visibleChildren(node, env);
    if (children.length > 0) {
      lines.push("", "**Subcommands:**");
      for (const child of children) {
        const childPath = [...path, child.name];
        lines.push(
          `\`${this.formatUsage(env, child, childPath)}\` — ${child.description}`,
        );
      }
    }

    return lines.join("\n");
  }

  formatCommand(env: ChatCommandEnvironment, path: string[]): string {
    return `${env.commandPrefix}${path.join(" ")}`;
  }

  listVisibleCommands(
    env: ChatCommandEnvironment,
    path: string[] = [],
  ): Array<{ name: string; description: string }> {
    const node = path.length === 0 ? this.root : this.findNode(path, env);
    if (!node) {
      return [];
    }
    return this.visibleChildren(node, env).map((child) => ({
      name: child.name,
      description: child.description,
    }));
  }

  findNode(
    path: string[],
    env?: ChatCommandEnvironment,
  ): ChatCommandNode | null {
    if (!env) {
      let node: ChatCommandNode = this.root;
      for (const segment of path) {
        const child = node.children?.[segment.toLowerCase()];
        if (!child) return null;
        node = child;
      }
      return node;
    }

    const access = this.inspectPath(path, env);
    if (access.blockedByOwner) {
      return null;
    }
    return access.node;
  }

  private inspectPath(
    path: string[],
    env: ChatCommandEnvironment,
  ): ChatCommandPathAccess {
    let node: ChatCommandNode = this.root;
    let blockedByOwner = false;

    for (const segment of path) {
      const child = node.children?.[segment.toLowerCase()];
      if (!child) {
        return { node: null, blockedByOwner: false };
      }
      if (!this.isSupported(child, env)) {
        return { node: null, blockedByOwner: false };
      }
      if (child.ownerOnly && !env.isOwner) {
        blockedByOwner = true;
      }
      node = child;
    }

    return { node, blockedByOwner };
  }

  private createContext(env: ChatCommandEnvironment): ChatCommandContext {
    return {
      ...env,
      formatHelp: (path: string[] = []) => this.formatHelp(env, path),
      formatCommand: (path: string[]) => this.formatCommand(env, path),
      run: (path: string[], args: string[] = []) => this.run(env, path, args),
    };
  }

  private resolve(words: string[]): ChatCommandMatch | null {
    let node: ChatCommandNode = this.root;
    let index = 0;
    const path: string[] = [];

    while (index < words.length) {
      const word = words[index];
      if (word === undefined) break;
      const child = node.children?.[word.toLowerCase()];
      if (!child) break;
      node = child;
      path.push(child.name);
      index += 1;
    }

    if (path.length === 0) return null;
    return { node, path, args: words.slice(index) };
  }

  private visibleChildren(
    node: ChatCommandNode,
    env: ChatCommandEnvironment,
  ): ChatCommandNode[] {
    return Object.values(node.children ?? {})
      .filter((child) => !child.hidden)
      .filter((child) => this.isSupported(child, env))
      .filter((child) => !child.ownerOnly || env.isOwner)
      .filter(
        (child) =>
          child.execute !== undefined ||
          this.visibleChildren(child, env).length > 0,
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private isSupported(
    node: ChatCommandNode,
    env: ChatCommandEnvironment,
  ): boolean {
    return (
      node.frontends === undefined || node.frontends.includes(env.frontend)
    );
  }

  private formatUsage(
    env: ChatCommandEnvironment,
    node: ChatCommandNode,
    path: string[],
  ): string {
    return `${env.commandPrefix}${node.usage ?? path.join(" ")}`;
  }

  private splitWords(input: string): string[] {
    return input.trim().split(/\s+/).filter(Boolean);
  }
}
