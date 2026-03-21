# Skills

Skills are modular capabilities that extend an agent's behavior. They are defined as markdown files with YAML frontmatter and are automatically discovered and injected into the agent's system prompt at session creation.

For basic setup, see [agents.md](./agents.md). This document covers the skill system in depth.

## How skills work

```
User sends message
  -> pug-claw creates a session (if needed)
  -> discovers skills in agents/<name>/skills/ and global skills/
  -> returns skills as structured data alongside the system prompt
  -> the driver injects skills using its native mechanism
  -> sends the prompt + skills to the AI backend
```

### Driver-specific injection

**Claude driver:** Skills are injected as native plugins via the Claude Code SDK. At startup (and on `system reload`), pug-claw generates per-agent plugin directories at `~/.pug-claw/plugins/{agentName}/skills/` containing symlinks to each allowed skill's directory. The SDK discovers these natively.

**Pi driver (and fallback):** Skills are injected as an XML catalog appended to the system prompt:

```xml
<available-skills>
  <skill name="summarize" path="/abs/path/to/agents/default/skills/summarize/SKILL.md">
    Summarize articles, documents, or web pages into concise bullet points
  </skill>
  <skill name="translate" path="/abs/path/to/agents/default/skills/translate/SKILL.md">
    Translate text between languages
  </skill>
</available-skills>
```

When a user's request matches a skill, the AI reads the full `SKILL.md` file for detailed instructions. This lazy-loading approach keeps the system prompt compact while making detailed skill instructions available on demand.

See [ADR-001](./adrs/001-per-agent-native-skill-injection.md) for the design rationale.

## Directory structure

```
agents/
  my-agent/
    SYSTEM.md
    skills/
      summarize/
        SKILL.md
      translate/
        SKILL.md
        examples/          # optional supporting files
          formal.md
          casual.md
```

Each skill is a directory under `skills/` containing at minimum a `SKILL.md` file. You can include additional files (examples, templates, reference data) alongside `SKILL.md` — the AI can read them if instructed to in the skill definition.

### Global skills

Global skills live in the skills directory (`~/.pug-claw/skills/` by default) and are shared across agents:

```
~/.pug-claw/
  skills/
    read-pug-claw-config/
      SKILL.md
    read-discord/
      SKILL.md
      scripts/
        discord.ts
```

Global skills are only available to agents that list them in `allowed-skills`. Agent-specific skills always take precedence over global skills with the same name.

## SKILL.md format

### Frontmatter

YAML frontmatter between `---` delimiters. Both fields are required:

```yaml
---
name: summarize
description: Summarize articles, documents, or web pages into concise bullet points
---
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier for the skill. Used in the catalog and `agent skills` output. |
| `description` | string | Yes | One-line description. Keep it concise — this appears in the system prompt for every message. |

### Body

The markdown body after the frontmatter contains the full skill instructions. This is what the AI reads when it decides to use the skill.

Write skill instructions as if you're briefing a knowledgeable assistant:

```markdown
---
name: eli5
description: Explain complex topics in simple terms, as if to a five-year-old
---

# ELI5

When asked to explain something simply:

1. Identify the core concept (strip away jargon)
2. Find a relatable analogy from everyday life
3. Build up from the analogy to the actual concept
4. Keep sentences short — aim for 8th grade reading level
5. End with a one-sentence "the real version" for context

## Tone

Friendly and patient. Use "imagine..." and "it's kind of like..." constructions.
Avoid disclaimers like "well, it's actually more complicated than this."

## Examples

**Topic:** Quantum entanglement
**Response:** Imagine you have two magic dice. Whenever you roll one and get a 6,
the other one — even if it's on the other side of the world — also shows 6, instantly.
Scientists found that tiny particles can be connected like this. The real version:
entangled particles share a quantum state, so measuring one instantly determines the other.
```

## Writing effective skills

### Keep descriptions short

The description appears in the system prompt for every message in the session. Long descriptions bloat the prompt. Aim for one sentence under 100 characters.

### Be specific in the body

The body is only read when the skill is activated, so there's no cost to being thorough. Include:

- Step-by-step instructions
- Constraints and edge cases
- Tone/style guidance
- Examples of good output

### Use supporting files

For skills that need reference data, templates, or examples, put them in the skill directory and reference them from `SKILL.md`:

```markdown
---
name: code-review
description: Review code for bugs, style issues, and security concerns
---

# Code Review

Read the checklist at ./checklist.md before starting each review.
Use the severity scale defined in ./severity-levels.md.
```

### One skill per concern

Prefer focused skills over broad ones. Instead of a "writing" skill that handles everything, create `summarize`, `proofread`, `rewrite-formal`, etc. This gives the AI clearer signals about when to activate each skill.

## Skill discovery details

The discovery process (`skills.ts`) works as follows:

1. Looks for a `skills/` directory inside the agent directory
2. Iterates over subdirectories (non-directory entries are ignored)
3. Checks each subdirectory for a `SKILL.md` file
4. Parses the YAML frontmatter from each `SKILL.md`
5. Skills with missing or invalid frontmatter are skipped (with a warning log)
6. Valid skills are sorted alphabetically by name
7. Skills are returned as structured data for driver-specific injection

Plugin directories (`~/.pug-claw/plugins/`) are regenerated on startup and `!system reload`. Skills are discovered once at session creation. To pick up new or modified skills, use `!system reload` (Discord), `/system reload` (TUI), or reset the session with `!session new` / `/session new`.

## Listing skills

Use `!agent skills` (Discord) or `/agent skills` (TUI) to see all discovered skills for the current agent. The output shows each skill's name and description.

## Built-in Skills

Pug-claw ships with built-in skills that are installed to `~/.pug-claw/skills/` during `pug-claw init`. Built-in skills have `metadata.managed-by: pug-claw` in their frontmatter and are automatically updated when you run `pug-claw init --builtins-only`.

| Skill | Description |
|-------|-------------|
| `read-pug-claw-config` | Read and inspect pug-claw configuration files and settings |
| `readwrite-pug-claw-config` | Edit pug-claw configuration (add channels, change defaults, update paths) |
| `read-discord` | Read Discord data (channels, messages, members) via discord.js |
| `readwrite-discord` | Send messages, create channels, and manage Discord via discord.js |
| `create-agent` | Create new pug-claw agent definitions with SYSTEM.md |
| `create-skill` | Create new pug-claw skill definitions following agentskills.io format |
| `read-pug-claw-codebase` | Read pug-claw source code via gh CLI for understanding internals |

Built-in skills are not available to agents by default. An agent must explicitly list them in its `allowed-skills` frontmatter field. See [agents.md](./agents.md) for details.

## Skill Format (agentskills.io)

Skills follow the [agentskills.io](https://agentskills.io/specification) open standard. Each skill directory can optionally include:

- `scripts/` — Executable scripts the AI can run
- `references/` — Supplementary reference documents
- `assets/` — Static files (images, data)
