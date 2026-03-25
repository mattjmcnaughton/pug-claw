# Known Bugs

- [ ] Claude driver `tool_progress` events never fire in `bypassPermissions` mode — `onEvent` callback receives no tool-use events, so Discord tool-use notifications and structured logging of tool calls are silently broken. Discovered during e2e testing. Likely an SDK limitation or missing event subscription.
