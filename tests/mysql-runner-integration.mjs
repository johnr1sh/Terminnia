import assert from 'node:assert/strict';

const base = process.env.RUNNER_URL || 'http://127.0.0.1:8787';
async function request(path, options = {}) {
  const response = await fetch(base + path, options);
  const body = await response.json();
  return { response, body };
}
async function createSandbox() {
  const { response, body } = await request('/api/sandboxes', { method: 'POST' });
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.ok(body.id && body.token, 'runner must return a sandbox id and one-time capability');
  return body;
}
async function execute(session, sql) {
  return request('/api/sandboxes/' + session.id + '/execute', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + session.token, 'content-type': 'application/json' },
    body: JSON.stringify({ sql })
  });
}

const first = await createSandbox();
let second;
try {
  const script = `
CREATE DATABASE terminnia_runner_test;
USE terminnia_runner_test;
CREATE TABLE students (id INT PRIMARY KEY, name VARCHAR(80) NOT NULL);
INSERT INTO students VALUES (1, 'Ada'), (2, 'Grace');
SELECT id, name FROM students ORDER BY id;
DELIMITER $$
CREATE PROCEDURE GetStudent(IN requested_id INT)
BEGIN
  SELECT id, name FROM students WHERE id = requested_id;
END$$
DELIMITER ;
CALL GetStudent(1);
CREATE USER 'lab_reader'@'localhost' IDENTIFIED BY 'ReaderPass_2026!';
GRANT SELECT ON terminnia_runner_test.students TO 'lab_reader'@'localhost';
SHOW GRANTS FOR 'lab_reader'@'localhost';
REVOKE SELECT ON terminnia_runner_test.students FROM 'lab_reader'@'localhost';
DROP USER 'lab_reader'@'localhost';
`;
  const executed = await execute(first, script);
  assert.equal(executed.response.status, 200, JSON.stringify(executed.body));
  assert.equal(executed.body.statementCount, 12);
  const allRows = executed.body.results.flatMap(result => result.values);
  assert.ok(allRows.some(row => row.includes('Ada')), 'SELECT/CALL must return real MySQL rows');
  assert.ok(allRows.some(row => row.some(value => String(value).includes('GRANT SELECT'))), 'SHOW GRANTS must return privilege information');
  const persistedContext = await execute(first, 'SELECT COUNT(*) AS total FROM students');
  assert.equal(persistedContext.response.status, 200, JSON.stringify(persistedContext.body));
  assert.ok(persistedContext.body.results.flatMap(result => result.values).some(row => row.includes('2')), 'USE database context must persist across requests');

  second = await createSandbox();
  const isolated = await execute(second, 'SHOW DATABASES');
  assert.equal(isolated.response.status, 200, JSON.stringify(isolated.body));
  const otherRows = isolated.body.results.flatMap(result => result.values);
  assert.ok(!otherRows.some(row => row.includes('terminnia_runner_test')), 'sessions must not share database state');

  const reset = await request('/api/sandboxes/' + first.id + '/reset', {
    method: 'POST', headers: { authorization: 'Bearer ' + first.token }
  });
  assert.equal(reset.response.status, 200, JSON.stringify(reset.body));
  const afterReset = await execute(first, 'SHOW DATABASES');
  assert.equal(afterReset.response.status, 200, JSON.stringify(afterReset.body));
  assert.ok(!afterReset.body.results.flatMap(result => result.values).some(row => row.includes('terminnia_runner_test')));

  const deleted = await request('/api/sandboxes/' + first.id, {
    method: 'DELETE', headers: { authorization: 'Bearer ' + first.token }
  });
  assert.equal(deleted.response.status, 200);
  const denied = await request('/api/sandboxes/' + first.id + '/schema', {
    headers: { authorization: 'Bearer ' + first.token }
  });
  assert.equal(denied.response.status, 401, 'deleted capability must no longer authorize requests');
  console.log('MySQL runner integration passed: real execution, stored procedure, account privileges, isolation, reset, and deletion.');
} finally {
  for (const session of [first, second]) {
    if (!session) continue;
    await request('/api/sandboxes/' + session.id, {
      method: 'DELETE', headers: { authorization: 'Bearer ' + session.token }
    }).catch(() => {});
  }
}
