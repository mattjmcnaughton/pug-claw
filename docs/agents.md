# Agents

Agents define the personality and capabilities of your bot. Each agent is a directory under `agents/` containing a system prompt and optional skills.

## Directory structure

```
agents/
  default/
    SYSTEM.md
    skills/
      weather/
        SKILL.md
      summarize/
        SKILL.md
  researcher/
    SYSTEM.md
    skills/
      ...
```

## Creating an agent

1. Create a directory under `agents/`:

```bash
mkdir -p agents/my-agent
```

2. Add a `SYSTEM.md` file with the agent's system prompt:

```markdown
You are a friendly research assistant. You help users find information,
summarize articles, and answer questions about academic topics.

Keep responses well-sourced and balanced. When uncertain, say so.
```

The entire contents of `SYSTEM.md` are passed as the system prompt to the underlying driver.

3. Switch to your agent via `!agent my-agent` (Discord) or `/agent my-agent` (TUI).

## Skills

Skills extend an agent's capabilities. Each skill lives in a subdirectory of `agents/<name>/skills/` and contains a `SKILL.md` file.

### SKILL.md format

Skills use YAML frontmatter for metadata, followed by markdown instructions:

```markdown
---
name: summarize
description: Summarize articles, documents, or web pages into concise bullet points
---

# Summarize

When asked to summarize content:

1. Identify the key themes and arguments
2. Extract the most important points
3. Present as a bulleted list, ordered by importance
4. Include a one-sentence TLDR at the top
```

**Required frontmatter fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique skill name (used for display) |
| `description` | string | Short description (shown in skill catalog) |

### How skills work

At session creation, pug-claw:

1. Scans the agent's `skills/` directory for subdirectories containing `SKILL.md`
2. Parses the YAML frontmatter from each skill
3. Builds a catalog of available skills
4. Appends the catalog to the agent's system prompt

The AI backend sees the skill names and descriptions and can read the full `SKILL.md` for detailed instructions when a user's request matches a skill.

### Listing skills

Use `!skills` (Discord) or `/skills` (TUI) to see all skills available for the current agent.
