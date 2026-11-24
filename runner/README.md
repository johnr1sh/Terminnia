# Terminnia MySQL sandbox runner

This is a separate Docker-hosted API service. It is not a Vercel Function. It creates one disposable MySQL 8.4 container per anonymous session and executes SQL through `docker exec`; MySQL never publishes a TCP port.

## Local development

Requirements: Linux host, Node.js 22+, Docker Engine, permission to access the Docker daemon, and the MySQL 8.4 image.

```sh
docker pull mysql:8.4
RUNNER_ALLOWED_ORIGINS=http://localhost:4173 NODE_ENV=development node runner/server.mjs
```

The runner listens on port 8787. The Docker socket/CLI is a host-root-equivalent control plane. Run this service only on a dedicated, disposable VM whose Docker daemon contains no unrelated workloads. Do not mount a general-purpose host Docker socket into an untrusted multi-tenant application.

## Deployment template

A constrained Docker Compose template is provided at `compose.runner.yml`. On a dedicated Docker-capable Linux VM, copy `runner/.env.example` to the project-root `.env`, replace the example frontend origin and MySQL image placeholder with a reviewed immutable digest, then run:

\`\`\`sh
cp runner/.env.example .env
# Edit .env before starting the service.
docker compose -f compose.runner.yml up -d --build
\`\`\`

The API binds to `127.0.0.1` on the host so a separately configured TLS reverse proxy can expose it. Do not publish port 8787 directly to the internet. The mounted Docker socket gives the runner root-equivalent control of the dedicated host.

## API

- `POST /api/sandboxes` creates a sandbox and returns its ID and one-time bearer capability.
- `POST /api/sandboxes/:id/execute` accepts JSON `{"sql":"..."}`. To test account privileges, it also accepts optional `username` and `password` fields; credentials are written to a randomly named, mode-0600 option file inside the sandbox's temporary `/tmp` filesystem for that one execution, then deleted; they are not stored in the session or passed as Docker process arguments.
- `GET /api/sandboxes/:id/schema` lists tables and views.
- `POST /api/sandboxes/:id/reset` replaces the sandbox database.
- `DELETE /api/sandboxes/:id` destroys it.
- `GET /health` reports process health.

Send the returned capability as `Authorization: Bearer ...`. Keep the sandbox capability in browser memory only. Never place it in a URL or logs. Send requests over HTTPS in any hosted deployment; student account passwords are used only for the requested execution and are removed from the sandbox temporary filesystem afterward. Configure exact comma-separated browser origins with `RUNNER_ALLOWED_ORIGINS`.

## Isolation and limits

Every SQL container uses Docker's `none` network, no published ports, a read-only root filesystem, bounded tmpfs storage, 512 MB memory, one CPU, a 128-process limit, bounded file descriptors and container logs, dropped Linux capabilities, and no-new-privileges. Each container is removed on reset, explicit deletion, idle expiry (20 minutes), or hard expiry (2 hours). SQL input is limited to 64 KB, each execution to 8 seconds, output to 1 MB, and returned rows to 5,000. The runner caps active sessions at eight and applies per-process creation/query rate limits. Each API execution opens a fresh MySQL client connection; the selected database is retained between requests, but connection-scoped state such as user variables, temporary tables, prepared statements, and open transactions is not. Keep those operations in the same submitted SQL script.

## Important deployment blockers

This is an initial runner implementation, not yet a production-safe public service.

- It requires a dedicated Docker-capable Linux host; Vercel cannot run it.
- The runner must be deployed as a single replica. Session ownership and rate counters are currently process-local. Startup cleanup removes all containers carrying this runner's label, so multiple replicas sharing one Docker daemon are not supported.
- Put a trusted reverse proxy/WAF with authoritative client-IP handling, request rate limits, TLS, and request-size limits in front of it. Set `TRUST_PROXY=1` only when that proxy overwrites `X-Forwarded-For`; otherwise leave it disabled. The in-process rate limiter is only a secondary guard and is not distributed.
- Pin `MYSQL_IMAGE` to a reviewed immutable image digest before production. The default tag is for local development only.
- The runner process can control Docker and is therefore effectively root on its dedicated host. Do not co-locate unrelated workloads or secrets on that host.
- MySQL CLI output parsing and the exact coursework stored-routine/account-privilege scripts still require end-to-end integration tests against the pinned image.
- Add external monitoring, capacity alarms, host disk/inode limits, backup-free ephemeral host policy, and a tested incident shutdown procedure before public exposure.
- Do not expose the API publicly until the security acceptance tests in `docs/MYSQL-LEARNING-SANDBOX.md` pass.

The API intentionally has no external database connector and no persistent student data. Users should export their SQL scripts before a session expires.
