# Code Style Conventions

## Formatter & Linter

- **Biome** (config in `biome.json`)
- 2-space indentation, double quotes
- Use `import type` for type-only imports
- Use `node:` protocol for Node.js builtin imports (e.g., `import { join } from "node:path"`)

## Type Annotations

- Avoid `any` — use Zod-inferred types (`ConfigFile`, `ChannelConfig`), `unknown`, or specific interfaces instead
- `biome-ignore lint/suspicious/noExplicitAny` is acceptable only for untyped third-party library boundaries (e.g., pi-tui, pi-ai)
- Use named exported types over inline type gymnastics — prefer `ResolvedConfig` over `Awaited<ReturnType<typeof resolveConfig>>`
- Ensure function parameters reflect actual types — e.g., Commander options are `string | undefined`, not `string`
- Do not create wrapper interfaces that add no fields — if `StartOptions extends ConfigOptions` with nothing added, just use `ConfigOptions`

## Catch Blocks

- Use `catch (err)` consistently in all catch blocks (not `e`, `error`, etc.)
- See [error-handling.md](./error-handling.md) for full error handling patterns
