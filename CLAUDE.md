# Pug Claw

## Project Structure

- `src/` — TypeScript source code
- `tests/` — Test suite (unit, integration, e2e)
- `docs/` — Documentation
- `builtins/` — Built-in skills and agents shipped with pug-claw (installed to `~/.pug-claw/` during init)

## Development

This is a Bun + TypeScript project.

### Commands (via justfile)

- `just gate` — Run all checks (lint, format, typecheck, tests)
- `just lint` — Lint with Biome
- `just lint-fix` — Auto-fix lint issues
- `just fmt-check` — Check formatting with Biome
- `just fmt` — Auto-format with Biome
- `just typecheck` — Typecheck with tsc
- `just test` — Run all tests
- `just test-unit` — Run unit tests only
- `just test-integration` — Run integration tests only
- `just test-e2e` — Run e2e tests only

### Running

- `bun run init` — Initialize `~/.pug-claw` configuration (interactive)
- `bun run start` — Start with Discord frontend
- `bun run tui` — Start with TUI frontend

## Architecture

The codebase uses a plugin pattern with two extension points:

- **Drivers** (`src/drivers/`): AI backends (Claude, Pi). Implement the `Driver` interface from `src/drivers/types.ts`. Registered in `src/main.ts` `startFrontend()`.
- **Frontends** (`src/frontends/`): User-facing interfaces (Discord, TUI). Implement the `Frontend` interface from `src/frontends/types.ts`.
- **Commands** (`src/commands/`): CLI subcommands (init, check-config, init-service). Registered in `src/main.ts` via Commander.
- **Chat commands** (`src/chat-commands/`): Shared Discord/TUI command tree. Definitions live in `tree.ts`; parsing/dispatch/help live in `registry.ts`.

Config loading and resolution lives in `src/resources.ts`. Agent/skill discovery lives in `src/agents.ts` and `src/skills.ts`. The logger is a pino singleton from `src/logger.ts`.

## Utilities

- `expandTilde` is exported from `src/resources.ts` — do not duplicate it in other files
- `toError(err)` is exported from `src/resources.ts` — normalizes `unknown` catch values into proper `Error` objects. Use it in all catch blocks.

## Conventions

Detailed rules with examples live in `docs/conventions/`. Read the relevant file when working in that area.

- **Code Style**: Biome, 2-space indent, double quotes, `import type` for type-only imports, `catch (err)` in all catch blocks. See [`docs/conventions/code-style.md`](docs/conventions/code-style.md).
- **Constants**: Shared strings live in `src/constants.ts` — never inline. See [`docs/conventions/constants.md`](docs/conventions/constants.md).
- **Error Handling**: Preserve stack traces, use `toError()`, use pino's `err` key. Never use bare `catch {}`. See [`docs/conventions/error-handling.md`](docs/conventions/error-handling.md).
- **Logging**: Pino structured, two-arg format: `logger.info({ ctx }, "snake_case_tag")`. See [`docs/conventions/logging.md`](docs/conventions/logging.md).
- **Testing**: `bun:test`, fixtures in `tests/fixtures/`, `withEnv()` for env vars. See [`docs/conventions/testing.md`](docs/conventions/testing.md).
- **Chat Command Pattern**: Read [`docs/commands.md`](docs/commands.md) before changing Discord/TUI commands. Add new user-facing commands in `src/chat-commands/tree.ts`, keep them hierarchical (`session new`, `driver set`, `system reload`), avoid legacy shorthand aliases, and update command docs/built-in instructions when the surface area changes.
