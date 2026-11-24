import { DatabaseAdapter } from './adapter.mjs';

/**
 * SQLite implementation over the existing SQL worker RPC transport.
 * The transport must expose request(action, payload) and may expose close().
 */
export class SQLiteAdapter extends DatabaseAdapter {
  constructor(transport) {
    super();
    if (typeof transport?.request !== 'function') {
      throw new TypeError('SQLiteAdapter requires a transport.request function.');
    }
    this.transport = transport;
    this.connected = false;
  }

  async connect(options = {}) {
    const result = await this.transport.request('init', options);
    if (!result?.ok) throw new Error(result?.error?.message || 'SQLite initialization failed.');
    this.connected = true;
    return this.getConnectionInfo();
  }

  async disconnect() {
    if (typeof this.transport.close === 'function') await this.transport.close();
    this.connected = false;
  }

  async getConnectionInfo() {
    return { engine: 'sqlite', mode: 'local', connected: this.connected };
  }

  async execute(sql, options = {}) {
    this.#requireConnection();
    if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('SQL must be a non-empty string.');
    const result = await this.transport.request('exec', { sql, ...options });
    if (!result?.ok) throw new Error(result?.error?.message || 'SQLite query failed.');
    return result;
  }

  async listObjects(types = ['table', 'view']) {
    this.#requireConnection();
    const result = await this.transport.request('tables');
    if (!result?.ok) throw new Error(result?.error?.message || 'Could not list SQLite objects.');
    const allowed = new Set(types);
    return (result.tables || [])
      .filter(([, type]) => allowed.has(type))
      .map(([name, type]) => ({ name, type }));
  }

  async describeObject(name, type = 'table') {
    this.#requireConnection();
    if (!['table', 'view'].includes(type)) throw new TypeError('Unsupported SQLite object type.');
    const result = await this.transport.request('schema', { name });
    if (!result?.ok) throw new Error(result?.error?.message || 'Could not inspect SQLite object.');
    return { name, type, columns: result.columns || [] };
  }

  async listIndexes(name) {
    const result = await this.execute('PRAGMA index_list(' + quoteIdentifier(name) + ')');
    return result.results?.[0]?.values || [];
  }

  async listForeignKeys(name) {
    const result = await this.execute('PRAGMA foreign_key_list(' + quoteIdentifier(name) + ')');
    return result.results?.[0]?.values || [];
  }

  async getCapabilities() {
    return {
      transactions: true,
      multipleStatements: true,
      schemas: false,
      views: true,
      indexes: true,
      foreignKeys: true,
      localPersistence: true,
      readOnlyByDefault: false
    };
  }

  #requireConnection() {
    if (!this.connected) throw new Error('SQLite adapter is not connected.');
  }
}

function quoteIdentifier(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Object name is required.');
  return '"' + value.replace(/"/g, '""') + '"';
}
