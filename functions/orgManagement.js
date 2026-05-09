/**
 * orgManagement.js
 *
 * v2 management callables for schools, classes, and user assignments.
 * All permission enforcement is done server-side.
 *
 * Role hierarchy:
 *   student(0) < parent(1) < educator(2) < schoolAdmin(3) < admin(4)
 *
 * Scope rules:
 *   admin       – full access across all schools
 *   schoolAdmin – own school only (schoolId on user doc)
 *   educator    – own assigned classes only
 *   parent      – own home-school / home-class / own students only
 *   student     – no management actions
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_RANK = {
  student: 0,
  parent: 1,
  educator: 2,
  schoolAdmin: 3,
  admin: 4,
};

function normalizeRole(input) {
  const raw = String(input || "").trim();
  const v = raw.toLowerCase();
  if (v === "4" || v === "admin") return "admin";
  if (v === "3" || v === "schooladmin" || v === "school_admin") {
    return "schoolAdmin";
  }
  if (v === "2" || v === "educator" || v === "teacher") return "educator";
  if (v === "1" || v === "parent") return "parent";
  if (v === "0" || v === "student") return "student";
  if (raw === "schoolAdmin") return "schoolAdmin";
  return "student";
}

function deriveRoleFromClaims(claims, fallbackEmail = "") {
  if (claims?.admin) return "admin";
  if (claims?.schoolAdmin) return "schoolAdmin";
  const roleFromClaim = normalizeRole(claims?.role);
  if (roleFromClaim !== "student") return roleFromClaim;
  return fallbackEmail ? "educator" : "student";
}

function buildClaimsForRole(role) {
  return {
    role,
    admin: role === "admin",
    schoolAdmin: role === "schoolAdmin",
    parent: role === "parent",
  };
}

function rankOf(role) {
  return ROLE_RANK[normalizeRole(role)] ?? 0;
}

const getDb = () => admin.firestore();
const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

async function getCallerDoc(uid) {
  const snap = await getDb().collection("users").doc(uid).get();
  return snap.exists ? snap.data() || {} : {};
}

async function resolveCaller(context) {
  if (!context?.auth?.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be signed in.",
    );
  }
  const uid = context.auth.uid;
  const record = await admin.auth().getUser(uid);
  const claims = record.customClaims || {};
  const role = deriveRoleFromClaims(claims, record.email || "");
  const doc = await getCallerDoc(uid);
  return { uid, role, email: String(record.email || "").toLowerCase(), doc };
}

function requireRank(caller, minRole) {
  if (rankOf(caller.role) < rankOf(minRole)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Insufficient permissions.",
    );
  }
}

/** Returns the caller's allowed schoolId, or null for admin (any school). */
function callerSchoolScope(caller) {
  if (caller.role === "admin") return null; // null = unrestricted
  const schoolId = String(caller.doc.schoolId || "").trim();
  if (!schoolId) return ""; // no school set — strictly no cross-school access
  return schoolId;
}

function assertSchoolAccess(caller, schoolId) {
  const scope = callerSchoolScope(caller);
  if (scope === null) return; // admin
  if (!scope || scope !== String(schoolId || "").trim()) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Access to this school is not permitted.",
    );
  }
}

async function writeAuditLog({
  actorUid,
  actorRole,
  action,
  targetId,
  status,
  before,
  after,
}) {
  try {
    await getDb()
      .collection("adminAuditLogs")
      .add({
        actorUid,
        actorRole,
        action,
        targetUserId: targetId || null,
        status,
        before: before || null,
        after: after || null,
        createdAt: serverTimestamp(),
      });
  } catch {
    // Audit log failures must not break the main operation.
  }
}

function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

// ─── Schools ─────────────────────────────────────────────────────────────────

/**
 * Create a real school (admin only).
 */
exports.mgmtCreateSchool = functions.https.onCall(async (data, context) => {
  const caller = await resolveCaller(context);
  requireRank(caller, "admin");

  const name = String(data?.name || "").trim();
  if (!name) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "School name is required.",
    );
  }

  const ref = await getDb()
    .collection("schools")
    .add({
      name,
      normalizedName: normalizeText(name),
      type: "regular",
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: caller.uid,
    });

  await writeAuditLog({
    actorUid: caller.uid,
    actorRole: caller.role,
    action: "mgmtCreateSchool",
    targetId: ref.id,
    status: "success",
    after: { name },
  });

  return { status: "success", schoolId: ref.id, name };
});

/**
 * Update a school's name (admin only, or schoolAdmin updating own school name).
 */
exports.mgmtUpdateSchool = functions.https.onCall(async (data, context) => {
  const caller = await resolveCaller(context);
  requireRank(caller, "schoolAdmin");

  const schoolId = String(data?.schoolId || "").trim();
  if (!schoolId)
    throw new functions.https.HttpsError(
      "invalid-argument",
      "schoolId is required.",
    );

  const schoolRef = getDb().collection("schools").doc(schoolId);
  const schoolSnap = await schoolRef.get();
  if (!schoolSnap.exists)
    throw new functions.https.HttpsError("not-found", "School not found.");
  const school = schoolSnap.data();

  // schoolAdmin can only update their own school; admin can update any.
  if (caller.role !== "admin") {
    assertSchoolAccess(caller, schoolId);
    // schoolAdmin cannot change type.
    if (data?.type !== undefined) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only admin can change school type.",
      );
    }
  }

  const patch = { updatedAt: serverTimestamp() };
  if (data?.name !== undefined) {
    const name = String(data.name).trim();
    if (!name)
      throw new functions.https.HttpsError(
        "invalid-argument",
        "School name cannot be empty.",
      );
    patch.name = name;
    patch.normalizedName = normalizeText(name);
  }

  await schoolRef.update(patch);

  await writeAuditLog({
    actorUid: caller.uid,
    actorRole: caller.role,
    action: "mgmtUpdateSchool",
    targetId: schoolId,
    status: "success",
    before: { name: school.name },
    after: patch,
  });

  return { status: "success" };
});

/**
 * Archive (soft-delete) a school. Admin only.
 */
exports.mgmtArchiveSchool = functions.https.onCall(async (data, context) => {
  const caller = await resolveCaller(context);
  requireRank(caller, "admin");

  const schoolId = String(data?.schoolId || "").trim();
  if (!schoolId)
    throw new functions.https.HttpsError(
      "invalid-argument",
      "schoolId is required.",
    );

  await getDb().collection("schools").doc(schoolId).update({
    isActive: false,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    actorUid: caller.uid,
    actorRole: caller.role,
    action: "mgmtArchiveSchool",
    targetId: schoolId,
    status: "success",
  });

  return { status: "success" };
});

// ─── Classes ──────────────────────────────────────────────────────────────────

/**
 * Create a class in a school (admin or schoolAdmin in own school).
 */
exports.mgmtCreateClass = functions.https.onCall(async (data, context) => {
  const caller = await resolveCaller(context);
  requireRank(caller, "schoolAdmin");

  const schoolId = String(data?.schoolId || "").trim();
  if (!schoolId)
    throw new functions.https.HttpsError(
      "invalid-argument",
      "schoolId is required.",
    );
  assertSchoolAccess(caller, schoolId);

  const schoolSnap = await getDb().collection("schools").doc(schoolId).get();
  if (!schoolSnap.exists || !schoolSnap.data().isActive) {
    throw new functions.https.HttpsError(
      "not-found",
      "School not found or inactive.",
    );
  }

  const name = String(data?.name || "").trim();
  if (!name)
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Class name is required.",
    );

  const educatorId = String(data?.educatorId || "").trim() || null;

  const ref = await getDb()
    .collection("classes")
    .add({
      name,
      normalizedName: normalizeText(name),
      schoolId,
      schoolType: schoolSnap.data().type || "regular",
      educatorId,
      educatorName: String(data?.educatorName || "").trim() || null,
      studentIds: [],
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: caller.uid,
    });

  await writeAuditLog({
    actorUid: caller.uid,
    actorRole: caller.role,
    action: "mgmtCreateClass",
    targetId: ref.id,
    status: "success",
    after: { name, schoolId, educatorId },
  });

  return { status: "success", classId: ref.id, name };
});

/**
 * Update a class (admin or schoolAdmin in own school).
 */
exports.mgmtUpdateClass = functions.https.onCall(async (data, context) => {
  const caller = await resolveCaller(context);
  requireRank(caller, "schoolAdmin");

  const classId = String(data?.classId || "").trim();
  if (!classId)
    throw new functions.https.HttpsError(
      "invalid-argument",
      "classId is required.",
    );

  const classRef = getDb().collection("classes").doc(classId);
  const classSnap = await classRef.get();
  if (!classSnap.exists)
    throw new functions.https.HttpsError("not-found", "Class not found.");

  assertSchoolAccess(caller, classSnap.data().schoolId);

  const patch = { updatedAt: serverTimestamp() };
  if (data?.name !== undefined) {
    const name = String(data.name).trim();
    if (!name)
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Class name cannot be empty.",
      );
    patch.name = name;
    patch.normalizedName = normalizeText(name);
  }
  if (Object.prototype.hasOwnProperty.call(data || {}, "educatorId")) {
    patch.educatorId = String(data.educatorId || "").trim() || null;
    patch.educatorName = String(data.educatorName || "").trim() || null;
  }

  await classRef.update(patch);

  await writeAuditLog({
    actorUid: caller.uid,
    actorRole: caller.role,
    action: "mgmtUpdateClass",
    targetId: classId,
    status: "success",
    after: patch,
  });

  return { status: "success" };
});

/**
 * Archive a class (admin or schoolAdmin in own school).
 */
exports.mgmtArchiveClass = functions.https.onCall(async (data, context) => {
  const caller = await resolveCaller(context);
  requireRank(caller, "schoolAdmin");

  const classId = String(data?.classId || "").trim();
  if (!classId)
    throw new functions.https.HttpsError(
      "invalid-argument",
      "classId is required.",
    );

  const classSnap = await getDb().collection("classes").doc(classId).get();
  if (!classSnap.exists)
    throw new functions.https.HttpsError("not-found", "Class not found.");

  assertSchoolAccess(caller, classSnap.data().schoolId);

  await getDb().collection("classes").doc(classId).update({
    isActive: false,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    actorUid: caller.uid,
    actorRole: caller.role,
    action: "mgmtArchiveClass",
    targetId: classId,
    status: "success",
  });

  return { status: "success" };
});

// ─── Student class assignment ─────────────────────────────────────────────────

/**
 * Replace the full list of classes a student belongs to.
 * Also updates studentIds on each affected class document.
 *
 * Access rules:
 *   admin     – any student
 *   schoolAdmin – students in own school
 *   educator  – students in their assigned classes only
 *   parent    – own students only
 */
exports.mgmtAssignStudentClasses = functions.https.onCall(
  async (data, context) => {
    const caller = await resolveCaller(context);
    requireRank(caller, "parent");

    const studentId = String(data?.studentId || "").trim();
    if (!studentId)
      throw new functions.https.HttpsError(
        "invalid-argument",
        "studentId is required.",
      );

    const studentRef = getDb().collection("users").doc(studentId);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists)
      throw new functions.https.HttpsError("not-found", "Student not found.");
    const studentDoc = studentSnap.data() || {};

    // Scope checks.
    if (caller.role === "parent") {
      if (studentDoc.parentOwnerId !== caller.uid) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "You can only manage your own students.",
        );
      }
    } else if (caller.role === "educator") {
      // Educator may only assign classes where they are the educatorId.
      const newClassIds = Array.isArray(data?.classIds)
        ? data.classIds.map(String)
        : [];
      const allowed = await getDb()
        .collection("classes")
        .where("educatorId", "==", caller.uid)
        .get();
      const allowedIds = new Set(allowed.docs.map((d) => d.id));
      if (!newClassIds.every((id) => allowedIds.has(id))) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "You can only assign students to your own classes.",
        );
      }
    } else if (caller.role === "schoolAdmin") {
      assertSchoolAccess(caller, studentDoc.schoolId);
    }

    const prevClassIds = Array.isArray(studentDoc.classIds)
      ? studentDoc.classIds
      : [];
    const nextClassIds = Array.isArray(data?.classIds)
      ? [...new Set(data.classIds.map(String).filter(Boolean))]
      : [];

    const removed = prevClassIds.filter((id) => !nextClassIds.includes(id));
    const added = nextClassIds.filter((id) => !prevClassIds.includes(id));

    const batch = getDb().batch();

    // Update class documents.
    for (const id of removed) {
      batch.update(getDb().collection("classes").doc(id), {
        studentIds: admin.firestore.FieldValue.arrayRemove(studentId),
        updatedAt: serverTimestamp(),
      });
    }
    for (const id of added) {
      batch.update(getDb().collection("classes").doc(id), {
        studentIds: admin.firestore.FieldValue.arrayUnion(studentId),
        updatedAt: serverTimestamp(),
      });
    }

    // Update student document.
    batch.update(studentRef, {
      classIds: nextClassIds,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

    await writeAuditLog({
      actorUid: caller.uid,
      actorRole: caller.role,
      action: "mgmtAssignStudentClasses",
      targetId: studentId,
      status: "success",
      before: { classIds: prevClassIds },
      after: { classIds: nextClassIds },
    });

    return { status: "success" };
  },
);

// ─── Parent home-scope bootstrap ─────────────────────────────────────────────

/**
 * Ensures a parent has a home school and parent class.
 * Creates them if they do not exist yet. Safe to call on every sign-in.
 * Returns { homeSchoolId, homeClassId }.
 */
exports.mgmtBootstrapParentHomeScope = functions.https.onCall(
  async (data, context) => {
    if (!context?.auth?.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in.",
      );
    }
    const uid = context.auth.uid;

    // Only parent (or admin bootstrapping for a parent) should call this.
    const record = await admin.auth().getUser(uid);
    const claims = record.customClaims || {};
    const role = deriveRoleFromClaims(claims, record.email || "");

    const callerDoc = await getCallerDoc(uid);
    const callerRole =
      normalizeRole(callerDoc.role) !== "student"
        ? normalizeRole(callerDoc.role)
        : role;

    if (callerRole !== "parent" && callerRole !== "admin") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only parent accounts use home scope.",
      );
    }

    const parentRef = getDb().collection("users").doc(uid);

    // Check for existing home school.
    let homeSchoolId = String(callerDoc.homeSchoolId || "").trim();
    let homeClassId = String(callerDoc.homeClassId || "").trim();

    if (!homeSchoolId) {
      const schoolRef = await getDb().collection("schools").add({
        name: "Home",
        normalizedName: "home",
        type: "home",
        parentOwnerId: uid,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
      });
      homeSchoolId = schoolRef.id;
    }

    if (!homeClassId) {
      const classRef = await getDb()
        .collection("classes")
        .add({
          name: "Parent",
          normalizedName: "parent",
          schoolId: homeSchoolId,
          schoolType: "home",
          educatorId: uid,
          educatorName: String(record.email || uid),
          studentIds: [],
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: uid,
        });
      homeClassId = classRef.id;
    }

    // Persist back to user doc if changed.
    const needsPatch =
      homeSchoolId !== String(callerDoc.homeSchoolId || "").trim() ||
      homeClassId !== String(callerDoc.homeClassId || "").trim();

    if (needsPatch) {
      await parentRef.set(
        { homeSchoolId, homeClassId, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }

    return { status: "success", homeSchoolId, homeClassId };
  },
);

/**
 * Parent creates a student account scoped to their home class.
 * Returns { userId, tempPassword }.
 */
exports.mgmtParentCreateStudent = functions.https.onCall(
  async (data, context) => {
    if (!context?.auth?.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in.",
      );
    }
    const uid = context.auth.uid;

    const record = await admin.auth().getUser(uid);
    const claims = record.customClaims || {};
    const role = deriveRoleFromClaims(claims, record.email || "");
    const callerDoc = await getCallerDoc(uid);
    const callerRole =
      normalizeRole(callerDoc.role) !== "student"
        ? normalizeRole(callerDoc.role)
        : role;

    if (callerRole !== "parent" && callerRole !== "admin") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only parent accounts can use this endpoint.",
      );
    }

    const homeSchoolId = String(callerDoc.homeSchoolId || "").trim();
    const homeClassId = String(callerDoc.homeClassId || "").trim();

    if (!homeSchoolId || !homeClassId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Home school/class not set up. Call mgmtBootstrapParentHomeScope first.",
      );
    }

    const username = String(data?.username || "").trim();
    if (!username)
      throw new functions.https.HttpsError(
        "invalid-argument",
        "username is required.",
      );
    if (!/^[a-z0-9]+$/i.test(username)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Username can only contain letters and numbers.",
      );
    }

    const bcrypt = require("bcryptjs");
    const saltRounds = 10;

    // Check existing.
    const rtdb = admin.database();
    const existing = await rtdb.ref(`/students/${username}`).once("value");
    if (existing.exists()) {
      throw new functions.https.HttpsError(
        "already-exists",
        "A student with that username already exists.",
      );
    }

    const rawPassword = String(data?.password || "").trim();
    const tempPassword =
      rawPassword.length >= 6 ? rawPassword : randomPassword(12);
    const hash = await bcrypt.hash(tempPassword, saltRounds);

    await rtdb.ref(`/students/${username}`).set({ p: hash, educator: uid });

    await getDb()
      .collection("users")
      .doc(username)
      .set(
        {
          username,
          firstName: String(data?.firstName || "").trim(),
          lastName: String(data?.lastName || "").trim(),
          role: "student",
          parentOwnerId: uid,
          schoolId: homeSchoolId,
          classIds: [homeClassId],
          educator: uid,
          classroom: homeClassId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          passwordResetRequired: false,
        },
        { merge: true },
      );

    // Add student to the home class.
    await getDb()
      .collection("classes")
      .doc(homeClassId)
      .update({
        studentIds: admin.firestore.FieldValue.arrayUnion(username),
        updatedAt: serverTimestamp(),
      });

    await writeAuditLog({
      actorUid: uid,
      actorRole: callerRole,
      action: "mgmtParentCreateStudent",
      targetId: username,
      status: "success",
      after: { parentOwnerId: uid, homeSchoolId, homeClassId },
    });

    return { status: "success", userId: username, tempPassword };
  },
);

// ─── Management data loader ───────────────────────────────────────────────────

/**
 * Loads the role-scoped dataset used by the Management page.
 *
 * Response shape:
 * {
 *   schools: School[],
 *   classes: Class[],
 *   users:   User[],
 *   meta: { callerRole, callerSchoolId }
 * }
 *
 * admin      – sees all active schools, classes, users
 * schoolAdmin – sees own school, classes in own school, users in own school
 * educator   – sees assigned classes + students in those classes
 * parent     – sees home school, home class, own students
 */
exports.mgmtListData = functions.https.onCall(async (data, context) => {
  const caller = await resolveCaller(context);
  requireRank(caller, "parent");

  const db = getDb();
  const mapSnapDocs = (snap) =>
    snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  };
  const toId = (value) => {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object") {
      const direct = String(value.id || value.schoolId || "").trim();
      if (direct) return direct;

      // Firestore reference-like objects can carry the id in a path.
      const path = String(
        value.path || value._path?.canonicalString || "",
      ).trim();
      if (path) {
        const parts = path.split("/").filter(Boolean);
        return String(parts[parts.length - 1] || "").trim();
      }

      const segs = Array.isArray(value._path?.segments)
        ? value._path.segments
        : Array.isArray(value.segments)
          ? value.segments
          : null;
      if (segs && segs.length > 0) {
        return String(segs[segs.length - 1] || "").trim();
      }
    }
    return "";
  };
  const toSchoolLabel = (schoolDoc) =>
    String(
      schoolDoc?.name ||
        schoolDoc?.schoolName ||
        schoolDoc?.title ||
        schoolDoc?.displayName ||
        "",
    ).trim();

  // ── Schools ──
  let schools = [];
  // ── Classes ──
  let classes = [];

  // ── Users ──
  let users = [];

  if (caller.role === "admin") {
    const [schoolSnap, classSnap, userSnap] = await Promise.all([
      db.collection("schools").where("isActive", "==", true).get(),
      db.collection("classes").where("isActive", "==", true).get(),
      db.collection("users").get(),
    ]);
    schools = mapSnapDocs(schoolSnap);
    classes = mapSnapDocs(classSnap);
    users = mapSnapDocs(userSnap);
  } else if (caller.role === "schoolAdmin") {
    const scope = callerSchoolScope(caller);
    if (scope) {
      const [schoolSnap, classSnap, userSnap] = await Promise.all([
        db.collection("schools").doc(scope).get(),
        db
          .collection("classes")
          .where("schoolId", "==", scope)
          .where("isActive", "==", true)
          .get(),
        db.collection("users").where("schoolId", "==", scope).get(),
      ]);
      if (schoolSnap.exists && schoolSnap.data()?.isActive) {
        schools = [{ id: schoolSnap.id, ...schoolSnap.data() }];
      }
      classes = mapSnapDocs(classSnap);
      users = mapSnapDocs(userSnap);
    }
  } else if (caller.role === "educator") {
    const classSnap = await db
      .collection("classes")
      .where("educatorId", "==", caller.uid)
      .where("isActive", "==", true)
      .get();
    classes = mapSnapDocs(classSnap);

    const studentIds = [...new Set(classes.flatMap((c) => c.studentIds || []))];
    if (studentIds.length > 0) {
      const idChunks = chunk(studentIds, 10);
      const userSnaps = await Promise.all(
        idChunks.map((ids) =>
          db
            .collection("users")
            .where(admin.firestore.FieldPath.documentId(), "in", ids)
            .get(),
        ),
      );
      users = userSnaps.flatMap((snap) => mapSnapDocs(snap));
    }
  } else if (caller.role === "parent") {
    const homeSchoolId = String(caller.doc.homeSchoolId || "").trim();
    const homeClassId = String(caller.doc.homeClassId || "").trim();
    const [schoolSnap, classSnap, userSnap] = await Promise.all([
      homeSchoolId
        ? db.collection("schools").doc(homeSchoolId).get()
        : Promise.resolve(null),
      homeClassId
        ? db.collection("classes").doc(homeClassId).get()
        : Promise.resolve(null),
      db.collection("users").where("parentOwnerId", "==", caller.uid).get(),
    ]);
    if (schoolSnap?.exists)
      schools = [{ id: schoolSnap.id, ...schoolSnap.data() }];
    if (classSnap?.exists)
      classes = [{ id: classSnap.id, ...classSnap.data() }];
    users = mapSnapDocs(userSnap);
  }

  // Fallback mapping for school-admin assignments. This protects display and
  // scope data if a separate process clears users.schoolId unexpectedly.
  const schoolAdminAssignmentByUserId = new Map();
  const schoolAdminUserIds = users
    .filter((u) => normalizeRole(u?.role) === "schoolAdmin")
    .map((u) => String(u?.id || "").trim())
    .filter(Boolean);
  if (schoolAdminUserIds.length > 0) {
    const assignmentRefs = schoolAdminUserIds.map((uid) =>
      db.collection("schoolAdminAssignments").doc(uid),
    );
    const assignmentSnaps = await db.getAll(...assignmentRefs);
    const unresolvedAdminUids = [];
    assignmentSnaps.forEach((snap, idx) => {
      const uid = schoolAdminUserIds[idx];
      if (!snap.exists) {
        unresolvedAdminUids.push(uid);
        return;
      }
      const aid = toId(snap.data()?.schoolId || snap.data()?.school);
      if (aid) {
        schoolAdminAssignmentByUserId.set(uid, aid);
      } else {
        unresolvedAdminUids.push(uid);
      }
    });

    // Legacy/defensive fallback: some historical writes may have used auto IDs
    // with userId as a field. Resolve those as well.
    if (unresolvedAdminUids.length > 0) {
      const unresolvedChunks = chunk(unresolvedAdminUids, 10);
      const legacyAssignmentSnaps = await Promise.all(
        unresolvedChunks.map((uids) =>
          db
            .collection("schoolAdminAssignments")
            .where("userId", "in", uids)
            .get(),
        ),
      );
      legacyAssignmentSnaps.forEach((qsnap) => {
        qsnap.docs.forEach((doc) => {
          const legacyDoc = doc.data() || {};
          const uid = String(legacyDoc.userId || "").trim();
          const aid = toId(legacyDoc.schoolId || legacyDoc.school);
          if (uid && aid) {
            schoolAdminAssignmentByUserId.set(uid, aid);
          }
        });
      });
    }

    // If there is only one active school and a schoolAdmin is still unscoped,
    // default to that school as a final recovery path.
    const soleActiveSchoolId = schools.length === 1 ? toId(schools[0]?.id) : "";
    if (soleActiveSchoolId) {
      users.forEach((u) => {
        if (normalizeRole(u?.role) !== "schoolAdmin") return;
        const uid = String(u?.id || "").trim();
        if (!uid) return;
        const currentSid = toId(u?.schoolId || u?.school || u?.homeSchoolId);
        if (currentSid) return;
        if (!schoolAdminAssignmentByUserId.has(uid)) {
          schoolAdminAssignmentByUserId.set(uid, soleActiveSchoolId);
        }
      });
    }

    // Keep response rows normalized without performing write-on-read commits.
    users.forEach((u) => {
      const uid = String(u?.id || "").trim();
      if (!uid) return;
      const assignedSid = toId(schoolAdminAssignmentByUserId.get(uid));
      if (!assignedSid) return;

      const currentSid = toId(u?.schoolId || u?.school);
      if (currentSid) return;

      // Keep in-memory row consistent for this response as well.
      u.schoolId = assignedSid;
      u.school = assignedSid;
      u.homeSchoolId = assignedSid;
    });
  }

  // Recovery path for legacy educator creates/updates that dropped schoolId
  // even though the org only has one active school.
  const soleScopedSchoolId = schools.length === 1 ? toId(schools[0]?.id) : "";
  if (soleScopedSchoolId) {
    // Normalize in-memory response only; avoid write-on-read commits.
    users.forEach((u) => {
      if (normalizeRole(u?.role) !== "educator") return;
      const uid = String(u?.id || "").trim();
      if (!uid) return;

      const currentSid = toId(u?.schoolId || u?.school || u?.homeSchoolId);
      if (currentSid) return;

      u.schoolId = soleScopedSchoolId;
      u.school = soleScopedSchoolId;
      u.homeSchoolId = soleScopedSchoolId;
    });
  }

  // Ensure school name mapping is complete for rendered rows.
  // This avoids "missing school name" when a returned user/class references
  // a school that was not part of the initial role-scoped school query.
  const referencedSchoolIds = new Set();
  schools.forEach((s) => {
    const sid = toId(s?.id || s?.schoolId);
    if (sid) referencedSchoolIds.add(sid);
  });
  classes.forEach((c) => {
    const sid = toId(c?.schoolId || c?.school);
    if (sid) referencedSchoolIds.add(sid);
  });
  users.forEach((u) => {
    const sid = toId(u?.schoolId);
    if (sid) referencedSchoolIds.add(sid);
    const legacySid = toId(u?.school);
    if (legacySid) referencedSchoolIds.add(legacySid);
    const hid = toId(u?.homeSchoolId);
    if (hid) referencedSchoolIds.add(hid);
    const assignedSid = toId(schoolAdminAssignmentByUserId.get(u?.id));
    if (assignedSid) referencedSchoolIds.add(assignedSid);
  });

  const loadedSchoolIds = new Set(
    schools.map((s) => toId(s?.id || s?.schoolId)),
  );
  const missingSchoolIds = [...referencedSchoolIds].filter(
    (id) => id && !loadedSchoolIds.has(id),
  );
  if (missingSchoolIds.length > 0) {
    const missingRefs = missingSchoolIds.map((id) =>
      db.collection("schools").doc(id),
    );
    const missingSnaps = await db.getAll(...missingRefs);
    const recoveredSchools = missingSnaps
      .filter((snap) => snap.exists)
      .map((snap) => ({ id: snap.id, ...snap.data() }));
    schools = [...schools, ...recoveredSchools];
  }

  schools = schools.map((s) => ({
    ...s,
    id: toId(s?.id || s?.schoolId),
    name: toSchoolLabel(s),
  }));

  const soleActiveSchoolId = schools.length === 1 ? toId(schools[0]?.id) : "";

  const schoolNameById = new Map(
    schools.filter((s) => s.id).map((s) => [s.id, s.name || s.id]),
  );
  const classIdsByEducatorId = new Map();
  classes.forEach((c) => {
    const educatorId = String(c?.educatorId || "").trim();
    const classId = String(c?.id || "").trim();
    if (!educatorId || !classId) return;
    const existingIds = classIdsByEducatorId.get(educatorId) || [];
    existingIds.push(classId);
    classIdsByEducatorId.set(educatorId, existingIds);
  });

  // Strip sensitive fields before returning.
  const safeUsers = users.map(
    ({
      id,
      role,
      email,
      username,
      firstName,
      lastName,
      schoolId,
      school,
      classIds,
      educator,
      classroom,
      homeSchoolId,
      homeClassId,
      parentOwnerId,
      createdAt,
    }) => {
      const normalizedRole = normalizeRole(role);
      const assignedSchoolId = schoolAdminAssignmentByUserId.get(id) || "";
      const resolvedSchoolIdCandidate =
        toId(schoolId) ||
        toId(school) ||
        toId(homeSchoolId) ||
        toId(assignedSchoolId);
      const resolvedSchoolId =
        resolvedSchoolIdCandidate ||
        (normalizedRole === "schoolAdmin" ? soleActiveSchoolId : "");
      const resolvedSchoolName = String(
        schoolNameById.get(resolvedSchoolId) ||
          (resolvedSchoolId && !schoolNameById.has(resolvedSchoolId)
            ? resolvedSchoolId
            : ""),
      );
      const resolvedClassIds =
        normalizedRole === "educator"
          ? classIdsByEducatorId.get(String(id || "").trim()) || []
          : Array.isArray(classIds)
            ? classIds
            : [];
      return {
        id,
        role: normalizedRole,
        email: String(email || ""),
        username: String(username || id),
        firstName: String(firstName || ""),
        lastName: String(lastName || ""),
        schoolId: resolvedSchoolId,
        schoolName: resolvedSchoolName,
        classIds: resolvedClassIds,
        educator: String(educator || ""),
        classroom: String(classroom || ""),
        homeSchoolId: String(homeSchoolId || ""),
        homeClassId: String(homeClassId || ""),
        parentOwnerId: String(parentOwnerId || ""),
        createdAt: createdAt || null,
      };
    },
  );

  return {
    schools,
    classes,
    users: safeUsers,
    meta: {
      callerRole: caller.role,
      callerSchoolId: callerSchoolScope(caller) ?? "",
      callerUid: caller.uid,
    },
  };
});

// ─── Assign schoolAdmin to school ────────────────────────────────────────────

/**
 * Assign a schoolAdmin user to a school. Admin only.
 */
exports.mgmtAssignSchoolAdmin = functions.https.onCall(
  async (data, context) => {
    const caller = await resolveCaller(context);
    requireRank(caller, "admin");

    const userId = String(data?.userId || "").trim();
    const schoolId = String(data?.schoolId || "").trim();
    if (!userId || !schoolId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "userId and schoolId are required.",
      );
    }

    const [userSnap, schoolSnap] = await Promise.all([
      getDb().collection("users").doc(userId).get(),
      getDb().collection("schools").doc(schoolId).get(),
    ]);

    if (!userSnap.exists)
      throw new functions.https.HttpsError("not-found", "User not found.");
    if (!schoolSnap.exists || !schoolSnap.data().isActive) {
      throw new functions.https.HttpsError(
        "not-found",
        "School not found or inactive.",
      );
    }

    const userRole = normalizeRole(userSnap.data()?.role);

    const prev = String(userSnap.data().schoolId || "");
    const patch = {
      schoolId,
      // Legacy compatibility for older readers that still look at `school`.
      school: schoolId,
      updatedAt: serverTimestamp(),
    };
    if (userRole !== "schoolAdmin") {
      patch.role = "schoolAdmin";
    }

    await getDb()
      .collection("users")
      .doc(userId)
      .set(
        {
          ...patch,
          homeSchoolId: schoolId,
        },
        { merge: true },
      );

    await getDb().collection("schoolAdminAssignments").doc(userId).set(
      {
        userId,
        schoolId,
        school: schoolId,
        updatedAt: serverTimestamp(),
        assignedBy: caller.uid,
      },
      { merge: true },
    );

    const verifySnap = await getDb().collection("users").doc(userId).get();
    const verifyData = verifySnap.exists ? verifySnap.data() || {} : {};
    const assignmentVerifySnap = await getDb()
      .collection("schoolAdminAssignments")
      .doc(userId)
      .get();
    const assignmentVerifyData = assignmentVerifySnap.exists
      ? assignmentVerifySnap.data() || {}
      : {};
    const savedSchoolId = String(
      verifyData.schoolId || verifyData.school || "",
    ).trim();
    const assignedSchoolId = String(
      assignmentVerifyData.schoolId || assignmentVerifyData.school || "",
    ).trim();
    if (savedSchoolId !== schoolId && assignedSchoolId !== schoolId) {
      console.error("mgmtAssignSchoolAdmin verification mismatch", {
        callerUid: caller.uid,
        targetUserId: userId,
        expectedSchoolId: schoolId,
        savedSchoolId,
        assignedSchoolId,
        verifyExists: verifySnap.exists,
      });
      throw new functions.https.HttpsError(
        "aborted",
        "School assignment did not persist. Please retry.",
      );
    }

    // Keep auth claims aligned so route gating and role checks stay consistent.
    await admin
      .auth()
      .setCustomUserClaims(userId, buildClaimsForRole("schoolAdmin"));

    await writeAuditLog({
      actorUid: caller.uid,
      actorRole: caller.role,
      action: "mgmtAssignSchoolAdmin",
      targetId: userId,
      status: "success",
      before: { schoolId: prev },
      after: { schoolId },
    });

    return {
      status: "success",
      userId,
      schoolId,
      verifiedSchoolId: savedSchoolId || assignedSchoolId,
    };
  },
);

// ─── Assign educator to school ────────────────────────────────────────────────

/**
 * Assign an educator to a school (admin or schoolAdmin managing own school).
 */
exports.mgmtAssignEducatorToSchool = functions.https.onCall(
  async (data, context) => {
    const caller = await resolveCaller(context);
    requireRank(caller, "schoolAdmin");

    const userId = String(data?.userId || "").trim();
    const schoolId = String(data?.schoolId || "").trim();
    if (!userId || !schoolId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "userId and schoolId are required.",
      );
    }

    assertSchoolAccess(caller, schoolId);

    const [userSnap, schoolSnap] = await Promise.all([
      getDb().collection("users").doc(userId).get(),
      getDb().collection("schools").doc(schoolId).get(),
    ]);
    if (!userSnap.exists)
      throw new functions.https.HttpsError("not-found", "User not found.");
    if (!schoolSnap.exists || !schoolSnap.data()?.isActive) {
      throw new functions.https.HttpsError(
        "not-found",
        "School not found or inactive.",
      );
    }

    const userRole = normalizeRole(userSnap.data()?.role);
    if (userRole !== "educator") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "User must have educator role.",
      );
    }

    const prev = String(userSnap.data().schoolId || "");

    await getDb().collection("users").doc(userId).set(
      {
        schoolId,
        school: schoolId,
        homeSchoolId: schoolId,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    const verifySnap = await getDb().collection("users").doc(userId).get();
    const verifyData = verifySnap.exists ? verifySnap.data() || {} : {};
    const savedSchoolId = String(
      verifyData.schoolId || verifyData.school || verifyData.homeSchoolId || "",
    ).trim();
    if (savedSchoolId !== schoolId) {
      throw new functions.https.HttpsError(
        "aborted",
        "School assignment did not persist. Please retry.",
      );
    }

    await writeAuditLog({
      actorUid: caller.uid,
      actorRole: caller.role,
      action: "mgmtAssignEducatorToSchool",
      targetId: userId,
      status: "success",
      before: { schoolId: prev },
      after: { schoolId },
    });

    return {
      status: "success",
      userId,
      schoolId,
      verifiedSchoolId: savedSchoolId,
    };
  },
);

// ─── Debug: raw Firestore user doc (admin only) ───────────────────────────────

/**
 * Returns the raw Firestore document for a user + the schoolAdminAssignments
 * record so the admin can diagnose why schoolId is not resolving.
 */
exports.mgmtDebugUser = functions.https.onCall(async (data, context) => {
  const caller = await resolveCaller(context);
  requireRank(caller, "admin");

  const userId = String(data?.userId || "").trim();
  if (!userId)
    throw new functions.https.HttpsError(
      "invalid-argument",
      "userId is required.",
    );

  const db = getDb();
  const [userSnap, assignSnap] = await Promise.all([
    db.collection("users").doc(userId).get(),
    db.collection("schoolAdminAssignments").doc(userId).get(),
  ]);

  return {
    userDocExists: userSnap.exists,
    userDocData: userSnap.exists ? userSnap.data() : null,
    assignmentDocExists: assignSnap.exists,
    assignmentDocData: assignSnap.exists ? assignSnap.data() : null,
  };
});

// ─── Helper (also needed inside this module) ─────────────────────────────────

function randomPassword(length = 12) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function getCallerDoc(uid) {
  return admin
    .firestore()
    .collection("users")
    .doc(uid)
    .get()
    .then((snap) => (snap.exists ? snap.data() || {} : {}));
}
