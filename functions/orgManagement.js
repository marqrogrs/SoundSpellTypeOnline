/**
 * orgManagement.js
 *
 * v2 management callables for schools, classes, and user assignments.
 * All permission enforcement is done server-side.
 *
 * Role hierarchy:
 *   student(0) < parent/tutor(1) < educator(2) < schoolAdmin(3) < admin(4)
 *
 * Scope rules:
 *   admin       – full access across all schools
 *   schoolAdmin – own school only (schoolId on user doc)
 *   educator    – own assigned classes only
 *   parent      – own home-school / home-class / own students only
 *   tutor       – own home-school / home-class / own students only
 *   student     – no management actions
 */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const {
  normalizeRole: _normalizeRoleUtil,
  rankOf: _rankOfUtil,
  buildClaimsForRole: _buildClaimsUtil,
} = require("./roleUtils");
const { generateUsername: _generateUsernameUtil } = require("./usernameUtils");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_RANK = {
  student: 0,
  parent: 1,
  tutor: 1,
  educator: 2,
  schoolAdmin: 3,
  admin: 4,
};

function normalizeRole(input) {
  const raw = String(input || "").trim();
  const v = raw.toLowerCase().replace(/\s+/g, "");
  if (v === "4" || v === "admin") return "admin";
  if (v === "3" || v === "schooladmin" || v === "school_admin") {
    return "schoolAdmin";
  }
  if (v === "2" || v === "educator" || v === "teacher") return "educator";
  // "homeSchoolParent" and variants all map to parent
  if (
    v === "1" ||
    v === "parent" ||
    v === "homeschoolparent" ||
    v === "home_school_parent" ||
    v === "homeschool_parent"
  )
    return "parent";
  if (
    v === "tutor" ||
    v === "readingspecialist" ||
    v === "reading_specialist" ||
    v === "tutor/readingspecialist"
  )
    return "tutor";
  if (v === "0" || v === "student") return "student";
  if (raw === "schoolAdmin") return "schoolAdmin";
  return "student";
}

function deriveRoleFromClaims(claims, fallbackEmail = "") {
  void fallbackEmail;
  if (claims?.admin) return "admin";
  if (claims?.schoolAdmin) return "schoolAdmin";
  if (claims?.parent) return "parent";
  if (claims?.tutor) return "tutor";
  const roleFromClaim = normalizeRole(claims?.role);
  if (roleFromClaim !== "student") return roleFromClaim;
  return "student";
}

function pickEffectiveRole(claimsRole, docRole) {
  if (claimsRole === "admin" || claimsRole === "schoolAdmin") {
    return claimsRole;
  }
  if (
    docRole === "admin" ||
    docRole === "schoolAdmin" ||
    docRole === "student" ||
    docRole === "parent" ||
    docRole === "tutor" ||
    docRole === "educator"
  ) {
    return docRole;
  }
  return claimsRole || docRole || "student";
}

function buildClaimsForRole(role) {
  return {
    role,
    admin: role === "admin",
    schoolAdmin: role === "schoolAdmin",
    parent: role === "parent",
    tutor: role === "tutor",
  };
}

function rankOf(role) {
  return ROLE_RANK[normalizeRole(role)] ?? 0;
}

const getDb = () => admin.firestore();
const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

// ─── Username generation ──────────────────────────────────────────────────────

/**
 * Generates a unique username by delegating slug logic to usernameUtils and
 * checking uniqueness against both Realtime DB and Firestore.
 */
async function generateUsername(firstName, lastName) {
  const isTaken = async (name) => {
    const [rtSnap, fsDoc] = await Promise.all([
      admin.database().ref(`/students/${name}`).once("value"),
      getDb().collection("users").doc(name).get(),
    ]);
    return rtSnap.exists() || fsDoc.exists;
  };
  return _generateUsernameUtil(firstName, lastName, isTaken);
}

async function getCallerDoc(uid, email = "") {
  const uidSnap = await getDb().collection("users").doc(uid).get();
  if (uidSnap.exists) {
    return uidSnap.data() || {};
  }

  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalizedEmail) {
    return {};
  }

  const emailLocalPart = normalizedEmail.split("@")[0] || "";

  const [emailDocSnap, emailQuerySnap, usernameEmailSnap, usernameLocalSnap] =
    await Promise.all([
      getDb().collection("users").doc(normalizedEmail).get(),
      getDb()
        .collection("users")
        .where("email", "==", normalizedEmail)
        .limit(1)
        .get(),
      getDb()
        .collection("users")
        .where("username", "==", normalizedEmail)
        .limit(1)
        .get(),
      emailLocalPart
        ? getDb()
            .collection("users")
            .where("username", "==", emailLocalPart)
            .limit(1)
            .get()
        : Promise.resolve({ empty: true, docs: [] }),
    ]);

  if (emailDocSnap.exists) {
    return emailDocSnap.data() || {};
  }

  if (!emailQuerySnap.empty) {
    return emailQuerySnap.docs[0].data() || {};
  }

  if (!usernameEmailSnap.empty) {
    return usernameEmailSnap.docs[0].data() || {};
  }

  if (!usernameLocalSnap.empty) {
    return usernameLocalSnap.docs[0].data() || {};
  }

  return {};
}

async function inferManagedRoleFromOwnedStudents(uid) {
  const db = getDb();
  const [ownerSnap, legacyOwnerSnap] = await Promise.all([
    db.collection("users").where("ownerId", "==", uid).limit(1).get(),
    db.collection("users").where("parentOwnerId", "==", uid).limit(1).get(),
  ]);

  const sourceDoc = ownerSnap.docs[0] || legacyOwnerSnap.docs[0] || null;
  if (!sourceDoc) {
    const homeClassSnap = await db
      .collection("classes")
      .where("educatorId", "==", uid)
      .where("schoolType", "==", "home")
      .limit(1)
      .get();

    if (homeClassSnap.empty) {
      return { role: null, docPatch: null };
    }

    const homeClass = homeClassSnap.docs[0].data() || {};
    const className = String(
      homeClass.normalizedName || homeClass.name || "",
    ).toLowerCase();
    const inferredRole = className.includes("tutor") ? "tutor" : "parent";
    const homeSchoolId = String(homeClass.schoolId || "").trim();
    const homeClassId = String(homeClassSnap.docs[0].id || "").trim();

    return {
      role: inferredRole,
      docPatch: {
        role: inferredRole,
        homeSchoolId,
        homeClassId,
      },
    };
  }

  const source = sourceDoc.data() || {};
  const ownerRole = normalizeRole(source.ownerRole || "");
  const inferredRole = ownerRole === "tutor" ? "tutor" : "parent";
  const classIds = Array.isArray(source.classIds) ? source.classIds : [];

  return {
    role: inferredRole,
    docPatch: {
      role: inferredRole,
      homeSchoolId: String(
        source.homeSchoolId || source.schoolId || source.school || "",
      ).trim(),
      homeClassId: String(classIds[0] || source.homeClassId || "").trim(),
    },
  };
}

async function inferEducatorRoleFromAssignedClasses(uid) {
  const classSnap = await getDb()
    .collection("classes")
    .where("educatorId", "==", uid)
    .where("isActive", "==", true)
    .limit(1)
    .get();

  if (classSnap.empty) {
    return { role: null, docPatch: null };
  }

  const classDoc = classSnap.docs[0];
  const classData = classDoc.data() || {};
  return {
    role: "educator",
    docPatch: {
      role: "educator",
      schoolId: String(classData.schoolId || "").trim(),
    },
  };
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
  let doc = await getCallerDoc(uid, record.email || "");
  if (!String(doc?.role || "").trim()) {
    try {
      const inferred = await inferManagedRoleFromOwnedStudents(uid);
      if (inferred?.role) {
        doc = {
          ...doc,
          ...(inferred.docPatch || {}),
        };
      } else {
        const inferredEducator =
          await inferEducatorRoleFromAssignedClasses(uid);
        if (inferredEducator?.role) {
          doc = {
            ...doc,
            ...(inferredEducator.docPatch || {}),
          };
        }
      }
    } catch (_err) {
      // Keep best-effort caller doc.
    }
  }
  const claims = record.customClaims || {};
  const claimsRole = deriveRoleFromClaims(claims, record.email || "");
  const docRole = normalizeRole(doc?.role || "");
  let role = pickEffectiveRole(claimsRole, doc?.role ? docRole : null);

  if (role === "student" && String(record.email || "").trim()) {
    role = "parent";
    if (!String(doc?.role || "").trim()) {
      doc = { ...doc, role: "parent" };
    }
  }

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
 * Ensures a parent/tutor has a home school and home class.
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

    // Only parent/tutor (or admin bootstrapping for one) should call this.
    const record = await admin.auth().getUser(uid);
    const claims = record.customClaims || {};
    const role = deriveRoleFromClaims(claims, record.email || "");

    let callerDoc = await getCallerDoc(uid, record.email || "");
    if (!String(callerDoc?.role || "").trim()) {
      try {
        const inferred = await inferManagedRoleFromOwnedStudents(uid);
        if (inferred?.role) {
          callerDoc = {
            ...callerDoc,
            ...(inferred.docPatch || {}),
          };
        }
      } catch (_err) {
        // Keep best-effort callerDoc.
      }
    }
    const callerRole =
      normalizeRole(callerDoc.role) !== "student"
        ? normalizeRole(callerDoc.role)
        : role;

    const effectiveCallerRole =
      callerRole === "student" && String(record.email || "").trim()
        ? "parent"
        : callerRole;

    if (
      effectiveCallerRole !== "parent" &&
      effectiveCallerRole !== "tutor" &&
      effectiveCallerRole !== "admin"
    ) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only parent/tutor accounts use home scope.",
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
          name: effectiveCallerRole === "tutor" ? "Tutor" : "Parent",
          normalizedName: effectiveCallerRole === "tutor" ? "tutor" : "parent",
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
 * Parent/tutor creates a student account scoped to their home class.
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
    let callerDoc = await getCallerDoc(uid, record.email || "");
    if (!String(callerDoc?.role || "").trim()) {
      try {
        const inferred = await inferManagedRoleFromOwnedStudents(uid);
        if (inferred?.role) {
          callerDoc = {
            ...callerDoc,
            ...(inferred.docPatch || {}),
          };
        }
      } catch (_err) {
        // Keep best-effort callerDoc.
      }
    }
    const callerRole =
      normalizeRole(callerDoc.role) !== "student"
        ? normalizeRole(callerDoc.role)
        : role;

    const effectiveCallerRole =
      callerRole === "student" && String(record.email || "").trim()
        ? "parent"
        : callerRole;

    if (
      effectiveCallerRole !== "parent" &&
      effectiveCallerRole !== "tutor" &&
      effectiveCallerRole !== "admin"
    ) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only parent/tutor accounts can use this endpoint.",
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

    const firstNameVal = String(data?.firstName || "").trim();
    const lastNameVal = String(data?.lastName || "").trim();

    if (!firstNameVal || !lastNameVal) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "First and last name are required.",
      );
    }

    // Resolve final username
    const username = await generateUsername(firstNameVal, lastNameVal);

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
          email: null,
          role: "student",
          ownerId: uid,
          ownerRole:
            effectiveCallerRole === "admin" ? "parent" : effectiveCallerRole,
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
      actorRole: effectiveCallerRole,
      action: "mgmtParentCreateStudent",
      targetId: username,
      status: "success",
      after: {
        ownerId: uid,
        ownerRole:
          effectiveCallerRole === "admin" ? "parent" : effectiveCallerRole,
        parentOwnerId: uid,
        homeSchoolId,
        homeClassId,
      },
    });

    return {
      status: "success",
      userId: username,
      tempPassword,
    };
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
 * parent/tutor – sees home school, home class, own students
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
  const parseNameFromDisplay = (value) => {
    const text = String(value || "").trim();
    if (!text) return { firstName: "", lastName: "" };
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      return { firstName: text, lastName: "" };
    }
    return {
      firstName: parts.slice(0, -1).join(" "),
      lastName: parts[parts.length - 1],
    };
  };

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
  } else if (caller.role === "parent" || caller.role === "tutor") {
    const homeSchoolId = String(caller.doc.homeSchoolId || "").trim();
    const homeClassId = String(caller.doc.homeClassId || "").trim();
    const [schoolSnap, classSnap, ownerUserSnap, legacyParentUserSnap] =
      await Promise.all([
        homeSchoolId
          ? db.collection("schools").doc(homeSchoolId).get()
          : Promise.resolve(null),
        homeClassId
          ? db.collection("classes").doc(homeClassId).get()
          : Promise.resolve(null),
        db.collection("users").where("ownerId", "==", caller.uid).get(),
        db.collection("users").where("parentOwnerId", "==", caller.uid).get(),
      ]);
    if (schoolSnap?.exists)
      schools = [{ id: schoolSnap.id, ...schoolSnap.data() }];
    if (classSnap?.exists)
      classes = [{ id: classSnap.id, ...classSnap.data() }];
    const byId = new Map();
    [
      ...mapSnapDocs(ownerUserSnap),
      ...mapSnapDocs(legacyParentUserSnap),
    ].forEach((u) => byId.set(u.id, u));
    users = Array.from(byId.values());
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

  // Build recovery hints so legacy parent/tutor docs with missing name fields
  // can be hydrated from sibling docs that share an email/username signal.
  const nameHintsByEmail = new Map();
  users.forEach((u) => {
    const email = String(u?.email || "")
      .trim()
      .toLowerCase();
    if (!email) return;
    const firstName = String(u?.firstName || "").trim();
    const lastName = String(u?.lastName || "").trim();
    if (!firstName && !lastName) return;
    if (!nameHintsByEmail.has(email)) {
      nameHintsByEmail.set(email, { firstName, lastName });
    }
  });

  // Recover manager role for legacy parent/tutor accounts whose own user doc
  // role can be missing or incorrectly set to student, but who own students.
  const managedRoleByOwnerId = new Map();
  users.forEach((u) => {
    if (normalizeRole(u?.role) !== "student") return;
    const ownerId = String(u?.ownerId || u?.parentOwnerId || "").trim();
    if (!ownerId) return;

    const ownerRole = normalizeRole(u?.ownerRole || "");
    const inferredOwnerRole = ownerRole === "tutor" ? "tutor" : "parent";
    const existing = managedRoleByOwnerId.get(ownerId);
    if (existing === "tutor") return;
    managedRoleByOwnerId.set(ownerId, inferredOwnerRole);
  });

  // Strip sensitive fields before returning.

  // For users whose Firestore doc has no name data at all, fetch the Firebase
  // Auth displayName as a final recovery source.  This covers legacy accounts
  // created before firstName/lastName were written to Firestore on signup.
  const authDisplayNameByUid = new Map();
  {
    const uidsMissingNames = users
      .filter((u) => {
        const fn = String(u?.firstName || "").trim();
        const ln = String(u?.lastName || "").trim();
        const dn = String(u?.displayName || u?.name || "").trim();
        return !fn && !ln && !dn && String(u?.id || "").trim();
      })
      .map((u) => String(u.id).trim());

    if (uidsMissingNames.length > 0) {
      try {
        const authChunks = chunk(uidsMissingNames, 100);
        const authResults = await Promise.all(
          authChunks.map((uids) =>
            admin.auth().getUsers(uids.map((uid) => ({ uid }))),
          ),
        );
        authResults.forEach((result) => {
          result.users.forEach((authUser) => {
            const authDisplayName = String(authUser.displayName || "").trim();
            if (authDisplayName) {
              authDisplayNameByUid.set(authUser.uid, authDisplayName);
            }
          });
        });
      } catch (authLookupErr) {
        console.warn("mgmtListData auth name lookup failed", {
          count: uidsMissingNames.length,
          message: authLookupErr?.message || String(authLookupErr || ""),
        });
      }
    }
  }

  const backfillNamePatches = [];

  const safeUsers = users.map(
    ({
      id,
      role,
      email,
      username,
      name,
      displayName,
      firstName,
      lastName,
      schoolId,
      school,
      classIds,
      educator,
      classroom,
      ownerId,
      homeSchoolId,
      homeClassId,
      parentOwnerId,
      createdAt,
    }) => {
      const userId = String(id || "").trim();
      let normalizedRole = normalizeRole(role);
      if (normalizedRole === "student" && userId) {
        const inferredManagedRole = managedRoleByOwnerId.get(userId);
        if (
          inferredManagedRole === "parent" ||
          inferredManagedRole === "tutor"
        ) {
          normalizedRole = inferredManagedRole;
        }
      }
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

      let resolvedFirstName = String(firstName || "").trim();
      let resolvedLastName = String(lastName || "").trim();

      if (!resolvedFirstName || !resolvedLastName) {
        const emailKey = String(email || "")
          .trim()
          .toLowerCase();
        const hinted = emailKey ? nameHintsByEmail.get(emailKey) : null;
        if (!resolvedFirstName) {
          resolvedFirstName = String(hinted?.firstName || "").trim();
        }
        if (!resolvedLastName) {
          resolvedLastName = String(hinted?.lastName || "").trim();
        }
      }

      if (!resolvedFirstName || !resolvedLastName) {
        const parsed = parseNameFromDisplay(displayName || name);
        if (!resolvedFirstName) {
          resolvedFirstName = String(parsed.firstName || "").trim();
        }
        if (!resolvedLastName) {
          resolvedLastName = String(parsed.lastName || "").trim();
        }
      }

      // Last-resort fallback: use the Firebase Auth displayName for accounts
      // whose Firestore doc never had name fields written (e.g. legacy signups).
      if (!resolvedFirstName || !resolvedLastName) {
        const authDisplayName = userId
          ? authDisplayNameByUid.get(userId)
          : null;
        if (authDisplayName) {
          const parsed = parseNameFromDisplay(authDisplayName);
          if (!resolvedFirstName) {
            resolvedFirstName = String(parsed.firstName || "").trim();
          }
          if (!resolvedLastName) {
            resolvedLastName = String(parsed.lastName || "").trim();
          }
        }
      }

      if (
        (normalizedRole === "parent" || normalizedRole === "tutor") &&
        id &&
        ((resolvedFirstName &&
          resolvedFirstName !== String(firstName || "").trim()) ||
          (resolvedLastName &&
            resolvedLastName !== String(lastName || "").trim()))
      ) {
        backfillNamePatches.push({
          id: String(id).trim(),
          firstName: resolvedFirstName,
          lastName: resolvedLastName,
        });
      }

      return {
        id,
        role: normalizedRole,
        email: String(email || ""),
        username: String(username || id),
        name: String(name || ""),
        displayName: String(displayName || ""),
        firstName: resolvedFirstName,
        lastName: resolvedLastName,
        schoolId: resolvedSchoolId,
        schoolName: resolvedSchoolName,
        classIds: resolvedClassIds,
        educator: String(educator || ""),
        classroom: String(classroom || ""),
        ownerId: String(ownerId || ""),
        homeSchoolId: String(homeSchoolId || ""),
        homeClassId: String(homeClassId || ""),
        parentOwnerId: String(parentOwnerId || ""),
        createdAt: createdAt || null,
      };
    },
  );

  if (backfillNamePatches.length > 0) {
    const writablePatchTargets = backfillNamePatches.filter((patch) => {
      const ref = db.collection("users").doc(patch.id);
      return typeof ref?.set === "function";
    });

    if (writablePatchTargets.length > 0) {
      try {
        const chunks = chunk(writablePatchTargets, 400);
        for (const patchChunk of chunks) {
          const batch = db.batch();
          patchChunk.forEach((patch) => {
            const ref = db.collection("users").doc(patch.id);
            batch.set(
              ref,
              {
                firstName: patch.firstName,
                lastName: patch.lastName,
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            );
          });
          await batch.commit();
        }
      } catch (error) {
        console.warn("mgmtListData name backfill failed", {
          count: writablePatchTargets.length,
          message: error?.message || String(error || ""),
        });
      }
    }
  }

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
