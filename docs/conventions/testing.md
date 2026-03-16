# Testing Conventions

## Framework

- All tests use `bun:test` (`describe`, `test`, `expect`, `mock`) — not jest or vitest
- Tests live in `tests/` with `unit/`, `integration/`, `e2e/` subdirectories
- Fixtures live in `tests/fixtures/` — `pug-claw-home/` is a complete fake home directory for integration-style unit tests

## Skipping Tests

- Use `test.skipIf()` for tests requiring external credentials (e.g. `DISCORD_BOT_TOKEN`)

## Helpers & Patterns

- Use `withEnv()` helper (see `tests/unit/resources.test.ts`) to save/restore env vars around tests
- Use `makeTmpDir()` with `rmSync` in `finally` blocks for filesystem tests
- Use `mock.module()` for mocking external packages (must be called before importing the module under test)
