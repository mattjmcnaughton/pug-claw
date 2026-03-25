# Technical Roadmap

Infrastructure, deployment, and engineering work.

---

## Storage & Persistence

Pluggable backends for databases and file stores.

- [ ] Storage provider interface: abstract over where data lives
- [ ] Database backends: SQLite (default/local), PostgreSQL (production) — *partial: SQLite runtime DB added for scheduler metadata only*
- [ ] File store backends: local filesystem (default), S3-compatible
- [ ] Prisma for schema management and migrations (introduce when DB schemas stabilize)
- [ ] Configuration in `config.json` under a `[storage]` section

---

## Type Normalization

- [ ] Audit and tighten core types (`DriverResponse`, `DriverOptions`, `FrontendContext`)
- [x] Shared constants for driver names, tool names, command prefixes

---

## Process Management

- [x] SystemD unit file generation (`pug-claw init-service`)
- [ ] Graceful shutdown: drain sessions, flush logs — *partial: frontends call `destroySession()` on quit/Ctrl+C; no system-wide signal handlers or log flushing*
- [ ] Health check endpoint (for systemd watchdog, uptime monitoring)
- [ ] JSONL structured logs from all agent interactions (audit trail) — *partial: scheduler JSONL audit logs implemented; full conversation audit trail still pending*

---

## Safe Restart

Ability to restart the process cleanly, and to roll back to the last known good state if something goes wrong.

- [ ] Graceful restart command / signal handler (finish in-flight work, then restart)
- [ ] State snapshot on shutdown (active sessions, pending jobs, config version)
- [ ] Restore from snapshot on startup (resume where we left off)
- [ ] Last-known-good config: persist last config that booted successfully
- [ ] `pug-claw rollback` — restart using last-known-good config + binary
- [ ] Automatic rollback on crash loop (N crashes in M minutes → revert)

---

## Deploy Pipeline

- [ ] Deploy to VM (manual first run)
- [ ] Automated deploy script or CI job (build → scp/rsync → restart service)
- [ ] Smoke test after deploy (health check passes before marking deploy as good)

---

## Containerization

- [ ] Dockerfile and docker-compose for local/dev deployment (get mounts right for `~/.pug-claw`)
- [ ] Helm chart for Kubernetes deployment
- [ ] Singleton enforcement: only one pug-claw instance should run at a time (shared filesystem lock, DynamoDB lease, or similar)
- [ ] Document volume mount strategy for config, data, and logs

---

## Quality

- [ ] Better test coverage (frontends, drivers, integration with real APIs)
- [ ] Refactoring pass on shared frontend logic (Discord + TUI command handling is still duplicated; agent resolution extracted to `src/agents.ts`)
- [ ] Error recovery and retry logic for drivers
- [ ] Dev mode hot reload (`bun --watch`)
- [ ] Agent/skill scaffolding CLI (`pug-claw new-agent`, `pug-claw new-skill`)

---

## Future / Someday

- [ ] Observability: metrics (Prometheus), tracing (OpenTelemetry)
