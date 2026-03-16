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

## SYSTEM.md Frontmatter

SYSTEM.md files support optional YAML frontmatter for metadata and skill filtering:

```markdown
---
name: my-agent
description: A specialized research assistant
driver: claude
model: claude-opus-4-6
allowed-skills:
  - read-pug-claw-config
  - read-discord
metadata:
  managed-by: user
---

You are a specialized research assistant...
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Agent display name |
| `description` | string | No | Agent description |
| `driver` | string | No | Preferred driver for this agent (e.g., `claude`, `pi`) |
| `model` | string | No | Preferred model for this agent (e.g., `claude-opus-4-6`) |
| `allowed-skills` | string[] | No | Global skills this agent can use |
| `metadata` | object | No | Key-value pairs (e.g., `managed-by`) |

### Driver/Model Resolution Precedence

When determining which driver and model to use, the following precedence applies (highest to lowest):

1. **Runtime command** — `!driver`/`!model` (Discord) or `/driver`/`/model` (TUI)
2. **Channel config** — `channels[id].driver`/`channels[id].model` in `config.json`
3. **Agent frontmatter** — `driver`/`model` fields in `SYSTEM.md`
4. **Global default** — `default_driver` in `config.json` / driver's `defaultModel`

Agent frontmatter acts as a soft default — stronger than the global default but overridden by explicit channel or runtime settings.

### allowed-skills Behavior

- **Omitted**: No global skills are injected (safe default)
- **Empty array** (`[]`): No global skills are injected
- **List of names**: Only the named global skills are available to this agent

Agent-specific skills (under `{agent}/skills/`) are always available regardless of `allowed-skills`.

### Backward Compatibility

SYSTEM.md without frontmatter works exactly as before — the entire file is the system prompt and no global skills are injected.

## Built-in Agents

Pug-claw ships with two built-in agents installed during `pug-claw init`:

| Agent | Description |
|-------|-------------|
| `default` | Generic helpful assistant with no global skills |
| `pug-claw-manager` | Administrative agent with access to all built-in skills |

Built-in agents have `metadata.managed-by: pug-claw` and are updated automatically via `pug-claw init --builtins-only`.

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
