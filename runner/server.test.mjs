import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMysqlOutput, rateLimit } from './server.mjs';

test('parses a tabular MySQL result set', () => {
  const result = parseMysqlOutput('id\tname\n1\tAda\n2\tGrace');
  assert.deepEqual(result, [{ columns: ['id', 'name'], values: [['1', 'Ada'], ['2', 'Grace']], rowCount: 2, truncated: false }]);
});

test('decodes MySQL batch escaped values', () => {
  const result = parseMysqlOutput('value\nline\\nnext\\tcolumn');
  assert.equal(result[0].values[0][0], 'line\nnext\tcolumn');
});

test('preserves literal backslash sequences while decoding MySQL output', () => {
  const result = parseMysqlOutput('value\\nliteral\\\\tsequence');
  assert.equal(result[0].values[0][0], 'literal\\tsequence');
});

test('decodes SQL NULL values', () => {
  const result = parseMysqlOutput('value\n\\N');
  assert.equal(result[0].values[0][0], null);
});

test('returns no result sets for statements without rows', () => {
  assert.deepEqual(parseMysqlOutput(''), []);
  assert.deepEqual(parseMysqlOutput('  \n'), []);
});

test('parses multiple result sets', () => {
  const result = parseMysqlOutput('first\na\n\nsecond\nb');
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].columns, ['first']);
  assert.deepEqual(result[1].values, [['b']]);
});

test('enforces a fixed-window rate limit', () => {
  const key = 'test-' + Math.random();
  assert.equal(rateLimit(key, 2, 60_000), true);
  assert.equal(rateLimit(key, 2, 60_000), true);
  assert.equal(rateLimit(key, 2, 60_000), false);
});
