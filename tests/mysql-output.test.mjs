import test from "node:test";
import assert from "node:assert/strict";
import { decodeXml, parseMysqlXml } from "../database/mysql-output.mjs";

test("parses multiple MySQL XML result sets independently", () => {
  const xml = `<?xml version="1.0"?>
<resultset statement="SELECT 1"><row><field name="id">1</field><field name="name">Ada</field></row></resultset>
<resultset statement="SELECT 2"><row><field name="total">7</field></row><row><field name="total">8</field></row></resultset>`;
  assert.deepEqual(parseMysqlXml(xml), [
    { columns: ["id", "name"], values: [["1", "Ada"]], rowCount: 1, truncated: false },
    { columns: ["total"], values: [["7"], ["8"]], rowCount: 2, truncated: false }
  ]);
});

test("decodes XML entities without corrupting literal text", () => {
  const xml = `<resultset><row><field name="message">A &amp; B &lt; C &quot;quoted&quot; &#39; &#x1F642;</field></row></resultset>`;
  assert.deepEqual(parseMysqlXml(xml)[0].values, [["A & B < C \"quoted\" ' 🙂"]]);
  assert.equal(decodeXml("&amp;lt;"), "&lt;");
});

test("preserves NULL markers and empty result sets", () => {
  const xml = `<resultset><row><field name="value" xsi:nil="true" /></row></resultset>
<resultset statement="empty query"></resultset>`;
  const parsed = parseMysqlXml(xml);
  assert.deepEqual(parsed[0].values, [[null]]);
  assert.equal(parsed[1].rowCount, 0);
});

test("enforces one global row limit across result sets", () => {
  const xml = `<resultset><row><field name="v">1</field></row><row><field name="v">2</field></row></resultset>
<resultset><row><field name="v">3</field></row></resultset>`;
  const parsed = parseMysqlXml(xml, 2);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].rowCount, 2);
  assert.equal(parsed[0].truncated, true);
});
