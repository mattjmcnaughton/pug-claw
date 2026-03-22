# ADR-001: Per-Agent Native Skill Injection

**Status:** Accepted
**Date:** 2026-03-16

## Context

Pug-claw's skill system had two problems in production:

1. **Skills didn't work with the Claude driver.** `resolveAgent()` baked an `<available-skills>` XML catalog into the system prompt, but Claude Code SDK has its own skill/plugin system. The agent saw Claude Code's built-in skills (simplify, loop, claude-api) instead of pug-claw's skills. The XML catalog in the system prompt was effectively invisible to the SDK's skill routing.

2. **OPENROUTER_API_KEY wasn't visible to the Pi driver.** `DotenvSecretsProvider` read `secrets.env` into an internal map but never injected values into `process.env`. The Pi library's `getEnvApiKey()` reads `process.env.OPENROUTER_API_KEY` directly, finding nothing.

## Decision

### Separate skill discovery from skill injection

Previously, `resolveAgent()` discovered skills *and* injected them by appending an XML catalog to the system prompt. This coupled the injection strategy to a single approach that didn't work for all drivers.

Now, `resolveAgent()` returns skills as structured data (`SkillSummary[]`) alongside the clean system prompt. Each driver decides how to inject skills using its native mechanism.

### Per-agent plugin directories with symlinks

For the Claude driver, we generate per-agent plugin directories at `~/.pug-claw/internal/plugins/{agentName}/skills/` containing symlinks to each allowed skill's directory. The Claude Code SDK's `plugins: [{ type: "local", path }]` option picks these up natively.

**Why symlinks, not copies:**
- Skills may contain large supporting files (scripts, references, assets)
- Symlinks stay in sync with the source — no stale-copy bugs
- The plugins directory is wiped and regenerated on every startup and `system reload`, so broken symlinks are self-healing

**Why per-agent directories, not one shared directory:**
- Agents have different `allowed-skills` lists — skill A might be allowed for agent X but not agent Y
- Per-agent isolation prevents skill leakage across agents
- Claude Code SDK namespaces skills by plugin directory, giving natural `{agent}:{skill}` naming

### Fallback for non-plugin drivers

Drivers that don't support native plugins (Pi, and Claude without a pluginDir) fall back to the original approach: `appendSkillCatalog()` embeds the XML catalog into the system prompt. This is a shared helper to avoid duplication.

### DotenvSecretsProvider injects into process.env

After parsing the dotenv file, `DotenvSecretsProvider` now writes each key-value pair into `process.env` if the key isn't already set. This preserves the existing precedence (real env vars win over file values) while making secrets visible to third-party libraries that read `process.env` directly.

## Alternatives Considered

### Pi skillsOverride API

The original plan called for using Pi's `DefaultResourceLoader.skillsOverride` to inject skills natively. We chose the simpler catalog-in-prompt approach because:
- Pi's skill format requires fields (`baseDir`, `source`, `disableModelInvocation`) that don't map cleanly from `SkillSummary`
- The prompt-based approach already worked for Pi — it was only broken for Claude
- Less coupling to Pi's internal API surface

### Embedding skills in system prompt for all drivers

We could have kept the original "catalog in prompt" approach and just fixed Claude separately. But separating discovery from injection is a cleaner architecture that lets each driver use its best mechanism, and the `ResolvedAgent` interface is more useful when skills are structured data rather than baked into a string.

### Copying skill directories instead of symlinking

Copies would avoid any risk of broken symlinks but would be slower, use more disk, and require careful cache invalidation. Since we wipe and regenerate the plugins directory on every startup and `system reload`, symlinks are simpler and always fresh.

## Consequences

- `ResolvedAgent.systemPrompt` no longer contains the skill catalog. Any code that checked for `<available-skills>` in the prompt needs updating (tests were updated).
- A new `~/.pug-claw/internal/plugins/` directory is created during `init` and regenerated on startup and `system reload`.
- The `DriverOptions` interface now has optional `skills` and `pluginDir` fields — drivers that don't need them can ignore them.
- `DotenvSecretsProvider` has a side-effect on `process.env`. This is intentional but worth knowing — secrets from the dotenv file are now globally visible within the process.

## Files Changed

| Area | Files |
|------|-------|
| Core | `src/skills.ts`, `src/plugins.ts` (new), `src/constants.ts` |
| Drivers | `src/drivers/types.ts`, `src/drivers/claude.ts`, `src/drivers/pi.ts` |
| Frontends | `src/frontends/types.ts`, `src/frontends/discord.ts`, `src/frontends/tui.ts` |
| Wiring | `src/main.ts`, `src/commands/init.ts` |
| Secrets | `src/resources.ts` |
