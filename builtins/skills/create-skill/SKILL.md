---
name: create-skill
description: Create new pug-claw skill definitions following agentskills.io format
metadata:
  managed-by: pug-claw
---

# Create Skill

Create new skill definitions for pug-claw agents following the agentskills.io open standard.

## Skill Structure

Each skill is a directory containing a `SKILL.md` file:

```
{skill-name}/
  SKILL.md               # Required: skill definition
  scripts/               # Optional: executable scripts
  references/            # Optional: reference documents
  assets/                # Optional: images, data files
```

## SKILL.md Format

```markdown
---
name: my-skill
description: One-line description of what the skill does
metadata:
  managed-by: user
---

# My Skill

Detailed instructions for the AI to follow when this skill is activated.

## When to Use

Describe when this skill should be triggered.

## Steps

1. Step-by-step instructions
2. ...

## Examples

Show example inputs and outputs.
```

### Required Frontmatter

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique skill identifier (should match directory name) |
| `description` | string | One-line description (shown in skill catalog) |

### Optional Frontmatter

| Field | Type | Description |
|-------|------|-------------|
| `metadata` | object | Key-value pairs (e.g., `managed-by`) |

## Global vs Agent-Specific Skills

### Global Skills

Placed in the global skills directory (`~/.pug-claw/skills/`). Available to any agent whose `allowed-skills` list includes the skill name.

### Agent-Specific Skills

Placed under an agent's `skills/` directory. Always available to that agent regardless of `allowed-skills`.

## Optional Directories

### scripts/

Executable scripts the AI can run via Bash. Use `bun run` for TypeScript, `python` for Python, etc.

### references/

Supplementary documentation the AI can read for additional context.

### assets/

Static files (images, data) referenced by the skill.

## Best Practices

- Keep descriptions short (under 100 characters) — they appear in every system prompt
- Be thorough in the body — it's only loaded on demand
- One concern per skill — prefer focused skills over broad ones
- Match directory name to frontmatter `name`
- Include examples of expected output
- Reference supporting files with relative paths (e.g., `./references/schema.md`)
