# Error Handling & Stack Traces

**Every error must preserve its full stack trace.** Stack traces are critical for debugging — never discard them.

## Core Rules

- Use `toError(err)` from `src/resources.ts` to normalize `unknown` catch values before passing to the logger or extracting `.message`
- Use pino's `err` serializer key with a full `Error` object
- Always catch the error variable (`catch (err)`) and log it, even if the operation is non-fatal

## In Logger Calls

Always use pino's `err` serializer key with a full `Error` object:

```typescript
} catch (err) {
  const error = toError(err);
  logger.error({ err: error, channel_id: id }, "query_error");
}
```

This serializes `message`, `stack`, and `type` automatically. **Never** use `{ error: String(err) }` or `{ error: err.message }` — these strip the stack.

## In User-Facing Output

Display `error.message` for the user, but also log the full error with the logger:

```typescript
} catch (err) {
  const error = toError(err);
  logger.error({ err: error }, "reload_error");
  await message.channel.send(`Reload failed: ${error.message}`);
}
```

## Never Use Bare `catch {}`

Always catch the error variable and log it:

```typescript
} catch (err) {
  logger.warn({ err: toError(err) }, "config_backup_failed");
}
```
