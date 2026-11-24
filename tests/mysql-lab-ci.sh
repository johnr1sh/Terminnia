#!/usr/bin/env bash
set -euo pipefail

MYSQL_CONTAINER_ID="${MYSQL_CONTAINER_ID:?Missing MySQL service container ID}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:?Missing root password}"

mysql_root() {
  docker exec "$MYSQL_CONTAINER_ID" mysql --protocol=socket -uroot "-p$MYSQL_ROOT_PASSWORD" "$@"
}
mysql_user() {
  local user="$1" password="$2"
  shift 2
  docker exec "$MYSQL_CONTAINER_ID" mysql --protocol=socket "-u$user" "-p$password" terminnia_mysql_ci "$@"
}
expect_denied() {
  local description="$1"
  shift
  if "$@" >/tmp/terminnia-mysql-denied.log 2>&1; then
    echo "Expected access denial: $description"
    cat /tmp/terminnia-mysql-denied.log
    exit 1
  fi
  echo "Verified access denied: $description"
}

echo "1. Provisioning disposable MySQL laboratory database"
mysql_root < tests/fixtures/mysql-labs.sql

echo "2. Verifying stored routines and functions"
mysql_root terminnia_mysql_ci -Nse "CALL GetStudentsByProgram('BSCS')" >/dev/null
balance="$(mysql_root terminnia_mysql_ci -Nse "SELECT CalculateBalance(3)")"
[ "$balance" = "13000.00" ] || { echo "Unexpected balance: $balance"; exit 1; }
status="$(mysql_root terminnia_mysql_ci -Nse "SELECT GetPaymentStatus(2), GetPaymentStatus(99999)")"
[ "$status" = $'FULLY PAID\tINVALID STUDENT' ] || { echo "Unexpected payment status: $status"; exit 1; }
discount="$(mysql_root terminnia_mysql_ci -Nse "SELECT GetTuitionDiscount(1), GetTuitionDiscount(11)")"
[ "$discount" = $'2500.00\t0.00' ] || { echo "Unexpected discount: $discount"; exit 1; }
mysql_root terminnia_mysql_ci -e "CALL UpdateStudentPayment(1, 1000.00)" >/dev/null
expect_denied "reject a negative payment" mysql_root terminnia_mysql_ci -e "CALL UpdateStudentPayment(1, -1.00)"
expect_denied "reject payment above tuition" mysql_root terminnia_mysql_ci -e "CALL UpdateStudentPayment(1, 999999.00)"

echo "3. Verifying separate-account privileges"
student_rows="$(mysql_user student_user student_ci_pw -Nse "SELECT COUNT(*) FROM students")"
[ "$student_rows" = "11" ] || { echo "Unexpected student row count: $student_rows"; exit 1; }
expect_denied "student_user cannot INSERT" mysql_user student_user student_ci_pw -e "INSERT INTO students(student_name) VALUES('blocked')"
expect_denied "student_user cannot DELETE" mysql_user student_user student_ci_pw -e "DELETE FROM students WHERE student_id=1"
mysql_user teacher_user teacher_ci_pw -e "INSERT INTO students(student_name,program,year_level,tuition_fee,amount_paid) VALUES('Teacher Test','BSIT',1,1000,0)"
mysql_user teacher_user teacher_ci_pw -e "UPDATE students SET amount_paid=100 WHERE student_name='Teacher Test'"
mysql_user teacher_user teacher_ci_pw -e "DELETE FROM students WHERE student_name='Teacher Test'"
mysql_user report_user report_ci_pw -e "SELECT student_id FROM students LIMIT 1" >/dev/null
expect_denied "report_user cannot INSERT" mysql_user report_user report_ci_pw -e "INSERT INTO students(student_name) VALUES('blocked')"
mysql_user admin_assistant assistant_ci_pw -e "INSERT INTO students(student_name,program,year_level,tuition_fee,amount_paid) VALUES('Assistant Test','BSIT',1,1000,0)"
mysql_user admin_assistant assistant_ci_pw -e "UPDATE students SET amount_paid=100 WHERE student_name='Assistant Test'"
expect_denied "admin_assistant cannot DELETE" mysql_user admin_assistant assistant_ci_pw -e "DELETE FROM students WHERE student_name='Assistant Test'"

echo "4. Verifying REVOKE and restored SELECT access"
mysql_root -e "REVOKE SELECT ON terminnia_mysql_ci.students FROM 'student_user'@'localhost'"
expect_denied "student_user after REVOKE" mysql_user student_user student_ci_pw -e "SELECT * FROM students"
mysql_root -e "GRANT SELECT ON terminnia_mysql_ci.students TO 'student_user'@'localhost'"
mysql_user student_user student_ci_pw -e "SELECT COUNT(*) FROM students" >/dev/null
mysql_root -e "SHOW GRANTS FOR 'student_user'@'localhost'"

echo "MySQL 8.4 laboratory acceptance checks passed."
