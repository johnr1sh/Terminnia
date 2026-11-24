import test from 'node:test';
import assert from 'node:assert/strict';
import { splitMysqlScript } from '../database/mysql-script.mjs';

test('splits ordinary statements and ignores semicolons in strings', () => {
  const statements = splitMysqlScript("CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('one;two'); SELECT * FROM notes;");
  assert.equal(statements.length, 3);
  assert.match(statements[1], /one;two/);
});

test('honors DELIMITER around stored procedures and functions', () => {
  const source = `
    CREATE TABLE t (id INT);
    DELIMITER //
    CREATE PROCEDURE p()
    BEGIN
      INSERT INTO t VALUES (1);
      INSERT INTO t VALUES (2);
    END//
    CREATE FUNCTION f() RETURNS INT
    DETERMINISTIC
    BEGIN
      RETURN 1;
    END//
    DELIMITER ;
    CALL p();
    SELECT f();
  `;
  const statements = splitMysqlScript(source);
  assert.equal(statements.length, 5);
  assert.match(statements[1], /INSERT INTO t VALUES \(1\);\s*INSERT INTO t VALUES \(2\);/);
  assert.match(statements[2], /RETURN 1;/);
  assert.equal(statements[3], 'CALL p()');
  assert.equal(statements[4], 'SELECT f()');
});

test('does not split delimiters inside quoted values, identifiers, or comments', () => {
  const source = `
    -- first; comment
    SELECT 'a;b', "c;d", \`e;f\`; # trailing; comment
    /* ignored; block */ SELECT 2;
  `;
  const statements = splitMysqlScript(source);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /'a;b'/);
  assert.match(statements[0], /"c;d"/);
  assert.match(statements[0], /\`e;f\`/);
});

test('supports custom delimiters and delimiter text inside strings', () => {
  const statements = splitMysqlScript(`
    DELIMITER $$
    CREATE PROCEDURE p2()
    BEGIN
      SELECT '$$' AS marker;
    END$$
    DELIMITER ;
    SELECT 7;
  `);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /SELECT '\$\$'/);
});

test('rejects unterminated quoted values and block comments', () => {
  assert.throws(() => splitMysqlScript("SELECT 'unfinished"), /Unterminated quoted value/);
  assert.throws(() => splitMysqlScript('SELECT 1 /* unfinished'), /Unterminated block comment/);
});

test('preserves token boundaries around ordinary block comments', () => {
  const statements = splitMysqlScript('SELECT/* comment */1; SELECT 2/* comment */+3;');
  assert.equal(statements.length, 2);
  assert.equal(statements[0], 'SELECT 1');
  assert.match(statements[1], /^SELECT\\s+2\\s+\\+3$/);
});

test('preserves MySQL executable version comments for the server', () => {
  const statements = splitMysqlScript('/*!40101 SET @saved_cs_client = @@character_set_client */; SELECT 1;');
  assert.equal(statements.length, 2);
  assert.equal(statements[0], '/*!40101 SET @saved_cs_client = @@character_set_client */');
  assert.equal(statements[1], 'SELECT 1');
});
