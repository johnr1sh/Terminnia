-- Real MySQL 8.4 acceptance fixture derived from the supplied laboratory activities.
-- Run only inside a disposable CI/test MySQL instance.

DROP DATABASE IF EXISTS terminnia_mysql_advanced_ci;
DROP DATABASE IF EXISTS terminnia_mysql_join_ci;
CREATE DATABASE terminnia_mysql_advanced_ci;
CREATE DATABASE terminnia_mysql_join_ci;
USE terminnia_mysql_advanced_ci;

DROP USER IF EXISTS 'student_user'@'localhost';
DROP USER IF EXISTS 'teacher_user'@'localhost';
DROP USER IF EXISTS 'report_user'@'localhost';
DROP USER IF EXISTS 'admin_assistant'@'localhost';

CREATE TABLE students (
  student_id INT PRIMARY KEY AUTO_INCREMENT,
  student_name VARCHAR(100) NOT NULL,
  program VARCHAR(50),
  year_level INT,
  tuition_fee DECIMAL(10,2),
  amount_paid DECIMAL(10,2)
);

INSERT INTO students (student_name, program, year_level, tuition_fee, amount_paid) VALUES
('Juan Dela Cruz', 'BSIT', 1, 25000, 20000),
('Maria Santos', 'BSIT', 2, 25000, 25000),
('Pedro Reyes', 'BSCS', 1, 28000, 15000),
('Ana Garcia', 'BSIT', 3, 25000, 18000),
('Mark Lopez', 'BSCS', 2, 28000, 28000),
('Ella Mendoza', 'BSHM', 1, 22000, 12000),
('Carlo Ramos', 'BSHM', 2, 22000, 22000),
('Sofia Torres', 'BSCS', 3, 28000, 20000),
('Daniel Flores', 'BSIT', 4, 25000, 25000),
('Grace Aquino', 'BSHM', 3, 22000, 10000),
('Zero Payment', 'BSIT', 1, 25000, 0);

USE terminnia_mysql_join_ci;
CREATE TABLE students (
  student_id INT PRIMARY KEY,
  student_name VARCHAR(100),
  address VARCHAR(100),
  age INT
);
CREATE TABLE courses (
  course_id INT PRIMARY KEY,
  course_name VARCHAR(100),
  instructor VARCHAR(100)
);
CREATE TABLE enrollments (
  enrollment_id INT PRIMARY KEY,
  student_id INT,
  course_id INT,
  enrollment_date DATE,
  FOREIGN KEY (student_id) REFERENCES students(student_id),
  FOREIGN KEY (course_id) REFERENCES courses(course_id)
);
INSERT INTO students VALUES
(101, 'John', 'Hinunangan', 20),
(102, 'Mark', 'Sogod', 21),
(103, 'Anna', 'Maasin', 19),
(104, 'Peter', 'Hinunangan', 22),
(105, 'Sarah', 'Silago', 20),
(106, 'James', 'Bontoc', 23);
INSERT INTO courses VALUES
(201, 'Database Management', 'Mr. Santos'),
(202, 'Networking', 'Mr. Cruz'),
(203, 'Web Development', 'Ms. Reyes'),
(204, 'Programming', 'Mr. Garcia'),
(205, 'Cybersecurity', 'Ms. Lopez');
INSERT INTO enrollments VALUES
(1, 101, 201, '2026-01-10'),
(2, 102, 202, '2026-01-11'),
(3, 103, 201, '2026-01-12'),
(4, 104, 203, '2026-01-13'),
(5, 101, 204, '2026-01-14'),
(6, 105, 202, '2026-01-15'),
(7, 103, 203, '2026-01-16');

-- JOIN acceptance queries.
SELECT s.student_name, c.course_name
FROM students AS s
INNER JOIN enrollments AS e ON e.student_id = s.student_id
INNER JOIN courses AS c ON c.course_id = e.course_id;
SELECT s.student_name, c.course_name
FROM students AS s
LEFT JOIN enrollments AS e ON e.student_id = s.student_id
LEFT JOIN courses AS c ON c.course_id = e.course_id;
SELECT c.course_name, s.student_name
FROM students AS s
RIGHT JOIN enrollments AS e ON e.student_id = s.student_id
RIGHT JOIN courses AS c ON c.course_id = e.course_id;
SELECT s.student_name, c.course_name
FROM students AS s CROSS JOIN courses AS c;
SELECT c.course_name, COUNT(e.enrollment_id) AS enrollee_count
FROM courses AS c
LEFT JOIN enrollments AS e ON e.course_id = c.course_id
GROUP BY c.course_id, c.course_name
HAVING COUNT(e.enrollment_id) >= 2;
SELECT s.student_name, s.address, c.course_name, c.instructor, e.enrollment_date
FROM students AS s
LEFT JOIN enrollments AS e ON e.student_id = s.student_id
LEFT JOIN courses AS c ON c.course_id = e.course_id;
SELECT s.student_name, s.address, c.course_name, c.instructor
FROM students AS s
INNER JOIN enrollments AS e ON e.student_id = s.student_id
INNER JOIN courses AS c ON c.course_id = e.course_id
WHERE s.address = 'Hinunangan';

USE terminnia_mysql_advanced_ci;

-- GROUP BY and HAVING acceptance queries.
SELECT program, COUNT(*) AS student_count
FROM students GROUP BY program;
SELECT program, AVG(tuition_fee) AS average_tuition
FROM students GROUP BY program;
SELECT program, MAX(tuition_fee) AS highest_tuition
FROM students GROUP BY program;
SELECT program, SUM(amount_paid) AS total_paid
FROM students GROUP BY program;
SELECT year_level, COUNT(*) AS student_count
FROM students GROUP BY year_level;
SELECT program, COUNT(*) AS student_count
FROM students GROUP BY program HAVING COUNT(*) > 3;

-- Stored procedures and stored functions. DELIMITER is a mysql-client directive.
DELIMITER //
CREATE PROCEDURE GetAllStudents()
BEGIN
  SELECT * FROM students;
END//

CREATE PROCEDURE GetStudentsByProgram(IN p_program VARCHAR(50))
BEGIN
  SELECT * FROM students WHERE program = p_program;
END//

CREATE PROCEDURE GetStudentsByYear(IN p_year_level INT)
BEGIN
  SELECT * FROM students WHERE year_level = p_year_level;
END//

CREATE PROCEDURE GetStudentsWithBalance(IN p_minimum_balance DECIMAL(10,2))
BEGIN
  SELECT *, tuition_fee - amount_paid AS remaining_balance
  FROM students
  WHERE tuition_fee - amount_paid >= p_minimum_balance;
END//

CREATE PROCEDURE SearchStudents(
  IN p_program VARCHAR(50),
  IN p_year_level INT
)
BEGIN
  SELECT * FROM students
  WHERE program = p_program AND year_level = p_year_level;
END//

CREATE PROCEDURE UpdateStudentPayment(
  IN p_student_id INT,
  IN p_payment_amount DECIMAL(10,2)
)
BEGIN
  DECLARE v_tuition DECIMAL(10,2);
  DECLARE v_paid DECIMAL(10,2);
  IF p_payment_amount IS NULL OR p_payment_amount <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment must be greater than zero.';
  END IF;
  SELECT tuition_fee, amount_paid
    INTO v_tuition, v_paid
    FROM students
    WHERE student_id = p_student_id
    FOR UPDATE;
  IF v_tuition IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Student not found.';
  END IF;
  IF v_paid + p_payment_amount > v_tuition THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment exceeds tuition balance.';
  END IF;
  UPDATE students
    SET amount_paid = amount_paid + p_payment_amount
    WHERE student_id = p_student_id;
  SELECT 'Payment updated successfully.' AS message;
END//

CREATE FUNCTION CalculateBalance(p_student_id INT)
RETURNS DECIMAL(10,2)
READS SQL DATA
BEGIN
  DECLARE v_balance DECIMAL(10,2);
  SELECT tuition_fee - amount_paid
    INTO v_balance
    FROM students
    WHERE student_id = p_student_id;
  RETURN v_balance;
END//

CREATE FUNCTION GetPaymentStatus(p_student_id INT)
RETURNS VARCHAR(20)
READS SQL DATA
BEGIN
  DECLARE v_balance DECIMAL(10,2);
  DECLARE v_exists INT DEFAULT 0;
  SELECT COUNT(*) INTO v_exists FROM students WHERE student_id = p_student_id;
  IF v_exists = 0 THEN
    RETURN 'INVALID STUDENT';
  END IF;
  SET v_balance = CalculateBalance(p_student_id);
  IF v_balance = 0 THEN
    RETURN 'FULLY PAID';
  END IF;
  RETURN 'WITH BALANCE';
END//

CREATE FUNCTION GetTuitionDiscount(p_student_id INT)
RETURNS DECIMAL(10,2)
READS SQL DATA
BEGIN
  DECLARE v_tuition DECIMAL(10,2);
  DECLARE v_paid DECIMAL(10,2);
  SELECT tuition_fee, amount_paid
    INTO v_tuition, v_paid
    FROM students
    WHERE student_id = p_student_id;
  IF v_tuition IS NULL THEN
    RETURN NULL;
  ELSEIF v_paid >= v_tuition * 0.50 THEN
    RETURN v_tuition * 0.10;
  ELSEIF v_paid > 0 THEN
    RETURN v_tuition * 0.05;
  END IF;
  RETURN 0.00;
END//
DELIMITER ;

-- User and privilege exercises. Accounts exist only inside this disposable server.
CREATE USER 'student_user'@'localhost' IDENTIFIED BY 'student_ci_pw';
CREATE USER 'teacher_user'@'localhost' IDENTIFIED BY 'teacher_ci_pw';
CREATE USER 'report_user'@'localhost' IDENTIFIED BY 'report_ci_pw';
CREATE USER 'admin_assistant'@'localhost' IDENTIFIED BY 'assistant_ci_pw';

GRANT SELECT ON terminnia_mysql_advanced_ci.students TO 'student_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON terminnia_mysql_advanced_ci.students TO 'teacher_user'@'localhost';
GRANT SELECT ON terminnia_mysql_advanced_ci.students TO 'report_user'@'localhost';
GRANT SELECT, INSERT, UPDATE ON terminnia_mysql_advanced_ci.students TO 'admin_assistant'@'localhost';
