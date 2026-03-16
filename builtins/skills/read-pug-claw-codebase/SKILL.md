---
name: read-pug-claw-codebase
description: Read pug-claw source code via gh CLI for understanding internals
metadata:
  managed-by: pug-claw
---

# Read Pug-Claw Codebase

Access and understand the pug-claw source code using the GitHub API.

## How to Access

Use the `gh` CLI to read files from the repository:

```bash
gh api repos/mattjmcnaughton/pug-claw/contents/{path} --jq '.content' | base64 -d
```

To list directory contents:

```bash
gh api repos/mattjmcnaughton/pug-claw/contents/{path} --jq '.[].name'
```

If `gh` is unavailable, fall back to curl:

```bash
curl -s https://api.github.com/repos/mattjmcnaughton/pug-claw/contents/{path} | jq -r '.content' | base64 -d
```

## Key Directories

| Path | Description |
|------|-------------|
| `src/` | TypeScript source code |
| `src/drivers/` | AI backend drivers (Claude, Pi) |
| `src/frontends/` | User-facing interfaces (Discord, TUI) |
| `src/commands/` | CLI subcommands |
| `builtins/` | Built-in skills and agents |
| `tests/` | Test suite |
| `docs/` | Documentation |

## Architecture Overview

pug-claw uses a plugin architecture with two main extension points:

- **Drivers** (`src/drivers/`): AI backends implementing the `Driver` interface
- **Frontends** (`src/frontends/`): User interfaces implementing the `Frontend` interface

### Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Entry point, CLI setup, driver registration |
| `src/resources.ts` | Config loading, path resolution, secrets |
| `src/agents.ts` | Agent discovery and SYSTEM.md parsing |
| `src/skills.ts` | Skill discovery, frontmatter parsing, prompt building |
| `src/constants.ts` | Shared constants (paths, env vars, defaults) |
| `src/logger.ts` | Pino structured logger |

### Data Flow

1. User sends a message via a frontend (Discord/TUI)
2. Frontend resolves the agent for the channel
3. `buildFullSystemPrompt()` loads SYSTEM.md + discovers skills
4. The prompt and user message are sent to the driver (Claude/Pi)
5. The driver returns a response
6. The frontend delivers the response to the user

## Tips

- Start with `src/main.ts` to understand the entry point
- Read `src/resources.ts` for config schema and resolution logic
- Check `src/constants.ts` for all shared constants
- The `docs/` directory has detailed documentation on each subsystem
