# Constants & Magic Strings

Shared configuration values live in `src/constants.ts`. **Never inline** these — always import from constants.

## Constant Groups

- **Paths** (`Paths.*`): file/dir names like `config.json`, `SYSTEM.md`, `SKILL.md`, `.env`, `agents`, `skills`, `data`, `logs/system`, `~/.pug-claw`
- **EnvVars** (`EnvVars.*`): environment variable names like `PUG_CLAW_HOME`, `PUG_CLAW_AGENTS_DIR`, `LOG_LEVEL`
- **Drivers** (`Drivers.*`): driver identifiers like `claude`, `pi`
- **Defaults** (`Defaults.*`): default values for agent name, driver, secrets provider
- **SecretsProviders** (`SecretsProviders.*`): provider identifiers like `env`, `dotenv`
- **Limits** (`Limits.*`): protocol limits like Discord message length

## When to Add a New Constant

When adding a new shared string (used in 2+ files or representing a configurable/convention value), add it to the appropriate group in `src/constants.ts`.

## What to Leave Inline

Log event names, command names in switch/if handlers, Zod schema literals, model IDs on driver classes, SDK-specific strings used once.
