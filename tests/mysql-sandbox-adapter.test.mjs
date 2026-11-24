import test from 'node:test';
import assert from 'node:assert/strict';
import { MysqlSandboxAdapter } from '../database/mysql-sandbox-adapter.mjs';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('connects anonymously and keeps the session capability in memory', async () => {
  const calls = [];
  const adapter = new MysqlSandboxAdapter({
    baseUrl: 'https://runner.example.test/',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ id: '123e4567-e89b-12d3-a456-426614174000', token: 'x'.repeat(43), expiresInSeconds: 1200 });
    }
  });
  const info = await adapter.connect();
  assert.equal(info.engine, 'mysql');
  assert.equal(info.connected, true);
  assert.equal(calls[0].url, 'https://runner.example.test/api/sandboxes');
  assert.equal(calls[0].options.credentials, 'omit');
  await assert.rejects(() => adapter.execute('SELECT 1'), /not connected|request failed/);
});

test('executes SQL with bearer authorization and no persistent credentials', async () => {
  const calls = [];
  const adapter = new MysqlSandboxAdapter({
    baseUrl: 'https://runner.example.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1
        ? response({ id: 'sandbox-id', token: 'secret-token-which-is-long-enough-1234567890' })
        : response({ results: [{ columns: ['answer'], values: [['42']], rowCount: 1 }] });
    }
  });
  await adapter.connect();
  const result = await adapter.execute('SELECT 42');
  assert.equal(result.results[0].values[0][0], '42');
  assert.equal(calls[1].options.headers.authorization, 'Bearer secret-token-which-is-long-enough-1234567890');
  assert.equal(calls[1].options.credentials, 'omit');
});

test('maps table metadata and MySQL column descriptions', async () => {
  let index = 0;
  const adapter = new MysqlSandboxAdapter({
    baseUrl: 'https://runner.example.test',
    fetchImpl: async () => {
      index++;
      if (index === 1) return response({ id: 'sandbox-id', token: 'secret-token-which-is-long-enough-1234567890' });
      if (index === 2) return response({ objects: [['students', 'BASE TABLE'], ['student_view', 'VIEW']] });
      return response({ results: [{ columns: ['Field'], values: [['id', 'int', 'NO', 'PRI', null, 'auto_increment']], rowCount: 1 }] });
    }
  });
  await adapter.connect();
  assert.deepEqual(await adapter.listObjects(), [
    { name: 'students', type: 'table' }, { name: 'student_view', type: 'view' }
  ]);
  const schema = await adapter.describeObject('students');
  assert.deepEqual(schema.columns[0], {
    name: 'id', type: 'int', notnull: true, pk: true, defaultValue: null, extra: 'auto_increment'
  });
});

test('rejects expired session capabilities and clears local session state', async () => {
  let index = 0;
  const adapter = new MysqlSandboxAdapter({
    baseUrl: 'https://runner.example.test',
    fetchImpl: async () => ++index === 1
      ? response({ id: 'sandbox-id', token: 'secret-token-which-is-long-enough-1234567890' })
      : response({ error: 'Sandbox session is invalid or expired.' }, 401)
  });
  await adapter.connect();
  await assert.rejects(() => adapter.execute('SELECT 1'), /expired/);
  assert.equal((await adapter.getConnectionInfo()).connected, false);
});

test('disconnect destroys the remote sandbox', async () => {
  const calls = [];
  const adapter = new MysqlSandboxAdapter({
    baseUrl: 'https://runner.example.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(calls.length === 1
        ? { id: 'sandbox-id', token: 'secret-token-which-is-long-enough-1234567890' }
        : { ok: true });
    }
  });
  await adapter.connect();
  await adapter.disconnect();
  assert.equal(calls[1].options.method, 'DELETE');
  assert.equal((await adapter.getConnectionInfo()).connected, false);
});
