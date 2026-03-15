# Pug Claw

## Project Structure

- `src/` — TypeScript source code
- `tests/` — Test suite (unit, integration, e2e)
- `docs/` — Documentation
- `agents/` — Agent definitions (SYSTEM.md, skills) — legacy location, new installs use `~/.pug-claw/agents/`

## Development

This is a Bun + TypeScript project.

### Commands (via justfile)

- `just gate` — Run all static checks (lint, format, typecheck)
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

## Testing

- Framework: `bun:test` (built-in)
- Tests live in `tests/` with `unit/`, `integration/`, `e2e/` subdirectories
- Fixtures in `tests/fixtures/`
- Use `test.skipIf()` for tests requiring external credentials (e.g. `DISCORD_BOT_TOKEN`)

## Code Style

- Formatter/linter: Biome (config in `biome.json`)
- 2-space indentation, double quotes
- Use `import type` for type-only imports
- Use `node:` protocol for Node.js builtin imports
