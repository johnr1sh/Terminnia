import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter, assertDatabaseAdapter, DATABASE_ADAPTER_METHODS } from '../database/adapter.mjs';
import { SQLiteAdapter } from '../database/sqlite-adapter.mjs';

test('adapter contract rejects incomplete implementations', async () => {
  assert.throws(() => assertDatabaseAdapter({}), /missing required methods/);
  assert.equal(DATABASE_ADAPTER_METHODS.length, 9);
  await assert.rejects(new DatabaseAdapter().connect(), /not implemented/);
});

test('SQLite adapter implements the shared lifecycle and metadata contract', async () => {
  const calls = [];
  const transport = {
    async request(action, payload) {
      calls.push({ action, payload });
      if (action === 'init') return { ok: true };
      if (action === 'tables') return { ok: true, tables: [['people', 'table'], ['active_people', 'view']] };
      if (action === 'schema') return { ok: true, columns: [{ name: 'id', type: 'INTEGER' }] };
      if (action === 'exec') return { ok: true, results: [{ columns: ['ok'], values: [[1]] }] };
      return { ok: true };
    },
    async close() { calls.push({ action: 'close' }); }
  };
  const adapter = assertDatabaseAdapter(new SQLiteAdapter(transport));

  assert.deepEqual(await adapter.connect(), { engine: 'sqlite', mode: 'local', connected: true });
  assert.deepEqual(await adapter.listObjects(['view']), [{ name: 'active_people', type: 'view' }]);
  assert.deepEqual(await adapter.describeObject('people'), {
    name: 'people', type: 'table', columns: [{ name: 'id', type: 'INTEGER' }]
  });
  assert.equal((await adapter.execute('SELECT 1')).ok, true);
  assert.equal((await adapter.getCapabilities()).localPersistence, true);
  await adapter.disconnect();
  assert.equal((await adapter.getConnectionInfo()).connected, false);
  assert.equal(calls.at(-1).action, 'close');
});

test('SQLite adapter validates connection state, SQL, and object names', async () => {
  const adapter = new SQLiteAdapter({ request: async () => ({ ok: true }) });
  await assert.rejects(adapter.execute('SELECT 1'), /not connected/);
  await adapter.connect();
  await assert.rejects(adapter.execute('   '), /non-empty string/);
  await assert.rejects(adapter.listIndexes(''), /Object name is required/);
});
