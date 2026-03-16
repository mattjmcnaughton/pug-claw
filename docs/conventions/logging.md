# Logging Conventions

All log messages use pino structured logging with a strict two-argument format.

## Format

```typescript
logger.info({ key: "value" }, "snake_case_event_tag")
```

## Rules

- **Always pass two arguments**: context object first, `snake_case` event tag string second
- **Never pass a bare string**: use `logger.info({}, "event_tag")` if there's no context, not `logger.info("event_tag")`
- **Never put error messages in the event tag**: use `logger.error({ err: error }, "query_error")`, not `logger.error(errMsg)`
- **Use `err` key for errors**: pino's built-in `err` serializer extracts `message`, `stack`, and `type`. Always pass `{ err: toError(err) }`, never `{ error: String(err) }`
- **Event tags** are `snake_case` descriptive names: `"bot_ready"`, `"command_new"`, `"session_create_error"`, `"startup_failed"`

## Levels

- `info` for normal operations
- `warn` for recoverable issues
- `error` for failures
- `fatal` for unrecoverable startup errors

## Logger Implementation

The logger is a proxy object exported from `src/logger.ts` — safe to import at module level. `configureLogger()` swaps the backing instance and all existing references update automatically.
