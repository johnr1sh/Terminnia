# Terminnia MySQL Learning Sandbox

Status: product architecture decision; implementation and hosting proof still required
Audience: students using phones or tablets without a locally installed MySQL server
Primary goal: execute real MySQL laboratory scripts in a browser without requiring a computer, account, API key, or local installation

## The problem Terminnia must solve

The supplied laboratory activities require a real MySQL server, not a syntax-highlighting editor or a SQLite compatibility layer.

Required capabilities include:

- Database and table creation, inserts, updates, deletes, primary keys, auto-increment columns, and foreign keys.
- INNER, LEFT, RIGHT, and CROSS JOIN.
- GROUP BY, HAVING, aggregate functions, and multi-statement scripts.
- Stored procedures with IN parameters, stored functions, and calls to those routines.
- MySQL accounts, CREATE USER, SHOW GRANTS, GRANT, and REVOKE.
- Testing permissions using separate database accounts.
- Clear result grids, error messages, and screenshots suitable for laboratory submissions.

The existing SQLite engine can remain useful for offline SQL practice. It cannot be presented as MySQL and cannot satisfy the stored-program and account-privilege exercises.

## Product decision

Terminnia will have two explicitly named execution modes:

1. **MySQL Lab (primary for MySQL coursework):** a real, isolated MySQL server sandbox hosted remotely. Students open Terminnia in a mobile browser and run MySQL scripts without installing anything.
2. **Local SQLite (offline mode):** the existing browser-based SQLite database. It remains independent and is never silently converted or uploaded to MySQL.

The editor must show the active engine and version. It must never label SQLite results as MySQL results.

## Required execution architecture

A browser cannot safely host a full MySQL server using the current SQL.js runtime. The hosted MySQL engine must run outside the browser.

Use a dedicated Docker-capable sandbox runner, separate from the static Vercel frontend:

- The frontend calls a narrow HTTPS API.
- The runner provisions one disposable MySQL 8.4 container per active student sandbox.
- Each container has its own isolated filesystem, process namespace, database data directory, and resource limits.
- The container has no public inbound port and no outbound network access.
- Only the runner's private control plane can create, inspect, stop, and destroy sandboxes.
- A sandbox starts with a MySQL administrative account inside that sandbox so the lab's CREATE USER, GRANT, REVOKE, and SHOW GRANTS exercises can be performed without affecting another student.
- The sandbox is destroyed after an idle timeout and has a hard maximum lifetime. The UI warns students to export their SQL script before expiry.
- The SQL script and results are returned to the browser. Database state is temporary unless the student exports a script or supported backup artifact.

Do not use one shared MySQL account/database for all anonymous students. Database-level namespacing alone is insufficient for the account-management laboratory because CREATE USER and privilege operations affect server-level accounts.

## API boundary

Initial API shape:

- POST /api/sandboxes — create an isolated MySQL sandbox and return a random, high-entropy session capability.
- POST /api/sandboxes/:id/execute — execute a SQL script inside that sandbox.
- GET /api/sandboxes/:id/schema — return bounded schema metadata.
- POST /api/sandboxes/:id/reset — destroy and recreate the sandbox.
- DELETE /api/sandboxes/:id — stop and destroy the sandbox.

The session capability is a bearer secret. Keep it in browser memory or session-scoped storage, never in URLs, analytics, logs, or persistent shared storage. Enforce short expiry and ownership checks on every request.

The execute API must support MySQL client delimiter directives (for example, DELIMITER //) so stored procedures and functions can be submitted as normal laboratory scripts. DELIMITER is a client command, not a statement sent to the MySQL server; the runner must parse it safely and send complete statements to the MySQL driver.

## Isolation and abuse controls — release blockers

A public anonymous SQL runner executes untrusted code. Do not expose it until these controls are implemented and tested:

- One sandbox per active session; no cross-session filesystem, process, socket, or database access.
- No public MySQL TCP port and no outbound network from SQL containers.
- CPU, memory, process, disk, statement-time, output-byte, and result-row limits.
- Maximum concurrent sandboxes and per-client creation/query rate limits.
- High-entropy unguessable session capabilities, short idle TTL, hard lifetime, and reliable cleanup.
- Request-body and SQL-script size limits.
- Cancellation and forced termination for runaway queries.
- No credential collection from students and no external database connection feature in anonymous learning mode.
- Never log SQL text, result data, or session bearer secrets by default.
- Sanitized errors and bounded result rendering.
- Security tests for session enumeration, cross-session access, resource exhaustion, network access, cleanup, and privilege isolation.

A shared in-memory rate counter in a serverless function is not a sufficient abuse control. The runner needs an authoritative shared concurrency/quota mechanism.

## Deployment reality

Vercel remains suitable for the static frontend and ordinary HTTP application routes. It is not a Docker host and does not provide a persistent MySQL daemon or per-request container isolation.

The MySQL runner therefore needs a separate Docker-capable compute host. Do not claim the whole product is free, always-on, or production-ready until the actual provider limits, sleeping behavior, concurrency, storage, network isolation, and operating cost have been verified.

If a truly free runner cannot meet the security and reliability requirements, keep MySQL Lab clearly marked as unavailable rather than silently falling back to SQLite or exposing an unsafe shared database.

## Acceptance tests from the supplied laboratory activities

### JOIN laboratory

- Create the students, courses, and enrollments tables with foreign keys.
- Insert the supplied records.
- Verify INNER, LEFT, RIGHT, and CROSS JOIN result sets.
- Verify JOIN with WHERE, GROUP BY/COUNT, and HAVING.
- Verify the seven challenge queries and the final registrar report.

### Advanced MySQL laboratory

- Create the students table and supplied records.
- Verify GROUP BY and HAVING tasks.
- Create and call GetAllStudents, GetStudentsByProgram, GetStudentsByYear, GetStudentsWithBalance, and SearchStudents.
- Create and call UpdateStudentPayment with its validation rules.
- Create and call CalculateBalance, GetPaymentStatus, and GetTuitionDiscount.
- Create student_user, teacher_user, report_user, and admin_assistant.
- Verify SHOW GRANTS, GRANT, REVOKE, and actual allowed/denied operations using separate accounts.

The supplied activity sheets are the acceptance-test source. Do not substitute SQLite approximations for MySQL-specific tasks.

## Delivery sequence

1. Keep the existing SQLite mode stable and clearly labeled.
2. Prove a Docker-capable runner can create and destroy an isolated MySQL 8.4 sandbox.
3. Prove the exact laboratory scripts run, including stored routines and user privilege operations.
4. Add isolation, abuse, timeout, and cleanup tests.
5. Connect the existing adapter interface to the MySQL sandbox API.
6. Only then add the MySQL Lab mode to the interface and run the complete mobile browser acceptance suite.
7. Configure production promotion to require all checks.

## Current truthful status

- Local SQLite engine: implemented.
- Local SQLite adapter: implemented.
- MySQL execution in Terminnia: not implemented.
- Initial Docker-based MySQL 8.4 runner service: implemented in `runner/server.mjs` with per-session containers, bearer capabilities, in-memory TTL tracking, bounded execution, reset/delete, and container cleanup.
- Runner unit tests: added to the quality workflow; results must be checked for the current commit.
- MySQL runner deployment: not configured; no Docker-capable host or production endpoint is connected.
- Frontend MySQL adapter/mode: not implemented; the editor still runs Local SQLite only.
- End-to-end verification of stored routines, user privileges, output parsing, and hostile-query behavior through the runner: not complete.
- Production-safe anonymous MySQL execution: not proven. The runner is an initial implementation and must not be publicly exposed until the security and deployment blockers in `runner/README.md` are closed.
