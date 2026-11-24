# Terminnia

A free, anonymous, browser-based SQL workspace with a focused editor and a local database. No account, API key, application server, or hosted database is required.

## Product direction: MySQL coursework without a computer

Terminnia is being developed for students who only have a phone or tablet and need to complete MySQL laboratory work in a browser. The supplied coursework requires a real MySQL server, including stored procedures, stored functions, CREATE USER, GRANT, and REVOKE. The current local SQLite engine does not support those MySQL-specific exercises and must not be represented as MySQL.

The implementation plan is to retain Local SQLite as an offline mode and add a separate, isolated MySQL Lab backed by disposable MySQL sandboxes. The editor now includes a Local SQLite / MySQL Lab engine switcher and a remote MySQL adapter. The Docker runner implements disposable MySQL 8.4 sessions, but no hosted runner endpoint is configured or deployed yet, so MySQL Lab cannot connect for public users. It is not yet safe to expose publicly. See [the MySQL Learning Sandbox architecture and acceptance tests](docs/MYSQL-LEARNING-SANDBOX.md) and the [runner deployment requirements](runner/README.md).

## Current capabilities

- Execute SQL in a real SQLite WebAssembly engine running in a dedicated Web Worker, so query execution does not block the editor UI.
- CodeMirror SQL editor with syntax highlighting, line wrapping, dialect-aware SQL formatting, and Ctrl/Cmd + Enter execution.
- Sample `employees` and `departments` tables on first launch.
- Execute multiple SQL statements and inspect separate result sets.
- Browse tables and inspect column metadata.
- Query history stored locally in the browser.
- Import and export SQLite database files.
- Export query results to CSV and download SQL scripts.
- Automatic local database snapshots in IndexedDB after query execution.
- Spck-inspired IDE workspace with an activity bar, project/database explorer, SQL file tabs, editor toolbar, status bar, and resizable output panel.
- Multiple SQL documents with browser-local tab persistence.
- Responsive desktop and mobile workspace with editor settings and Zen Mode.
- Playwright browser smoke tests and GitHub Actions quality workflow for startup, SQL execution, persistence, error recovery, and database export.
- No login, API key, or remote database credentials are needed in Local SQLite mode. MySQL Lab uses a short-lived anonymous session capability when its hosted runner is configured.

## Run locally

Use Node.js 22 or newer. To enable the MySQL Lab menu connection, set `VITE_MYSQL_RUNNER_URL` to the HTTPS URL of a deployed runner before building (see `.env.example`). The repository does not include a hosted runner URL.

```sh
npm ci
npm run build
python3 -m http.server 4173 --directory dist
```

Open `http://localhost:4173`. The Vite production build bundles CodeMirror, SQL formatting, SQL.js, and its WebAssembly runtime locally. The first page load still requires the application assets to be downloaded, but SQL execution in Local SQLite happens in the browser.

## SQL compatibility

**Local SQLite** executes SQLite SQL in the browser. **MySQL Lab** connects to a separate MySQL 8.4 sandbox when `VITE_MYSQL_RUNNER_URL` is configured at build time. The MySQL adapter supports multiple result sets, MySQL schema browsing, and student account credentials for permission testing. Each execution opens a new MySQL client connection; connection-scoped variables, temporary tables, prepared statements, and open transactions do not persist between separate Run actions. Keep those operations in one submitted script.

The MySQL runner supports database/table DDL, inserts/updates/deletes, joins, grouping and aggregates, stored procedures/functions with `DELIMITER`, and user/privilege statements. Its full coursework acceptance suite is in `tests/mysql-coursework-integration.mjs`. The runner is not deployed yet; do not assume the MySQL Lab mode is live until a hosted runner is provisioned and the production endpoint is configured.

## Local data and backups

The active database is held by the SQL worker and its saved snapshot is stored in IndexedDB for the current browser profile. Export the database regularly if it contains important work. Browser site-data clearing, private browsing cleanup, storage eviction, or device loss can remove the local copy. Imported databases replace the current local database.

## Reliability notes

- SQL runs in a Web Worker to keep long-running statements from freezing the editor interface.
- Result rendering is capped at 5,000 rows per result set to avoid rendering extremely large tables into the page. Use SQL `LIMIT` to inspect large datasets safely.
- Explicit write transactions are saved when committed. Finish or roll back a transaction before exporting a database backup.
- A browser that blocks the required CDN, WebAssembly, Web Worker, or IndexedDB capabilities cannot run this version.
- The automated browser tests run in GitHub Actions; a green workflow is required before treating a release as verified.
- This project does not yet claim multi-tab write coordination, server-side backups, or a production MySQL compatibility layer.

## License

See repository license information.
