# Refactor Tracker

This tracker supports the incremental refactor plan in `@.agentic-wip/refactor.md`.

## Baseline Smoke Checklist

Run this checklist before and after each chunk.

1. `bun src/main.ts check-config tests/fixtures/valid-config.json` exits successfully.
2. `bun src/main.ts check-config tests/fixtures/invalid-config.json` fails with a validation error.
3. `bun run tui -- --home tests/fixtures/pug-claw-home` starts the TUI and reaches the prompt (stop with `Ctrl+C`).
4. `bun run start -- --home tests/fixtures/pug-claw-home` starts startup flow and reaches Discord login attempt (for local smoke, expected to fail without a real token).
5. `bun test tests/unit/chat-command-registry.test.ts` passes.
6. `bun test tests/integration/channel-handler.test.ts` passes.

## Complexity Hotspots And Ownership

Hotspot list based on line-count concentration and cross-cutting responsibility.

| File | Approx lines | Ownership area | Why this is a hotspot |
| --- | ---: | --- | --- |
| `src/resources.ts` | 705 | Config/runtime bootstrap | Mixes schema, path resolution, validation, and secrets logic.
| `src/scheduler/runner.ts` | 588 | Scheduler execution | Coordinates run lifecycle, delivery, status transitions, and logging.
| `src/chat-commands/tree.ts` | 529 | Shared command UX | Large command tree with many user-facing strings and action bindings.
| `src/frontends/discord.ts` | 480 | Discord frontend | Frontend runtime, command dispatch glue, and scheduler hooks.
| `src/drivers/pi.ts` | 415 | Pi driver adapter | Driver tool declaration, event parsing, and session orchestration.
| `src/drivers/claude.ts` | 303 | Claude driver adapter | Driver-specific event handling and tool integration.
| `src/frontends/tui.ts` | 284 | TUI frontend | TUI command handling and frontend-specific behavior.
| `src/main.ts` | 276 | CLI entrypoint | Driver/frontend wiring and command registration.

## Chunk Tracking Table

| Chunk | Theme | Status | Notes | Commit |
| --- | --- | --- | --- | --- |
| 0 | Baseline and safety net | Done | Tracker created; baseline checklist + hotspots documented. | 14e66a5 |
| 1 | Constants and message templates | Done | Extracted shared command/scheduler message constants and replaced duplicated inline strings. | e39798e |
| 2 | Type strictness (low risk first) | Done | Tightened command/driver typing and reduced broad map usage in entrypoint wiring. | be7a703 |
| 3 | Frontend duplication extraction | Done | Added shared frontend command action helpers and consolidated reload flow glue. | da59e7e |
| 4 | SchedulerRunner phase decomposition | Done | Split run lifecycle into phase methods while preserving status transitions and output. | 6b61e33 |
| 5 | Config module decomposition | Done | Split config concerns into `src/config/*` modules with `resources.ts` acting as facade. | 5441744 |
| 6 | Command exit behavior refactor | Done | Replaced command-level `process.exit(...)` in target modules with typed command results; main now applies exit codes. | 2093883 |
| 7 | Driver tool schema consolidation | Done | Introduced shared memory tool schema metadata and generated Claude/Pi tool adapters from it. | pending |
| 8 | Testability infrastructure | Planned |  |  |

## Per-Chunk Issue Template

Use this template when creating a tracking issue for each chunk.

```md
## Refactor Chunk <N>: <Title>

### Scope
- <single-theme scope item>
- <single-theme scope item>

### Files In Scope
- <path>
- <path>

### Constraints
- No user-facing behavior changes.
- Preserve output text and command behavior.
- Keep PR focused and small.

### Validation
- [ ] `just lint`
- [ ] `just typecheck`
- [ ] Targeted tests:
  - [ ] <test command>
  - [ ] <test command>
- [ ] `just gate`

### Exit Criteria
- [ ] <criterion>
- [ ] <criterion>

### Notes
- Risks:
- Follow-ups:
```
