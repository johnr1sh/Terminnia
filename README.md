# Terminnia

A free, browser-based SQL workspace inspired by Spck's focused editor experience and Coddy's interactive SQL playground.

## Features

- Real SQLite execution in the browser using SQLite WebAssembly (sql.js).
- SQL editor with syntax highlighting, autocomplete, line wrapping, and Ctrl/Cmd + Enter execution.
- Starter database with sample employees and departments.
- Browse tables and inspect column schemas.
- Create tables and insert rows from the interface; use SQL for SELECT, INSERT, UPDATE, DELETE, JOIN, CTEs, aggregates, and transactions.
- Results and execution messages.
- Import and export SQLite database files; download SQL scripts.
- Local persistence with IndexedDB and query persistence with local storage.
- Responsive desktop and mobile layout.

## Use

Open index.html from a static host or local web server. The first load downloads the editor modules and SQLite WebAssembly engine from public CDNs. SQL execution itself happens in the browser. No API key, account, hosted SQL database, or Terminnia server is required.

## Privacy and compatibility

The database stays in the current browser profile. Clearing browser site data removes its locally saved database. This version runs SQLite; it does not claim to connect to a remote MariaDB/MySQL server.
