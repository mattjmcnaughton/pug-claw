# Chat Commands

pug-claw exposes a shared hierarchical command tree to both frontends:

- **Discord** uses the `!` prefix
- **TUI** uses the `/` prefix

The tree is implemented in:

- `src/chat-commands/tree.ts` — command definitions and metadata
- `src/chat-commands/registry.ts` — parsing, dispatch, help rendering, frontend/owner filtering
- `src/channel-handler.ts` — runtime state operations used by commands

## Current command tree

```text
help [command]

agent
  show
  set <name>
  list
  skills

backup
  export
  dryrun

driver
  show
  set <name>
  list

model
  show
  set <name>
  list

memory
  show [scope]
  search <query>
  remember <text>
  forget <id>
  export [scope]
  stats

schedule   # Discord only; owner only
  list
  run <name>

session
  status
  new

system
  reload
  restart
  quit    # TUI only
```

Examples:

- Discord: `!driver set pi`
- Discord: `!help system`
- Discord: `!schedule list`
- Discord: `!backup export`
- Discord: `!memory show`
- Discord: `!memory remember The deploy key is in 1Password`
- TUI: `/agent skills`
- TUI: `/backup dryrun`
- TUI: `/memory search coding style`
- TUI: `/system quit`

## Important rule

**There are no legacy flat aliases.**

Use the full tree form:

- `!session new`, not `!new`
- `!session status`, not `!status`
- `!agent skills`, not `!skills`
- `!system reload`, not `!reload`
- `!system restart`, not `!restart`
- `!agent set researcher`, not `!agent researcher`
- `!driver set pi`, not `!driver pi`
- `!model set claude-opus-4-6`, not `!model claude-opus-4-6`

## Adding a new command

1. Add a node in `src/chat-commands/tree.ts`
2. Prefer nesting under an existing domain (`agent`, `driver`, `model`, `session`, `system`) before creating a new top-level command
3. Use `frontends` for frontend-specific commands and `ownerOnly` for protected commands
4. Keep business logic in `src/channel-handler.ts` or frontend action hooks — command nodes should mostly orchestrate and format responses
5. Add tests:
   - `tests/unit/chat-command-registry.test.ts` for registry behavior
   - `tests/integration/channel-handler.test.ts` for command behavior against real channel state
   - frontend tests when the command has frontend-specific behavior
6. Update docs and any built-in agent/skill instructions that mention user-facing commands

## Contributor guidance

When implementing chat commands:

- Do **not** add another ad hoc `if` ladder in a frontend
- Do **not** add legacy shorthand aliases unless there is a strong reason
- Prefer command metadata plus generated help over hand-maintained help text
- Keep top-level help focused on namespaces; use `help <command>` for subcommands
