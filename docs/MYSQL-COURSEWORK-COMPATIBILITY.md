# MySQL coursework compatibility

Terminnia has two separate engines. **Local SQLite** is the offline browser database. **MySQL Lab** is the remote MySQL 8.4 sandbox mode and is required for MySQL-specific coursework. Do not run the activities below in SQLite mode.

## JOIN laboratory activity

| Activity | MySQL capability |
|---|---|
| Create own database and select it | `CREATE DATABASE`, `USE` |
| Create students, courses, enrollments | `CREATE TABLE`, primary keys, foreign keys |
| Insert sample records | Multi-row `INSERT` |
| Exercises 1–4 | `INNER JOIN`, `LEFT JOIN`, `RIGHT JOIN`, `WHERE`, `ON` |
| Exercise 5 | `LEFT JOIN`, `GROUP BY`, `COUNT` |
| Exercise 6 | `HAVING` with aggregate conditions |
| Exercise 7 | `CROSS JOIN` |
| Challenges 22–29 and registrar report | Multi-table joins, anti-joins, grouping, subqueries, dates, unmatched rows |

## Advanced MySQL activity

| Activity | MySQL capability |
|---|---|
| Tasks 1–5 | `COUNT`, `AVG`, `MAX`, `SUM`, `GROUP BY` |
| Tasks 6–10 and grouping challenge | `HAVING` with aggregate expressions |
| Tasks 11–15 | Stored procedures, `IN` parameters, `CALL`, multiple statements |
| Payment challenge | Procedure parameters, validation, conditional logic, `SIGNAL SQLSTATE`, `UPDATE` |
| Tasks 16–20 | Stored functions, `RETURNS`, `RETURN`, functions called from `SELECT` |
| Discount challenge | Conditional function return values and decimal calculations |
| Tasks 21–26 | `CREATE USER`, `GRANT`, `SHOW GRANTS` |
| Tasks 27–30 | `REVOKE`, restore grants, account-specific allow/deny tests |

The SQL script parser understands the MySQL client-side `DELIMITER` directive. It removes those directives and submits complete stored-program definitions to the MySQL server. `DELIMITER` is not itself a server SQL statement.

## Running privilege exercises in the editor

1. Connect to **MySQL Lab**.
2. Execute the database, table, and user setup statements as the sandbox administrator.
3. Use the **Run as** control in the editor toolbar to enter the created account's username and password.
4. Execute the SELECT/INSERT/UPDATE/DELETE tests as that account.
5. Switch back to **Run as: root** to inspect grants, revoke privileges, restore them, or remove test users.

The Run as password is held in browser memory and sent only with the SQL execution request. It is not written to local drafts or query history. The runner writes credentials to a short-lived mode-0600 file in the sandbox tmpfs for the duration of one execution and removes it afterward.

## Execution boundaries

- Every student receives a separate disposable MySQL 8.4 container; sessions do not share schemas or MySQL accounts.
- The selected database is remembered between Run actions.
- Each Run action opens a fresh MySQL client connection. User variables, temporary tables, prepared statements, and open transactions do not survive between separate Run actions. Put connection-scoped operations in the same submitted SQL script.
- Sandbox databases and accounts are temporary and are deleted when the sandbox is reset, disconnected, or expires.
- Local SQLite data and MySQL Lab data are separate.

## Automated acceptance coverage

- `tests/mysql-runner-integration.mjs`: real MySQL execution, stored procedure, account grants, account-denial tests, isolation, reset, deletion, and container restrictions.
- `tests/mysql-coursework-integration.mjs`: the two attached activities' sample datasets, JOIN types and challenges, grouping/HAVING, procedures, functions, payment validation, and student/teacher/report/admin-assistant permissions.
- `tests/mysql-sandbox-adapter.test.mjs`: browser adapter contract, credentials handling, HTTPS enforcement, and result normalization.

The runner still needs a dedicated Docker-capable production host and a configured HTTPS `VITE_MYSQL_RUNNER_URL` before public MySQL Lab access is available. A passing CI suite does not deploy that host.
