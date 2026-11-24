import { DatabaseAdapter } from './adapter.mjs';

/**
 * Remote adapter for the isolated Terminnia MySQL runner.
 * Session capabilities remain in memory and are never written to browser storage.
 */
export class MysqlSandboxAdapter extends DatabaseAdapter {
  #baseUrl;
  #fetch;
  #session = null;
  #connected = false;

  constructor({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
    super();
    if (typeof baseUrl !== 'string' || !/^https?:\/\//i.test(baseUrl)) {
      throw new TypeError('MysqlSandboxAdapter requires an absolute HTTP(S) runner URL.');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('A Fetch-compatible implementation is required.');
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#fetch = fetchImpl;
  }

  async connect() {
    if (this.#connected) return this.getConnectionInfo();
    const response = await this.#fetch(this.#baseUrl + '/api/sandboxes', {
      method: 'POST', cache: 'no-store', credentials: 'omit'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.id || !body.token) throw new Error(body.error || 'Could not create a MySQL learning sandbox.');
    this.#session = { id: body.id, token: body.token, expiresInSeconds: body.expiresInSeconds, maxLifetimeSeconds: body.maxLifetimeSeconds };
    this.#connected = true;
    return this.getConnectionInfo();
  }

  async disconnect() {
    if (!this.#session) { this.#connected = false; return; }
    const session = this.#session;
    this.#session = null;
    this.#connected = false;
    await this.#request('/api/sandboxes/' + encodeURIComponent(session.id), { method: 'DELETE' }, session, true);
  }

  async getConnectionInfo() {
    return {
      engine: 'mysql', version: '8.4', mode: 'remote-sandbox',
      connected: this.#connected,
      expiresInSeconds: this.#session?.expiresInSeconds ?? null
    };
  }

  async execute(sql) {
    this.#requireConnection();
    if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('SQL must be a non-empty string.');
    return this.#request('/api/sandboxes/' + this.#session.id + '/execute', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql })
    });
  }

  async listObjects(types = ['table', 'view']) {
    this.#requireConnection();
    const data = await this.#request('/api/sandboxes/' + this.#session.id + '/schema', { method: 'GET' });
    const allowed = new Set(types);
    return (data.objects || []).map(row => ({
      name: String(row[0]),
      type: String(row[1]).toUpperCase() === 'VIEW' ? 'view' : 'table'
    })).filter(item => allowed.has(item.type));
  }

  async describeObject(name, type = 'table') {
    this.#requireConnection();
    if (!['table', 'view'].includes(type)) throw new TypeError('Unsupported MySQL object type.');
    const result = await this.execute('SHOW FULL COLUMNS FROM ' + quoteIdentifier(name));
    const rows = result.results?.[0]?.values || [];
    return {
      name, type,
      columns: rows.map(row => ({
        name: row[0], type: row[1], notnull: row[2] === 'NO',
        pk: row[3] === 'PRI', defaultValue: row[5], extra: row[6]
      }))
    };
  }

  async listIndexes(name) {
    const result = await this.execute('SHOW INDEX FROM ' + quoteIdentifier(name));
    return result.results?.[0]?.values || [];
  }

  async listForeignKeys(name) {
    const table = quoteLiteral(name);
    const result = await this.execute(
      'SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME ' +
      'FROM information_schema.KEY_COLUMN_USAGE ' +
      'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ' + table +
      ' AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION'
    );
    return result.results?.[0]?.values || [];
  }

  async getCapabilities() {
    return {
      transactions: true, multipleStatements: true, schemas: true,
      views: true, indexes: true, foreignKeys: true,
      localPersistence: false, readOnlyByDefault: false,
      storedProcedures: true, storedFunctions: true, accountPrivileges: true
    };
  }

  async reset() {
    this.#requireConnection();
    return this.#request('/api/sandboxes/' + this.#session.id + '/reset', { method: 'POST' });
  }

  async #request(path, options = {}, session = this.#session, allowDisconnected = false) {
    if (!session || (!this.#connected && !allowDisconnected)) throw new Error('MySQL sandbox is not connected.');
    const response = await this.#fetch(this.#baseUrl + path, {
      ...options, cache: 'no-store', credentials: 'omit',
      headers: { ...(options.headers || {}), authorization: 'Bearer ' + session.token }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        this.#session = null;
        this.#connected = false;
      }
      throw new Error(body.error || 'MySQL sandbox request failed (' + response.status + ').');
    }
    return body;
  }

  #requireConnection() {
    if (!this.#connected || !this.#session) throw new Error('MySQL sandbox is not connected.');
  }
}

function quoteIdentifier(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('MySQL object name is required.');
  return '`' + value.replace(/`/g, '``') + '`';
}
function quoteLiteral(value) {
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}
