---
name: create-agent
description: Create new pug-claw agent definitions with SYSTEM.md
metadata:
  managed-by: pug-claw
---

# Create Agent

Create new pug-claw agent definitions.

## Agent Structure

Each agent is a directory containing a `SYSTEM.md` file:

```
{agents_dir}/{agent-name}/
  SYSTEM.md              # Required: system prompt
  skills/                # Optional: agent-specific skills
    my-skill/
      SKILL.md
```

The agents directory is configured in `config.json` under `paths.agents_dir` or defaults to `~/.pug-claw/agents/`.

## SYSTEM.md Format

SYSTEM.md supports optional YAML frontmatter followed by the system prompt:

```markdown
---
name: my-agent
description: A description of what this agent does
driver: claude
model: claude-opus-4-6
allowed-skills:
  - skill-name-1
  - skill-name-2
metadata:
  managed-by: user
---

You are a specialized assistant that...
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Agent display name |
| `description` | string | No | What this agent does |
| `driver` | string | No | Preferred driver (e.g., `claude`, `pi`). Overridden by channel config and runtime commands. |
| `model` | string | No | Preferred model (e.g., `claude-opus-4-6`). Overridden by channel config and runtime commands. |
| `allowed-skills` | string[] | No | Global skills this agent can use. If omitted, no global skills are injected. |
| `metadata` | object | No | Key-value pairs (e.g., `managed-by`) |

### allowed-skills Behavior

- **Omitted**: No global skills injected (safe default)
- **Empty array** (`[]`): No global skills injected
- **List of names**: Only the named global skills are available to this agent
- Agent-specific skills (under `{agent}/skills/`) are always available regardless

### SYSTEM.md Without Frontmatter

SYSTEM.md without frontmatter works as before — the entire file is the system prompt, and no global skills are injected.

## Steps to Create an Agent

1. Determine the agent name (lowercase, hyphens, no spaces)
2. Create the directory: `mkdir -p {agents_dir}/{name}`
3. Write `SYSTEM.md` with the system prompt
4. Optionally add `allowed-skills` frontmatter to enable global skills
5. Optionally create `skills/` subdirectory for agent-specific skills

## Writing Guidelines

- Be specific about the agent's role, tone, and constraints
- Keep the prompt focused — use skills for detailed instructions
- Use `allowed-skills` to give the agent access to relevant global skills
- Set `metadata.managed-by` to track who created the agent

## Activating the Agent

- Discord: `!agent set {name}`
- TUI: `/agent set {name}`
- Set as default: update `default_agent` in `config.json`
