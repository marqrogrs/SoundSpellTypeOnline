function makeAccessError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function assertCanResetStudentPassword({
  callerUid,
  callerData,
  studentExists,
  studentRecord,
}) {
  const isEducator = Boolean(callerData && callerData.email);
  if (!isEducator) {
    throw makeAccessError(
      "permission-denied",
      "Only educators can reset student passwords.",
    );
  }

  if (!studentExists) {
    throw makeAccessError("not-found", "Student account was not found.");
  }

  if (!studentRecord || studentRecord.educator !== callerUid) {
    throw makeAccessError(
      "permission-denied",
      "You may only reset passwords for your own students.",
    );
  }
}

module.exports = {
  assertCanResetStudentPassword,
};
