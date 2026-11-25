import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMysqlXml } from '../database/mysql-output.mjs';
import { rateLimit } from './server.mjs';

test('parses MySQL XML rows and column names', () => {
  const xml = '<resultset><row><field name="id">1</field><field name="name">Ada</field></row><row><field name="id">2</field><field name="name">Grace</field></row></resultset>';
  assert.deepEqual(parseMysqlXml(xml), [{
    columns: ['id', 'name'],
    values: [['1', 'Ada'], ['2', 'Grace']],
    rowCount: 2,
    truncated: false
  }]);
});

test('decodes XML entities and preserves empty strings', () => {
  const xml = '<resultset><row><field name="value">A &amp; B &lt; C</field><field name="empty"></field></row></resultset>';
  assert.deepEqual(parseMysqlXml(xml)[0].values, [['A & B < C', '']]);
});

test('preserves SQL NULL values', () => {
  const xml = '<resultset><row><field name="value" xsi:nil="true" /></row></resultset>';
  assert.deepEqual(parseMysqlXml(xml)[0].values, [[null]]);
});

test('returns no result sets for empty MySQL output', () => {
  assert.deepEqual(parseMysqlXml(''), []);
  assert.deepEqual(parseMysqlXml('  \n'), []);
});

test('enforces a global row limit across result sets', () => {
  const xml = '<resultset><row><field name="v">1</field></row><row><field name="v">2</field></row></resultset><resultset><row><field name="v">3</field></row></resultset>';
  const result = parseMysqlXml(xml, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].rowCount, 2);
  assert.equal(result[0].truncated, true);
});

test('enforces a fixed-window rate limit', () => {
  const key = 'test-' + Math.random();
  assert.equal(rateLimit(key, 2, 60_000), true);
  assert.equal(rateLimit(key, 2, 60_000), true);
  assert.equal(rateLimit(key, 2, 60_000), false);
});
