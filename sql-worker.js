/* Terminnia database worker. All SQLite work stays off the UI thread. */
'use strict';

const VERSION = '1.15.2';
let SQL = null;
let db = null;

function reply(id, payload, transfer = []) {
  self.postMessage({ id, ...payload }, transfer);
}

function snapshot() {
  if (!db) return null;
  try {
    const bytes = db.export();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return buffer;
  } catch (error) {
    // SQLite cannot export an open write transaction. The next COMMIT will save it.
    return { deferred: true, reason: error.message };
  }
}

function metadata() {
  const result = db.exec("SELECT total_changes() AS changes");
  const schema = db.exec("PRAGMA schema_version");
  return {
    changes: Number(result[0]?.values?.[0]?.[0] || 0),
    schemaVersion: Number(schema[0]?.values?.[0]?.[0] || 0)
  };
}

function normalizeResults(results) {
  const MAX_ROWS = 5000;
  return results.map((result) => ({
    columns: result.columns || [],
    values: (result.values || []).slice(0, MAX_ROWS),
    rowCount: (result.values || []).length,
    truncated: (result.values || []).length > MAX_ROWS
  }));
}

self.onmessage = async (event) => {
  const { id, action, sql, buffer, name } = event.data || {};
  try {
    if (action === 'init') {
      if (!SQL) {
        importScripts('https://cdn.jsdelivr.net/npm/sql.js@' + VERSION + '/dist/sql-wasm.js');
        SQL = await self.initSqlJs({
          locateFile: (file) => 'https://cdn.jsdelivr.net/npm/sql.js@' + VERSION + '/dist/' + file
        });
      }
      db = buffer ? new SQL.Database(new Uint8Array(buffer)) : new SQL.Database();
      if (!buffer) {
        db.run("CREATE TABLE departments(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, budget REAL); CREATE TABLE employees(id INTEGER PRIMARY KEY, name TEXT NOT NULL, department TEXT NOT NULL, salary REAL, hired_on TEXT DEFAULT CURRENT_DATE); INSERT INTO departments(name,budget) VALUES('Engineering',180000),('Design',90000),('Operations',120000); INSERT INTO employees(name,department,salary) VALUES('Alex Morgan','Engineering',85000),('Maria Santos','Design',72000),('Jordan Lee','Engineering',91000),('Sam Rivera','Operations',65000),('Taylor Kim','Design',78000);");
      }
      const initialSnapshot = snapshot();
      const response = { ok: true, version: VERSION };
      const transfer = [];
      if (initialSnapshot instanceof ArrayBuffer) { response.snapshot = initialSnapshot; transfer.push(initialSnapshot); }
      reply(id, response, transfer);
      return;
    }

    if (!db) throw new Error('Database is not initialized. Reload Terminnia and try again.');

    if (action === 'exec') {
      const before = metadata();
      const started = performance.now();
      let results;
      let error = null;
      try {
        results = db.exec(String(sql || ''));
      } catch (cause) {
        error = { message: cause.message || String(cause), name: cause.name || 'SqlError' };
      }
      const after = metadata();
      const changed = before.changes !== after.changes || before.schemaVersion !== after.schemaVersion;
      let saved = null;
      if (changed || action === 'exec') saved = snapshot();
      const response = {
        ok: !error,
        results: normalizeResults(results || []),
        durationMs: performance.now() - started,
        rowsChanged: Math.max(0, after.changes - before.changes),
        error,
        snapshotDeferred: !!saved?.deferred
      };
      const transfer = [];
      if (saved instanceof ArrayBuffer) {
        response.snapshot = saved;
        transfer.push(saved);
      }
      reply(id, response, transfer);
      return;
    }

    if (action === 'export') {
      const saved = snapshot();
      if (saved?.deferred) throw new Error('Finish or roll back the active transaction before exporting the database.');
      reply(id, { ok: true, buffer: saved }, [saved]);
      return;
    }

    if (action === 'import') {
      const next = new SQL.Database(new Uint8Array(buffer));
      if (db) db.close();
      db = next;
      const saved = snapshot();
      reply(id, { ok: true, snapshot: saved }, saved instanceof ArrayBuffer ? [saved] : []);
      return;
    }

    if (action === 'tables') {
      const result = db.exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
      reply(id, { ok: true, tables: result[0]?.values || [] });
      return;
    }

    if (action === 'schema') {
      const stmt = db.prepare('PRAGMA table_info(' + quoteIdentifier(name) + ')');
      const columns = [];
      try { while (stmt.step()) columns.push(stmt.getAsObject()); }
      finally { stmt.free(); }
      reply(id, { ok: true, columns });
      return;
    }

    throw new Error('Unknown database operation: ' + action);
  } catch (error) {
    reply(id, { ok: false, error: { message: error.message || String(error), name: error.name || 'Error' } });
  }
};

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}
