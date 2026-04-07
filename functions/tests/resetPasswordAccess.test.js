const assert = require("node:assert/strict");

const { assertCanResetStudentPassword } = require("../resetPasswordAccess");

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

runCase("allows educator to reset password for their own student", () => {
  assert.doesNotThrow(() => {
    assertCanResetStudentPassword({
      callerUid: "educator-1",
      callerData: { email: "teacher@example.com" },
      studentExists: true,
      studentRecord: { educator: "educator-1" },
    });
  });
});

runCase("denies student callers", () => {
  assert.throws(
    () => {
      assertCanResetStudentPassword({
        callerUid: "student-1",
        callerData: { username: "student-1" },
        studentExists: true,
        studentRecord: { educator: "educator-1" },
      });
    },
    (error) =>
      error.code === "permission-denied" &&
      /Only educators can reset student passwords\./.test(error.message),
  );
});

runCase("denies educator resetting another educator's student", () => {
  assert.throws(
    () => {
      assertCanResetStudentPassword({
        callerUid: "educator-2",
        callerData: { email: "teacher2@example.com" },
        studentExists: true,
        studentRecord: { educator: "educator-1" },
      });
    },
    (error) =>
      error.code === "permission-denied" &&
      /You may only reset passwords for your own students\./.test(
        error.message,
      ),
  );
});

runCase("returns not-found when student record is missing", () => {
  assert.throws(
    () => {
      assertCanResetStudentPassword({
        callerUid: "educator-1",
        callerData: { email: "teacher@example.com" },
        studentExists: false,
        studentRecord: null,
      });
    },
    (error) =>
      error.code === "not-found" &&
      /Student account was not found\./.test(error.message),
  );
});

console.log("All resetPasswordAccess tests passed.");
