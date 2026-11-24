/**
 * Stable database adapter contract shared by local and remote engines.
 * Implementations expose the same operations without coupling the UI to a
 * specific SQL dialect or transport.
 */
export class DatabaseAdapter {
  async connect(_options = {}) { throw new Error('connect() is not implemented'); }
  async disconnect() { throw new Error('disconnect() is not implemented'); }
  async getConnectionInfo() { throw new Error('getConnectionInfo() is not implemented'); }
  async execute(_sql, _options = {}) { throw new Error('execute() is not implemented'); }
  async listObjects(_types = ['table', 'view']) { throw new Error('listObjects() is not implemented'); }
  async describeObject(_name, _type = 'table') { throw new Error('describeObject() is not implemented'); }
  async listIndexes(_name) { throw new Error('listIndexes() is not implemented'); }
  async listForeignKeys(_name) { throw new Error('listForeignKeys() is not implemented'); }
  async getCapabilities() { throw new Error('getCapabilities() is not implemented'); }
}

export const DATABASE_ADAPTER_METHODS = Object.freeze([
  'connect', 'disconnect', 'getConnectionInfo', 'execute', 'listObjects',
  'describeObject', 'listIndexes', 'listForeignKeys', 'getCapabilities'
]);

export function assertDatabaseAdapter(adapter) {
  const missing = DATABASE_ADAPTER_METHODS.filter(
    method => typeof adapter?.[method] !== 'function'
  );
  if (missing.length) {
    throw new TypeError('Database adapter is missing required methods: ' + missing.join(', '));
  }
  return adapter;
}
