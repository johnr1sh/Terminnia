import assert from 'node:assert/strict';

const base = process.env.RUNNER_URL || 'http://127.0.0.1:8787';
async function request(path, options = {}) {
  const res = await fetch(base + path, options);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const created = await request('/api/sandboxes', { method: 'POST' });
assert.equal(created.status, 201, JSON.stringify(created.body));
const session = created.body;
const run = (sql, credentials) => request('/api/sandboxes/' + session.id + '/execute', {
  method: 'POST',
  headers: { authorization: 'Bearer ' + session.token, 'content-type': 'application/json' },
  body: JSON.stringify({ sql, ...(credentials || {}) })
});
const rows = result => (result.body.results || []).flatMap(set => set.values || []);
const has = (result, predicate) => rows(result).some(predicate);
const joinScript = [
  'CREATE DATABASE quijano_db;', 'USE quijano_db;',
  'CREATE TABLE students (student_id INT PRIMARY KEY, student_name VARCHAR(100), address VARCHAR(100), age INT);',
  'CREATE TABLE courses (course_id INT PRIMARY KEY, course_name VARCHAR(100), instructor VARCHAR(100));',
  'CREATE TABLE enrollments (enrollment_id INT PRIMARY KEY, student_id INT, course_id INT, enrollment_date DATE, FOREIGN KEY(student_id) REFERENCES students(student_id), FOREIGN KEY(course_id) REFERENCES courses(course_id));',
  "INSERT INTO students VALUES (101,'John','Hinunangan',20),(102,'Mark','Sogod',21),(103,'Anna','Maasin',19),(104,'Peter','Hinunangan',22),(105,'Sarah','Silago',20),(106,'James','Bontoc',23);",
  "INSERT INTO courses VALUES (201,'Database Management','Mr. Santos'),(202,'Networking','Mr. Cruz'),(203,'Web Development','Ms. Reyes'),(204,'Programming','Mr. Garcia'),(205,'Cybersecurity','Ms. Lopez');",
  "INSERT INTO enrollments VALUES (1,101,201,'2026-01-10'),(2,102,202,'2026-01-11'),(3,103,201,'2026-01-12'),(4,104,203,'2026-01-13'),(5,101,204,'2026-01-14'),(6,105,202,'2026-01-15'),(7,103,203,'2026-01-16');",
  'SELECT s.student_name,c.course_name FROM students s JOIN enrollments e ON s.student_id=e.student_id JOIN courses c ON e.course_id=c.course_id;',
  'SELECT s.student_name,e.enrollment_id FROM students s LEFT JOIN enrollments e ON s.student_id=e.student_id;',
  'SELECT c.course_name,e.student_id FROM enrollments e RIGHT JOIN courses c ON e.course_id=c.course_id;',
  'SELECT c.course_name,COUNT(e.student_id) FROM courses c LEFT JOIN enrollments e ON c.course_id=e.course_id GROUP BY c.course_id,c.course_name;',
  'SELECT c.course_name,COUNT(e.student_id) FROM courses c LEFT JOIN enrollments e ON c.course_id=e.course_id GROUP BY c.course_id,c.course_name HAVING COUNT(e.student_id)>=2;',
  'SELECT s.student_name,c.course_name FROM students s CROSS JOIN courses c;',
  'SELECT s.student_name,s.address,c.course_name,c.instructor,e.enrollment_date FROM students s JOIN enrollments e ON s.student_id=e.student_id JOIN courses c ON e.course_id=c.course_id;',
  'SELECT s.student_name FROM students s LEFT JOIN enrollments e ON s.student_id=e.student_id WHERE e.enrollment_id IS NULL;',
  'SELECT c.course_name FROM courses c LEFT JOIN enrollments e ON c.course_id=e.course_id WHERE e.enrollment_id IS NULL;',
  'SELECT s.student_name,COUNT(e.enrollment_id) AS total FROM students s JOIN enrollments e ON s.student_id=e.student_id GROUP BY s.student_id,s.student_name HAVING COUNT(e.enrollment_id)=(SELECT MAX(course_count) FROM (SELECT COUNT(*) AS course_count FROM enrollments GROUP BY student_id) AS counts);',
  "SELECT s.student_name,c.course_name FROM students s JOIN enrollments e ON s.student_id=e.student_id JOIN courses c ON e.course_id=c.course_id WHERE s.address='Hinunangan';",
  'SELECT c.instructor,COUNT(e.enrollment_id) AS total FROM courses c LEFT JOIN enrollments e ON c.course_id=e.course_id GROUP BY c.instructor;',
  'SELECT s.student_name FROM students s JOIN enrollments e ON s.student_id=e.student_id GROUP BY s.student_id,s.student_name HAVING COUNT(e.enrollment_id)>1;',
  'SELECT s.student_name,e.enrollment_date FROM students s LEFT JOIN enrollments e ON s.student_id=e.student_id;'

].join('\n');
try {
  const joins = await run(joinScript);
  assert.equal(joins.status, 200, JSON.stringify(joins.body));
  const joinSets = joins.body.results || [];
  assert.ok(joinSets.some(set => set.rowCount === 7), 'INNER JOIN/registrar report must return seven rows; received result sets: ' + JSON.stringify(joinSets.map(set => ({ columns: set.columns, rowCount: set.rowCount, sample: set.values?.slice(0, 2) }))));
  assert.ok(joinSets.some(set => set.rowCount === 8), 'LEFT/RIGHT JOIN must return eight rows; received: ' + JSON.stringify(joinSets.map(set => ({ columns: set.columns, rowCount: set.rowCount }))));
  assert.ok(joinSets.some(set => set.rowCount === 30), 'CROSS JOIN must return thirty rows');
  assert.ok(joinSets.some(set => set.rowCount === 3), 'HAVING >= 2 must return three courses');
  assert.ok(has(joins, row => row.includes('James')), 'anti-join challenge must find James');
  assert.ok(has(joins, row => row.includes('Cybersecurity')), 'unmatched-course challenge must find Cybersecurity');
  assert.ok(has(joins, row => row.includes('James')), 'LEFT JOIN must retain a student without enrollment');
  assert.ok(has(joins, row => row.includes('Cybersecurity')), 'RIGHT JOIN must retain a course without enrollment');

  const advancedSetup = [
    'CREATE DATABASE lastname_mysql_advanced_lab;', 'USE lastname_mysql_advanced_lab;',
    'CREATE TABLE students (student_id INT PRIMARY KEY AUTO_INCREMENT,student_name VARCHAR(100) NOT NULL,program VARCHAR(50),year_level INT,tuition_fee DECIMAL(10,2),amount_paid DECIMAL(10,2));',
    "INSERT INTO students (student_name,program,year_level,tuition_fee,amount_paid) VALUES ('Juan Dela Cruz','BSIT',1,25000,20000),('Maria Santos','BSIT',2,25000,25000),('Pedro Reyes','BSCS',1,28000,15000),('Ana Garcia','BSIT',3,25000,18000),('Mark Lopez','BSCS',2,28000,28000),('Ella Mendoza','BSHM',1,22000,12000),('Carlo Ramos','BSHM',2,22000,22000),('Sofia Torres','BSCS',3,28000,20000),('Daniel Flores','BSIT',4,25000,25000),('Grace Aquino','BSHM',3,22000,10000);",
    'SELECT program,COUNT(*) FROM students GROUP BY program;',
    'SELECT program,AVG(tuition_fee),MAX(tuition_fee),SUM(amount_paid) FROM students GROUP BY program;',
    'SELECT program,COUNT(*) FROM students GROUP BY program HAVING COUNT(*)>3;',
    'SELECT program,AVG(tuition_fee) FROM students GROUP BY program HAVING AVG(tuition_fee)>23000;',
    'SELECT program,SUM(amount_paid) FROM students GROUP BY program HAVING SUM(amount_paid)>50000;',
    'SELECT year_level,COUNT(*) FROM students GROUP BY year_level HAVING COUNT(*)>=2;',
    'SELECT program,AVG(amount_paid) FROM students GROUP BY program HAVING AVG(amount_paid)>=18000;',
    'SELECT program,COUNT(*) AS total_students,SUM(tuition_fee) AS total_tuition,SUM(amount_paid) AS total_paid,AVG(amount_paid) AS average_paid FROM students GROUP BY program HAVING COUNT(*)>=3 AND SUM(amount_paid)>50000;'
  ].join('\n');
  const setup = await run(advancedSetup);
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  assert.ok((setup.body.results || []).some(set => set.rowCount === 3), 'GROUP BY must produce three program groups');

  const routines = [
    'DELIMITER $$',
    'CREATE PROCEDURE GetAllStudents() BEGIN SELECT * FROM students; END$$',
    'CREATE PROCEDURE GetStudentsByProgram(IN p_program VARCHAR(50)) BEGIN SELECT * FROM students WHERE program=p_program; END$$',
    'CREATE PROCEDURE GetStudentsByYear(IN p_year_level INT) BEGIN SELECT * FROM students WHERE year_level=p_year_level; END$$',
    'CREATE PROCEDURE GetStudentsWithBalance(IN p_minimum_balance DECIMAL(10,2)) BEGIN SELECT * FROM students WHERE tuition_fee-amount_paid>=p_minimum_balance; END$$',
    'CREATE PROCEDURE SearchStudents(IN p_program VARCHAR(50),IN p_year_level INT) BEGIN SELECT * FROM students WHERE program=p_program AND year_level=p_year_level; END$$',
    "CREATE PROCEDURE UpdateStudentPayment(IN p_student_id INT,IN p_payment DECIMAL(10,2)) BEGIN DECLARE v_fee DECIMAL(10,2); DECLARE v_paid DECIMAL(10,2); DECLARE v_found INT DEFAULT 1; DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found=0; IF p_payment IS NULL OR p_payment<=0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Payment must be greater than zero'; END IF; SELECT tuition_fee,amount_paid INTO v_fee,v_paid FROM students WHERE student_id=p_student_id; IF v_found=0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Student not found'; END IF; IF v_paid+p_payment>v_fee THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Payment exceeds tuition balance'; END IF; UPDATE students SET amount_paid=amount_paid+p_payment WHERE student_id=p_student_id; SELECT 'PAYMENT UPDATED' AS message; END$$",
    'CREATE FUNCTION CalculateBalance(p_student_id INT) RETURNS DECIMAL(10,2) DETERMINISTIC READS SQL DATA BEGIN DECLARE v_balance DECIMAL(10,2) DEFAULT 0; SELECT tuition_fee-amount_paid INTO v_balance FROM students WHERE student_id=p_student_id; RETURN IFNULL(v_balance,0); END$$',
    "CREATE FUNCTION GetPaymentStatus(p_student_id INT) RETURNS VARCHAR(30) DETERMINISTIC READS SQL DATA BEGIN DECLARE v_balance DECIMAL(10,2) DEFAULT NULL; DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_balance=NULL; SELECT tuition_fee-amount_paid INTO v_balance FROM students WHERE student_id=p_student_id; IF v_balance IS NULL THEN RETURN 'INVALID STUDENT'; END IF; IF v_balance=0 THEN RETURN 'FULLY PAID'; END IF; RETURN 'WITH BALANCE'; END$$",
    'CREATE FUNCTION GetTuitionDiscount(p_student_id INT) RETURNS DECIMAL(10,2) DETERMINISTIC READS SQL DATA BEGIN DECLARE v_fee DECIMAL(10,2) DEFAULT NULL; DECLARE v_paid DECIMAL(10,2) DEFAULT 0; DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_fee=NULL; SELECT tuition_fee,amount_paid INTO v_fee,v_paid FROM students WHERE student_id=p_student_id; IF v_fee IS NULL THEN RETURN 0; END IF; IF v_paid>=v_fee*0.5 THEN RETURN v_fee*0.10; END IF; IF v_paid>0 THEN RETURN v_fee*0.05; END IF; RETURN 0; END$$',
    'DELIMITER ;',
    'CALL GetAllStudents();',
    "CALL GetStudentsByProgram('BSCS');",
    'CALL GetStudentsByYear(2);',
    'CALL GetStudentsWithBalance(5000);',
    "CALL SearchStudents('BSIT',1);",
    'SELECT student_name,CalculateBalance(student_id) FROM students;',
    'SELECT student_name,CalculateBalance(student_id) FROM students WHERE CalculateBalance(student_id)>5000;',
    'SELECT student_name,CalculateBalance(student_id) FROM students WHERE student_id=3;',
    "SELECT GetPaymentStatus(2),GetPaymentStatus(3),GetPaymentStatus(999);",
    'SELECT student_name,GetTuitionDiscount(student_id) FROM students;',
    "INSERT INTO students(student_name,program,year_level,tuition_fee,amount_paid) VALUES('No Payment','BSIT',1,25000,0);",
    'SELECT GetTuitionDiscount(LAST_INSERT_ID());'
  ].join('\n');
  const routineRun = await run(routines);
  assert.equal(routineRun.status, 200, JSON.stringify(routineRun.body));
  assert.ok(has(routineRun, row => row.includes('FULLY PAID') && row.includes('WITH BALANCE') && row.includes('INVALID STUDENT')), 'stored function status values must work');
  assert.ok(has(routineRun, row => row.includes('0.00')), 'zero-payment student must receive zero discount');
  assert.ok((routineRun.body.results || []).some(set => set.rowCount === 10), 'GetAllStudents must return ten rows');
  assert.ok((routineRun.body.results || []).some(set => set.rowCount === 6), 'GetStudentsWithBalance(5000) must return six rows');

  const validPayment = await run('CALL UpdateStudentPayment(1,1000); SELECT amount_paid FROM students WHERE student_id=1;');
  assert.equal(validPayment.status, 200, JSON.stringify(validPayment.body));
  assert.ok(has(validPayment, row => row.includes('21000.00')), 'valid payment should update amount_paid');
  const negativePayment = await run('CALL UpdateStudentPayment(1,-10);');
  assert.equal(negativePayment.status, 422, 'negative payment must be rejected');
  assert.match(negativePayment.body.detail || '', /greater than zero/i);
  const zeroPayment = await run('CALL UpdateStudentPayment(1,0);');
  assert.equal(zeroPayment.status, 422, 'zero payment must be rejected');
  const nullPayment = await run('CALL UpdateStudentPayment(1,NULL);');
  assert.equal(nullPayment.status, 422, 'NULL payment must be rejected');
  const excessPayment = await run('CALL UpdateStudentPayment(1,999999);');
  assert.equal(excessPayment.status, 422, 'payment exceeding tuition must be rejected');

  const accounts = [
    "CREATE USER 'student_user'@'localhost' IDENTIFIED BY 'StudentPass_2026!';",
    "CREATE USER 'teacher_user'@'localhost' IDENTIFIED BY 'TeacherPass_2026!';",
    "CREATE USER 'report_user'@'localhost' IDENTIFIED BY 'ReportPass_2026!';",
    "CREATE USER 'admin_assistant'@'localhost' IDENTIFIED BY 'AssistantPass_2026!';",
    "GRANT SELECT ON lastname_mysql_advanced_lab.students TO 'student_user'@'localhost';",
    "GRANT SELECT,INSERT,UPDATE,DELETE ON lastname_mysql_advanced_lab.students TO 'teacher_user'@'localhost';",
    "GRANT SELECT ON lastname_mysql_advanced_lab.students TO 'report_user'@'localhost';",
    "GRANT SELECT,INSERT,UPDATE ON lastname_mysql_advanced_lab.students TO 'admin_assistant'@'localhost';",
    "SHOW GRANTS FOR 'student_user'@'localhost';",
    "SHOW GRANTS FOR 'teacher_user'@'localhost';",
    "SHOW GRANTS FOR 'report_user'@'localhost';",
    "SHOW GRANTS FOR 'admin_assistant'@'localhost';"
  ].join('\n');
  const grants = await run(accounts);
  assert.equal(grants.status, 200, JSON.stringify(grants.body));
  const studentCreds = { username: 'student_user', password: 'StudentPass_2026!' };
  assert.equal((await run('SELECT * FROM students LIMIT 1', studentCreds)).status, 200, 'student SELECT should succeed');
  assert.equal((await run("INSERT INTO students(student_name) VALUES('Denied')", studentCreds)).status, 422, 'student INSERT must be denied');
  assert.equal((await run('DELETE FROM students WHERE student_id=1', studentCreds)).status, 422, 'student DELETE must be denied');
  const report = { username: 'report_user', password: 'ReportPass_2026!' };
  assert.equal((await run('SELECT * FROM students LIMIT 1', report)).status, 200, 'report_user SELECT should succeed');
  assert.equal((await run("INSERT INTO students(student_name) VALUES('Report Denied')", report)).status, 422, 'report_user INSERT must be denied');
  assert.equal((await run('UPDATE students SET amount_paid=0 WHERE student_id=1', report)).status, 422, 'report_user UPDATE must be denied');
  assert.equal((await run('DELETE FROM students WHERE student_id=1', report)).status, 422, 'report_user DELETE must be denied');
  const teacher = { username: 'teacher_user', password: 'TeacherPass_2026!' };
  assert.equal((await run("INSERT INTO students(student_name) VALUES('Teacher Test')", teacher)).status, 200);
  assert.equal((await run("UPDATE students SET amount_paid=1000 WHERE student_name='Teacher Test'", teacher)).status, 200);
  assert.equal((await run("DELETE FROM students WHERE student_name='Teacher Test'", teacher)).status, 200);
  const assistant = { username: 'admin_assistant', password: 'AssistantPass_2026!' };
  assert.equal((await run('SELECT * FROM students LIMIT 1', assistant)).status, 200);
  assert.equal((await run("INSERT INTO students(student_name) VALUES('Assistant Test')", assistant)).status, 200);
  assert.equal((await run("UPDATE students SET amount_paid=500 WHERE student_name='Assistant Test'", assistant)).status, 200);
  assert.equal((await run("DELETE FROM students WHERE student_name='Assistant Test'", assistant)).status, 422, 'assistant DELETE must be denied');

  assert.equal((await run("REVOKE SELECT ON lastname_mysql_advanced_lab.students FROM 'student_user'@'localhost'; SHOW GRANTS FOR 'student_user'@'localhost';")).status, 200);
  assert.equal((await run('SELECT * FROM students', studentCreds)).status, 422, 'REVOKE should remove SELECT');
  assert.equal((await run("GRANT SELECT ON lastname_mysql_advanced_lab.students TO 'student_user'@'localhost';")).status, 200);
  assert.equal((await run('SELECT * FROM students LIMIT 1', studentCreds)).status, 200, 'GRANT should restore SELECT');
  assert.equal((await run("DROP USER 'student_user'@'localhost','teacher_user'@'localhost','report_user'@'localhost','admin_assistant'@'localhost';")).status, 200);
  console.log('Full coursework acceptance passed: JOINs, GROUP BY/HAVING, procedures, functions, payment validation, and account privilege tests.');
} finally {
  await request('/api/sandboxes/' + session.id, {
    method: 'DELETE', headers: { authorization: 'Bearer ' + session.token }
  }).catch(() => {});
}
