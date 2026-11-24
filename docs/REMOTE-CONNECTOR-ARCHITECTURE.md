# Terminnia hybrid database architecture decision

Status: Stage 2 architecture documented; shared adapter contract and local SQLite adapter implemented
Baseline: `main` after the Stage 1 reliability commits
Product direction: local-first hybrid SQL workspace

## Decision

Terminnia will retain browser-local SQLite as its default and fully independent mode. MySQL/MariaDB will be an optional remote adapter behind a separate connector boundary.

The application must never imply that local SQLite is a MySQL server, that local data is automatically uploaded, or that all remote hosts are reachable from the hosted connector.

## Feasibility proof

A generic browser cannot open a raw MySQL TCP socket. A remote connection therefore requires a server-side Node.js connector or a separately operated gateway.

Vercel Node.js Functions support Node.js APIs and are intended to communicate with external databases. The Vercel database connection guidance documents use of MySQL drivers such as mysql2 and connection-pool considerations. This establishes technical feasibility for a hosted connector on supported, publicly reachable database endpoints.

It does not establish universal reachability:

- Vercel Hobby egress uses a changing pool of outbound IP addresses.
- Stable static egress IPs are a Pro/Enterprise networking capability. Vercel's pricing currently lists Static IPs as a paid Pro feature at $100 per project per month, before applicable data-transfer charges.
- Databases behind private VPCs, firewalls, VPNs, or strict IP allowlists may not accept connections from the hosted Hobby function.
- Some managed database providers require their own pooler or connection endpoint.
- Serverless functions are not persistent database sessions. The connector must treat each operation as a bounded request and close connections reliably, or use a safe provider-managed pool where supported.

Sources:
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/kb/guide/connection-pooling-with-functions
- https://vercel.com/changelog/static-ips-are-now-available-for-more-secure-connectivity
- https://vercel.com/pricing

## Connector options

### Option A — Hosted connector for eligible public endpoints

A Vercel Node.js Function using a pinned MySQL driver can connect to a publicly reachable MySQL/MariaDB endpoint.

Supported only when:
- The endpoint is reachable from Vercel's current outbound network.
- The database owner permits that network path.
- The database supports TLS.
- The endpoint passes strict hostname and resolved-IP validation.
- The connection and query fit configured time and resource limits.

This mode cannot promise static source IP allowlisting on the current Hobby deployment.

### Option B — Self-hosted gateway for restricted networks

For databases behind private networks, VPNs, firewalls, or IP allowlists, provide a separately deployable gateway that the database owner runs within their own network.

This avoids pretending that the hosted Vercel function can reach private infrastructure. It adds setup work and is therefore an advanced connection option, not the default path.

### Explicit non-goal

Do not build a public, unrestricted TCP proxy. Do not accept arbitrary network destinations without validation. Do not offer a connection screen that suggests every hostname or private database is supported.

## Security requirements before any hosted connector is enabled

A public anonymous connector can be abused as an open database proxy or SSRF primitive. It must not ship until all of the following are implemented and tested:

1. Accept only HTTPS requests and POST bodies. Never put credentials in URLs.
2. Accept a hostname and port as separate validated fields; reject URL schemes, paths, malformed hosts, and disallowed ports.
3. Resolve DNS before connecting. Reject loopback, private, link-local, multicast, reserved, and cloud metadata address ranges for both IPv4 and IPv6.
4. Pin the validated DNS result for the socket connection to prevent DNS rebinding between validation and connection.
5. Preserve TLS hostname verification against the original hostname.
6. Require TLS for the hosted connector. Do not silently downgrade.
7. Apply strict connection timeout, query timeout, response byte limit, row limit, concurrency limit, and request-body limit.
8. Apply abuse controls and rate limits at the edge or with a shared quota store. Per-instance in-memory counters alone are not sufficient for a horizontally scaled public service.
9. Never log request bodies, passwords, connection strings, SQL parameter values, or database result contents.
10. Never persist user-supplied credentials in Vercel environment variables, database tables, browser localStorage, IndexedDB, analytics, or error traces.
11. Keep credentials in browser memory only and transmit them over TLS for the individual operation. Clear them on disconnect, page close, or session expiry.
12. Return sanitized errors. Do not leak internal network addresses, driver stack traces, or credentials.
13. Use least-privilege database accounts. The initial remote connection mode should be read-only; writes require an explicit permission choice and must still be enforced by the database account.
14. Close every connection in a `finally` path, including timeouts, aborts, malformed SQL, and client disconnects.
15. Add abuse, SSRF, DNS-rebinding, timeout, credential-redaction, and resource-exhaustion tests before release.

If these controls cannot be implemented without an affordable shared rate-limit service or an appropriate Vercel plan, keep the hosted connector disabled and offer the self-hosted gateway path instead.

## API contract proposal

The hosted connector is stateless. It does not create durable server-side user sessions or hold open arbitrary database connections between requests.

Proposed endpoints:
- `POST /api/remote/test` — validate a connection and return sanitized server/version metadata.
- `POST /api/remote/query` — execute one bounded SQL request and return bounded result sets.
- `POST /api/remote/metadata` — return tables, views, columns, indexes, and foreign-key metadata.

Every request includes the connection details in its HTTPS body. The function uses them for that operation only and closes the connection before responding. The frontend retains credentials in memory only.

Proposed request shape:

```json
{
  "connection": {
    "engine": "mysql",
    "host": "db.example.net",
    "port": 3306,
    "database": "app",
    "username": "readonly_user",
    "password": "provided-at-runtime",
    "tls": true
  },
  "operation": {
    "type": "query",
    "sql": "SELECT 1"
  }
}
```

This is a design contract, not an implemented endpoint. Do not store the sample credential or send it to any service.

## Adapter contract

The UI must depend on engine-neutral operations, not on SQL.js internals:

- `connect(config)`
- `disconnect()`
- `getConnectionInfo()`
- `execute(sql, options)`
- `listObjects(types)`
- `describeObject(name, type)`
- `listIndexes(name)`
- `listForeignKeys(name)`
- `getCapabilities()`

Implemented in the current source:
- `database/adapter.mjs`: engine-neutral adapter contract and runtime shape validation.
- `database/sqlite-adapter.mjs`: SQLite implementation over the existing SQL worker transport.
- `app.js`: routes local connection, query execution, object listing, and schema inspection through `SQLiteAdapter` without changing the workspace UI.

Still planned, not implemented:
- `MySQLAdapter`: HTTPS connector client; MySQL dialect and MySQL metadata.
- `MariaDBAdapter`: HTTPS connector client; MariaDB dialect and MariaDB metadata.

The SQLite adapter also exposes index and foreign-key metadata methods and explicit engine capabilities. MySQL and MariaDB may share a driver initially, but the engine identity and capability differences must remain explicit. Do not reuse SQLite formatting or SQLite schema SQL for remote engines.

## Connection lifecycle and user experience

- Local SQLite is selected by default and remains available when the remote connector is down.
- Remote connection is optional and never silently uploads the local SQLite database.
- Credentials exist in memory only. Do not persist passwords across reloads.
- A remote connection is marked as disconnected after a failed health check or explicit disconnect.
- The UI must disclose that private-network and IP-allowlisted hosts may require the self-hosted gateway or a compatible egress configuration.
- Do not promise arbitrary-host support until network reachability and security tests prove it.

## Stage 2 exit criteria

- [x] Confirm a browser cannot directly open a generic MySQL TCP connection.
- [x] Confirm a Vercel Node.js Function can technically use Node.js APIs and database drivers.
- [x] Identify the static-egress restriction and its paid-plan implications.
- [x] Define a stateless adapter/API boundary.
- [x] Define security requirements for anonymous remote access.
- [x] Implement and test the shared adapter contract and worker-backed SQLite adapter without changing the UI.
- [ ] Build a minimal connector proof of concept against a real MySQL/MariaDB test database.
- [ ] Verify TLS, connection lifecycle, query timeout, and result limits against a real database.
- [ ] Verify the deployment plan and shared rate-limit/abuse controls.
- [ ] Only then build the remote connection UI.

Stage 2 architecture is defined, but the live connector proof of concept remains pending because no test database credentials or endpoint have been supplied. Do not mark remote connectivity as implemented until the remaining criteria pass.
