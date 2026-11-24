# Terminnia

A free, anonymous, browser-based SQL workspace with a focused editor and a local database. No account, API key, application server, or hosted database is required.

## Current capabilities

- Execute SQL in a real SQLite WebAssembly engine running in a dedicated Web Worker, so query execution does not block the editor UI.
- CodeMirror SQL editor with syntax highlighting, line wrapping, and Ctrl/Cmd + Enter execution.
- Sample `employees` and `departments` tables on first launch.
- Execute multiple SQL statements and inspect separate result sets.
- Browse tables and inspect column metadata.
- Query history stored locally in the browser.
- Import and export SQLite database files.
- Export query results to CSV and download SQL scripts.
- Automatic local database snapshots in IndexedDB after query execution.
- Responsive desktop and mobile workspace.
- No login, API key, or remote database connection.

## Run locally

Serve this directory with any static HTTP server and open its URL. Do not open `index.html` directly using a `file://` URL because browser module imports, Web Workers, and WebAssembly require a secure or local HTTP origin.

The editor loads CodeMirror modules and the SQLite WebAssembly runtime from pinned public CDN URLs. The first load therefore requires an internet connection. After the runtime has loaded, SQL execution and database storage happen locally in the browser.

## SQL compatibility

**This release executes SQLite SQL, not MySQL.** It supports SQLite statements such as `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE TABLE`, `ALTER TABLE`, joins, aggregates, views, indexes, common table expressions, and transactions, subject to the SQLite engine's own syntax and feature support.

It is not a MySQL or MariaDB server. MySQL-specific statements such as `SHOW DATABASES`, `USE database_name`, `AUTO_INCREMENT`, stored procedures, and MySQL-specific functions are not guaranteed to work. The interface identifies the engine as SQLite to avoid misleading users.

## Local data and backups

The active database is held by the SQL worker and its saved snapshot is stored in IndexedDB for the current browser profile. Export the database regularly if it contains important work. Browser site-data clearing, private browsing cleanup, storage eviction, or device loss can remove the local copy. Imported databases replace the current local database.

## Reliability notes

- SQL runs in a Web Worker to keep long-running statements from freezing the editor interface.
- Result rendering is capped at 5,000 rows per result set to avoid rendering extremely large tables into the page. Use SQL `LIMIT` to inspect large datasets safely.
- Explicit write transactions are saved when committed. Finish or roll back a transaction before exporting a database backup.
- A browser that blocks the required CDN, WebAssembly, Web Worker, or IndexedDB capabilities cannot run this version.
- This project does not yet claim multi-tab write coordination, server-side backups, or a production MySQL compatibility layer.

## License

See repository license information.
