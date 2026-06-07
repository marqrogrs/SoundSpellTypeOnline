function makeAccessError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function normalizeRole(value) {
  const raw = String(value || "").trim();
  const v = raw.toLowerCase().replace(/\s+/g, "");
  if (v === "admin") return "admin";
  if (v === "schooladmin" || v === "school_admin") return "schoolAdmin";
  if (v === "teacher" || v === "educator") return "educator";
  if (
    v === "parent" ||
    v === "homeschoolparent" ||
    v === "home_school_parent" ||
    v === "homeschool_parent"
  ) {
    return "parent";
  }
  if (
    v === "tutor" ||
    v === "readingspecialist" ||
    v === "reading_specialist" ||
    v === "tutor/readingspecialist"
  ) {
    return "tutor";
  }
  return "student";
}

function assertCanResetStudentPassword({
  callerUid,
  callerRole,
  callerData,
  studentExists,
  studentRecord,
  studentUserDoc,
}) {
  if (!studentExists) {
    throw makeAccessError("not-found", "Student account was not found.");
  }

  const role = normalizeRole(callerRole || callerData?.role || "student");
  const ownerId = String(
    studentUserDoc?.ownerId || studentUserDoc?.parentOwnerId || "",
  ).trim();
  const studentEducatorId = String(
    studentRecord?.educator || studentUserDoc?.educator || "",
  ).trim();

  if (role === "admin") {
    return;
  }

  if (role === "schoolAdmin") {
    if (ownerId && ownerId === callerUid) {
      return;
    }
    throw makeAccessError(
      "permission-denied",
      "You may only reset passwords for students you created.",
    );
  }

  if (role === "parent" || role === "tutor") {
    if (ownerId === callerUid || studentEducatorId === callerUid) {
      return;
    }
    throw makeAccessError(
      "permission-denied",
      "You may only reset passwords for your own students.",
    );
  }

  if (role === "educator") {
    if (studentEducatorId === callerUid || ownerId === callerUid) {
      return;
    }
    throw makeAccessError(
      "permission-denied",
      "You may only reset passwords for your own students.",
    );
  }

  throw makeAccessError(
    "permission-denied",
    "Only management users can reset student passwords.",
  );
}

module.exports = {
  assertCanResetStudentPassword,
};
