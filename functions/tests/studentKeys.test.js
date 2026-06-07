const assert = require("node:assert/strict");

const { toStudentRecordKey } = require("../studentKeys");

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

runCase("leaves simple usernames unchanged", () => {
  assert.equal(toStudentRecordKey("StudentOne"), "StudentOne");
});

runCase("encodes email-style usernames for RTDB keys", () => {
  assert.equal(toStudentRecordKey("student@mail.mail"), "student@mail%2Email");
});

runCase("encodes all RTDB-reserved key characters", () => {
  assert.equal(toStudentRecordKey("a.#$[]/b"), "a%2E%23%24%5B%5D%2Fb");
});

console.log("All studentKeys tests passed.");
