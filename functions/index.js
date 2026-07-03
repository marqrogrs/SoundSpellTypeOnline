const functions = require("firebase-functions/v1");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const {
  getFirestore: getFirestoreService,
  FieldValue,
} = require("firebase-admin/firestore");
const bcrypt = require("bcryptjs");
const fs = require("node:fs");
const path = require("node:path");
const { assertCanResetStudentPassword } = require("./resetPasswordAccess");
const { toStudentRecordKey } = require("./studentKeys");
const {
  generateUsername: generateUsernameFromNames,
} = require("./usernameUtils");
const {
  resolveRequesterRole,
  canRequestSchoolAdminAccess,
  isPendingSchoolAdminRequest,
  canManageSchoolAdminRequests,
  normalizeSchoolAdminRequestListArgs,
  parseSchoolAdminReviewInput,
} = require("./schoolAdminRequestUtils");
const admin = {
  get apps() {
    return getApps();
  },
  initializeApp,
  auth: () => getAuth(),
  database: () => getDatabase(),
  firestore: () => getFirestoreService(),
};
admin.firestore.FieldValue = FieldValue;
const saltRounds = 10;

let _initError = null;
try {
  if (!getApps().length) {
    initializeApp({
      databaseURL: "https://soundspeller-c5e53.firebaseio.com",
    });
  }
} catch (e) {
  _initError = e;
  console.error("admin.initializeApp failed:", e?.message, e?.stack);
}
// Use lazy getters so a failure in one service doesn't crash the whole module
let _db = null;
let _firestore = null;
const getDb = () => {
  if (!_db) _db = getDatabase();
  return _db;
};
const getFirestore = () => {
  if (!_firestore) _firestore = getFirestoreService();
  return _firestore;
};
const getStudentRef = (username) =>
  getDb().ref(`/students/${toStudentRecordKey(username)}`);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (value) =>
  EMAIL_REGEX.test(
    String(value || "")
      .trim()
      .toLowerCase(),
  );

// ─── Username generation ──────────────────────────────────────────────────────

/**
 * Generates a unique username by delegating slug logic to usernameUtils and
 * checking uniqueness against both Realtime DB and Firestore.
 */
async function generateUsername(firstName, lastName) {
  const isTaken = async (name) => {
    const [rtSnap, fsDoc] = await Promise.all([
      getDb().ref(`/students/${name}`).once("value"),
      getFirestore().collection("users").doc(name).get(),
    ]);
    return rtSnap.exists() || fsDoc.exists;
  };
  return generateUsernameFromNames(firstName, lastName, isTaken);
}

const escapeXml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

async function synthesizeWordAudioInternal(data) {
  const word = String((data && data.word) || "").trim();
  const ipa = String((data && data.ipa) || "").trim();

  if (!word) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "word is required.",
    );
  }

  let key = "";
  let region = "";
  let voice = "en-US-JennyNeural";

  try {
    const cfg =
      typeof functions.config === "function" ? functions.config() : null;
    key = (cfg && cfg.azure_tts && cfg.azure_tts.key) || "";
    region = (cfg && cfg.azure_tts && cfg.azure_tts.region) || "";
    voice =
      (cfg && cfg.azure_tts && cfg.azure_tts.voice) || "en-US-JennyNeural";
  } catch (_configError) {
    // functions.config() is unavailable in newer runtimes.
  }

  key = String(key || process.env.AZURE_TTS_KEY || "").trim();
  region = String(region || process.env.AZURE_TTS_REGION || "").trim();
  voice = String(voice || process.env.AZURE_TTS_VOICE || "en-US-JennyNeural");

  if (!key || !region) {
    try {
      const fallbackEndpoint =
        "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=" +
        encodeURIComponent(word);
      const fallbackResponse = await fetch(fallbackEndpoint, {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });
      if (fallbackResponse.ok) {
        const fallbackBuffer = await fallbackResponse.arrayBuffer();
        return {
          available: true,
          mimeType: "audio/mpeg",
          audioBase64: Buffer.from(fallbackBuffer).toString("base64"),
          provider: "google-translate",
        };
      }
    } catch (fallbackError) {
      console.error("Google translate TTS fallback failed", fallbackError);
    }

    return {
      available: false,
      reason: "not-configured",
    };
  }

  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const escapedWord = escapeXml(word);
  const ssml = ipa
    ? `<speak version="1.0" xml:lang="en-US"><voice xml:lang="en-US" name="${escapeXml(voice)}"><phoneme alphabet="ipa" ph="${escapeXml(ipa)}">${escapedWord}</phoneme></voice></speak>`
    : `<speak version="1.0" xml:lang="en-US"><voice xml:lang="en-US" name="${escapeXml(voice)}">${escapedWord}</voice></speak>`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-16khz-64kbitrate-mono-mp3",
      "User-Agent": "sound-spell-type-online-functions",
    },
    body: ssml,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error("synthesizeWordAudio failed", {
      status: response.status,
      bodyText,
    });
    throw new functions.https.HttpsError(
      "internal",
      `TTS provider returned ${response.status}.`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBase64 = Buffer.from(arrayBuffer).toString("base64");

  return {
    available: true,
    mimeType: "audio/mpeg",
    audioBase64,
    provider: "azure",
  };
}

exports.authenticateStudent = functions.https.onCall(async (data, context) => {
  const { username, password } = data || {};
  const requestUser = String(username || "").trim();
  console.log("authenticateStudent request", {
    hasUsername: Boolean(requestUser),
    callerAuthenticated: Boolean(context && context.auth && context.auth.uid),
  });

  return getStudentRef(username)
    .once("value")
    .then((snap) => {
      if (!snap.exists()) {
        return { error: "Student does not exist" };
      }

      const hashed_pass = snap.val().p;
      return bcrypt
        .compare(password, hashed_pass)
        .then((result) => {
          if (!result) {
            return { error: "Invalid password" };
          }
          return getAuth().createCustomToken(requestUser);
        })
        .then((token) => {
          if (typeof token !== "string") {
            return token;
          }
          return { token };
        })
        .catch((error) => {
          console.error("authenticateStudent error:", error);
          return { error };
        });
    });
});

exports.createStudentAccount = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be signed in as an educator to add a student.",
    );
  }

  const { firstName, lastName, password, classroom } = data || {};

  if (!password || !classroom) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "password and classroom are required.",
    );
  }
  if (!String(firstName || "").trim() || !String(lastName || "").trim()) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "First and last name are required.",
    );
  }

  const educator_uid = context.auth.uid;
  try {
    const username = await generateUsername(firstName, lastName);

    const existing = await getStudentRef(username).once("value");
    if (existing.exists()) {
      throw new functions.https.HttpsError(
        "already-exists",
        "A student with that username already exists.",
      );
    }

    const hash = await bcrypt.hash(password, saltRounds);
    await getStudentRef(username).set({ p: hash, educator: educator_uid });

    console.log("Created realtime db entry - creating student user doc");
    await getFirestore()
      .collection("users")
      .doc(username)
      .set({
        username,
        firstName: String(firstName || "").trim(),
        lastName: String(lastName || "").trim(),
        email: null,
        educator: educator_uid,
        ownerId: educator_uid,
        ownerRole: "educator",
        parentOwnerId: educator_uid,
        classroom,
        progress: {},
      });

    console.log("Created student db entry - adding to teacher doc");
    await getFirestore()
      .collection("users")
      .doc(educator_uid)
      .collection("classes")
      .doc(classroom)
      .set(
        {
          students: admin.firestore.FieldValue.arrayUnion(username),
        },
        { merge: true },
      );

    return {
      status: "success",
      userId: username,
    };
  } catch (error) {
    console.error("createStudentAccount error:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
      "internal",
      "Failed to create student account.",
    );
  }
});

exports.resetStudentPassword = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be signed in to reset student passwords.",
    );
  }

  const { username, password } = data || {};
  if (!username || !password) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "username and password are required.",
    );
  }

  try {
    const callerUid = context.auth.uid;
    const callerDoc = await getFirestore()
      .collection("users")
      .doc(callerUid)
      .get();
    const callerData = callerDoc.exists ? callerDoc.data() : null;
    const callerRole = normalizeRole(
      context?.auth?.token?.role || callerData?.role || "student",
    );

    const studentSnap = await getStudentRef(username).once("value");
    const studentExists = studentSnap.exists();
    const studentRecord = studentExists ? studentSnap.val() || {} : null;
    const studentUserSnap = await getFirestore()
      .collection("users")
      .doc(String(username || "").trim())
      .get();
    const studentUserDoc = studentUserSnap.exists
      ? studentUserSnap.data() || {}
      : null;

    assertCanResetStudentPassword({
      callerUid,
      callerRole,
      callerData,
      studentExists,
      studentRecord,
      studentUserDoc,
    });

    const hash = await bcrypt.hash(password, saltRounds);
    await getStudentRef(username).update({ p: hash });
    return { status: "success" };
  } catch (error) {
    console.error("resetStudentPassword error:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    if (error && typeof error.code === "string") {
      throw new functions.https.HttpsError(error.code, error.message || "");
    }
    throw new functions.https.HttpsError(
      "internal",
      "Failed to reset student password.",
    );
  }
});

exports.synthesizeWordAudio = functions.https.onCall(async (data) => {
  try {
    return await synthesizeWordAudioInternal(data);
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error("synthesizeWordAudio error", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to synthesize audio.",
    );
  }
});

exports.synthesizeWordAudioHttp = functions.https.onRequest(
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "method-not-allowed" });
      return;
    }

    try {
      const result = await synthesizeWordAudioInternal(req.body || {});
      res.status(200).json(result);
    } catch (error) {
      const code = error?.code || "internal";
      const message = error?.message || "Failed to synthesize audio.";
      res.status(500).json({ available: false, error: code, message });
    }
  },
);

async function resolvePlacementStudentContext(studentId) {
  const normalizedStudentId = String(studentId || "").trim();
  if (!normalizedStudentId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "studentId is required.",
    );
  }

  const studentDocRef = getFirestore()
    .collection("users")
    .doc(normalizedStudentId);
  const studentDocSnap = await studentDocRef.get();
  if (!studentDocSnap.exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "Student user document was not found.",
    );
  }

  const studentDoc = studentDocSnap.data() || {};
  const normalizedRole = normalizeRole(studentDoc.role || "student", "student");
  if (normalizedRole !== "student") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Target user is not a student.",
    );
  }

  let authRecord = null;
  try {
    authRecord = await admin.auth().getUser(normalizedStudentId);
  } catch (_error) {
    authRecord = null;
  }

  return {
    studentId: normalizedStudentId,
    docRef: studentDocRef,
    doc: studentDoc,
    authRecord,
  };
}

function canCallerManagePlacementStudent(caller, studentContext) {
  const callerUid = String(caller?.uid || "").trim();
  const callerRole = String(caller?.role || "student").trim();
  const studentDoc = studentContext?.doc || {};

  if (!callerUid) return false;
  if (callerRole === "admin") return true;

  const ownerId = String(
    studentDoc.ownerId || studentDoc.parentOwnerId || "",
  ).trim();
  const educatorId = String(studentDoc.educator || "").trim();
  const studentSchoolId = String(studentDoc.schoolId || "").trim();
  const callerSchoolId = String(caller?.doc?.schoolId || "").trim();

  if (callerRole === "parent" || callerRole === "tutor") {
    return ownerId === callerUid;
  }

  if (callerRole === "educator") {
    return educatorId === callerUid || ownerId === callerUid;
  }

  if (callerRole === "schoolAdmin") {
    if (
      callerSchoolId &&
      studentSchoolId &&
      callerSchoolId === studentSchoolId
    ) {
      return true;
    }
    return educatorId === callerUid || ownerId === callerUid;
  }

  return false;
}

async function resolvePlacementTarget({ caller, requestedStudentId }) {
  const hasRequestedTarget = Boolean(String(requestedStudentId || "").trim());
  const targetStudentId = hasRequestedTarget
    ? String(requestedStudentId || "").trim()
    : String(caller.uid || "").trim();

  const studentContext = await resolvePlacementStudentContext(targetStudentId);
  const isSelf = String(caller.uid || "").trim() === targetStudentId;

  if (!isSelf && !canCallerManagePlacementStudent(caller, studentContext)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "You cannot manage placement data for this student.",
    );
  }

  return {
    targetStudentId,
    studentContext,
    isSelf,
  };
}

exports.assignPlacementTest = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAccess(context);
  const callerRole = String(caller.role || "student");
  if (
    callerRole !== "admin" &&
    callerRole !== "schoolAdmin" &&
    callerRole !== "educator" &&
    callerRole !== "parent" &&
    callerRole !== "tutor"
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only managers can assign placement tests.",
    );
  }

  const { targetStudentId, studentContext } = await resolvePlacementTarget({
    caller,
    requestedStudentId: data?.studentId,
  });

  const assignmentRef = getFirestore()
    .collection("placementAssignments")
    .doc(targetStudentId);

  await assignmentRef.set(
    {
      studentId: targetStudentId,
      studentName: String(
        studentContext?.doc?.name ||
          studentContext?.doc?.displayName ||
          studentContext?.doc?.username ||
          targetStudentId,
      ).trim(),
      assignedByUid: String(caller.uid || "").trim(),
      assignedByRole: callerRole,
      assignedByEmail: String(caller.email || "")
        .trim()
        .toLowerCase(),
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      active: true,
    },
    { merge: true },
  );

  return {
    assigned: true,
    studentId: targetStudentId,
  };
});

exports.getPlacementAssignmentStatus = functions.https.onCall(
  async (data, context) => {
    const caller = await getCallerAccess(context);
    const { targetStudentId } = await resolvePlacementTarget({
      caller,
      requestedStudentId: data?.studentId,
    });

    const assignmentSnap = await getFirestore()
      .collection("placementAssignments")
      .doc(targetStudentId)
      .get();

    if (!assignmentSnap.exists) {
      return {
        assigned: false,
        studentId: targetStudentId,
      };
    }

    const assignment = assignmentSnap.data() || {};
    return {
      assigned: Boolean(assignment.active !== false),
      studentId: targetStudentId,
      assignment: {
        studentName: String(assignment.studentName || "").trim(),
        assignedByUid: String(assignment.assignedByUid || "").trim(),
        assignedByRole: String(assignment.assignedByRole || "").trim(),
        assignedByEmail: String(assignment.assignedByEmail || "").trim(),
        active: assignment.active !== false,
      },
    };
  },
);

exports.getPlacementReport = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAccess(context);
  const { targetStudentId } = await resolvePlacementTarget({
    caller,
    requestedStudentId: data?.studentId,
  });

  const reportSnap = await getFirestore()
    .collection("placementReports")
    .doc(targetStudentId)
    .get();

  if (!reportSnap.exists) {
    return {
      found: false,
      studentId: targetStudentId,
    };
  }

  const raw = reportSnap.data() || {};
  return {
    found: true,
    studentId: targetStudentId,
    attemptId: String(raw.attemptId || ""),
    report: sanitizePlacementReport(raw.report || {}),
    updatedAt: raw.updatedAt || null,
    emailedAt: raw.emailedAt || null,
  };
});

exports.getPlacementWordOverrides = functions.https.onCall(async (data) => {
  const normalizeWordKey = (value) =>
    String(value || "")
      .trim()
      .toUpperCase();

  const requestedWords = Array.isArray(data?.words) ? data.words : [];
  const normalizedWords = Array.from(
    new Set(
      requestedWords
        .map((word) => normalizeWordKey(word))
        .filter((word) => /^[A-Z]+$/.test(word)),
    ),
  );

  if (!normalizedWords.length) {
    return { overrides: {} };
  }

  if (normalizedWords.length > 500) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Too many words requested.",
    );
  }

  const docs = await Promise.all(
    normalizedWords.map((wordKey) =>
      getFirestore().collection("words").doc(wordKey).get(),
    ),
  );

  const overrides = {};
  docs.forEach((doc) => {
    if (!doc.exists) {
      return;
    }

    const payload = doc.data() || {};
    const graphemes = Array.isArray(payload.graphemes)
      ? payload.graphemes
      : null;
    const phonemes = Array.isArray(payload.phonemes) ? payload.phonemes : null;

    if (!graphemes && !phonemes) {
      return;
    }

    overrides[
      String(doc.id || "")
        .trim()
        .toUpperCase()
    ] = {
      graphemes,
      phonemes,
    };
  });

  return {
    overrides,
  };
});

exports.submitPublicPlacementReport = functions.https.onCall(async (data) => {
  const studentFirstName = String(data?.studentFirstName || "").trim();
  const proctorFirstName = String(data?.proctorFirstName || "").trim();
  const proctorLastName = String(data?.proctorLastName || "").trim();
  const proctorEmail = String(data?.proctorEmail || "")
    .trim()
    .toLowerCase();

  if (
    !studentFirstName ||
    !proctorFirstName ||
    !proctorLastName ||
    !proctorEmail
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "studentFirstName, proctorFirstName, proctorLastName, and proctorEmail are required.",
    );
  }

  if (!isValidEmail(proctorEmail)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "A valid proctor email is required.",
    );
  }

  const safeReport = sanitizePlacementReport(data?.report || {});
  const docRef = getFirestore().collection("placementPublicReports").doc();
  const reportId = docRef.id;

  await docRef.set({
    reportId,
    studentFirstName,
    proctorFirstName,
    proctorLastName,
    proctorEmail,
    report: safeReport,
    status: "new",
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    notifiedAdminAt: null,
  });

  const cfg = functions.config();
  const alertCfg = (cfg && cfg.placement_alert) || {};
  const configuredEmails = String(
    alertCfg.admin_emails || alertCfg.admin_email || "",
  )
    .split(",")
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  const notifyEmails = Array.from(new Set(configuredEmails));

  let emailQueued = false;
  if (notifyEmails.length > 0) {
    const reportLink = `/placement-reports?report=${encodeURIComponent(reportId)}`;
    const subject = "New Public Placement Test Report";
    const text = [
      "A new public placement test report was submitted.",
      `Student first name: ${studentFirstName}`,
      `Proctor: ${proctorFirstName} ${proctorLastName}`,
      `Proctor email: ${proctorEmail}`,
      `Report ID: ${reportId}`,
      `Report link: ${reportLink}`,
    ].join("\n");
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">
        <h2>New Public Placement Test Report</h2>
        <p><strong>Student first name:</strong> ${escapeHtml(studentFirstName)}</p>
        <p><strong>Proctor:</strong> ${escapeHtml(proctorFirstName)} ${escapeHtml(
          proctorLastName,
        )}</p>
        <p><strong>Proctor email:</strong> ${escapeHtml(proctorEmail)}</p>
        <p><strong>Report ID:</strong> ${escapeHtml(reportId)}</p>
        <p><strong>Report link:</strong> ${escapeHtml(reportLink)}</p>
      </div>
    `;

    await queueEmailNotification({
      to: notifyEmails,
      subject,
      text,
      html,
    });

    await docRef.set(
      {
        notifiedAdminAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    emailQueued = true;
  }

  return {
    saved: true,
    reportId,
    emailQueued,
  };
});

exports.getPlacementAdminAlerts = functions.https.onCall(
  async (_data, context) => {
    const caller = await getCallerAccess(context);
    if (String(caller.role || "") !== "admin") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only admins can view placement admin alerts.",
      );
    }

    const snap = await getFirestore()
      .collection("placementPublicReports")
      .where("status", "==", "new")
      .limit(50)
      .get();

    const items = snap.docs
      .map((doc) => {
        const row = doc.data() || {};
        return {
          id: doc.id,
          studentFirstName: String(row.studentFirstName || "").trim(),
          proctorFirstName: String(row.proctorFirstName || "").trim(),
          proctorLastName: String(row.proctorLastName || "").trim(),
          proctorEmail: String(row.proctorEmail || "")
            .trim()
            .toLowerCase(),
          recommendedStartPart:
            Number(row?.report?.recommendedStartPart || 0) || null,
          submittedAt: row.submittedAt || null,
        };
      })
      .sort((a, b) => {
        const aMs = a.submittedAt?.toMillis ? a.submittedAt.toMillis() : 0;
        const bMs = b.submittedAt?.toMillis ? b.submittedAt.toMillis() : 0;
        return bMs - aMs;
      })
      .slice(0, 25);

    return {
      newCount: items.length,
      items,
    };
  },
);

exports.listPlacementPublicReports = functions.https.onCall(
  async (data, context) => {
    const caller = await getCallerAccess(context);
    if (String(caller.role || "") !== "admin") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only admins can list public placement reports.",
      );
    }

    const status = String(data?.status || "all")
      .trim()
      .toLowerCase();
    const limitRaw = Number(data?.limit || 50);
    const limit = Math.max(
      1,
      Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 50),
    );

    let query = getFirestore().collection("placementPublicReports");
    if (status === "new" || status === "reviewed") {
      query = query.where("status", "==", status);
    }

    const fetchLimit = Math.max(limit, 200);
    const snap =
      status === "all"
        ? await query.orderBy("submittedAt", "desc").limit(limit).get()
        : await query.limit(fetchLimit).get();
    const rows = snap.docs
      .map((doc) => {
        const row = doc.data() || {};
        return {
          id: doc.id,
          status: String(row.status || "new"),
          studentFirstName: String(row.studentFirstName || "").trim(),
          proctorFirstName: String(row.proctorFirstName || "").trim(),
          proctorLastName: String(row.proctorLastName || "").trim(),
          proctorEmail: String(row.proctorEmail || "")
            .trim()
            .toLowerCase(),
          recommendedStartPart:
            Number(row?.report?.recommendedStartPart || 0) || null,
          stoppedAtPartNumber:
            Number(row?.report?.stoppedAtPartNumber || 0) || null,
          submittedAt: row.submittedAt || null,
          reviewedAt: row.reviewedAt || null,
        };
      })
      .sort((a, b) => {
        const aMs = a.submittedAt?.toMillis ? a.submittedAt.toMillis() : 0;
        const bMs = b.submittedAt?.toMillis ? b.submittedAt.toMillis() : 0;
        return bMs - aMs;
      })
      .slice(0, limit);

    return { rows };
  },
);

exports.getPlacementPublicReport = functions.https.onCall(
  async (data, context) => {
    const caller = await getCallerAccess(context);
    if (String(caller.role || "") !== "admin") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only admins can read public placement reports.",
      );
    }

    const reportId = String(data?.reportId || "").trim();
    if (!reportId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "reportId is required.",
      );
    }

    const snap = await getFirestore()
      .collection("placementPublicReports")
      .doc(reportId)
      .get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Report not found.");
    }

    const row = snap.data() || {};
    return {
      id: snap.id,
      status: String(row.status || "new"),
      studentFirstName: String(row.studentFirstName || "").trim(),
      proctorFirstName: String(row.proctorFirstName || "").trim(),
      proctorLastName: String(row.proctorLastName || "").trim(),
      proctorEmail: String(row.proctorEmail || "")
        .trim()
        .toLowerCase(),
      submittedAt: row.submittedAt || null,
      reviewedAt: row.reviewedAt || null,
      report: sanitizePlacementReport(row.report || {}),
    };
  },
);

exports.markPlacementPublicReportReviewed = functions.https.onCall(
  async (data, context) => {
    const caller = await getCallerAccess(context);
    if (String(caller.role || "") !== "admin") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only admins can review public placement reports.",
      );
    }

    const reportId = String(data?.reportId || "").trim();
    if (!reportId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "reportId is required.",
      );
    }

    await getFirestore()
      .collection("placementPublicReports")
      .doc(reportId)
      .set(
        {
          status: "reviewed",
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedByUid: String(caller.uid || "").trim(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    return {
      reviewed: true,
      reportId,
    };
  },
);

exports.upsertPlacementReport = functions.https.onCall(
  async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in to save a placement report.",
      );
    }

    const attemptId = String(data?.attemptId || "").trim();
    if (!attemptId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "attemptId is required.",
      );
    }

    const caller = await getCallerAccess(context);
    const safeReport = sanitizePlacementReport(data?.report || {});
    const { targetStudentId, studentContext, isSelf } =
      await resolvePlacementTarget({
        caller,
        requestedStudentId: data?.studentId,
      });

    const callerTokenEmailVerified =
      context?.auth?.token?.email_verified !== false;
    const targetEmail = String(
      studentContext?.authRecord?.email || studentContext?.doc?.email || "",
    )
      .trim()
      .toLowerCase();
    const emailVerified = isSelf
      ? callerTokenEmailVerified
      : Boolean(studentContext?.authRecord?.emailVerified);

    const docRef = getFirestore()
      .collection("placementReports")
      .doc(targetStudentId);
    const existing = await docRef.get();
    const existingData = existing.exists ? existing.data() || {} : {};
    const alreadyEmailedAttempt =
      String(existingData.lastEmailedAttemptId || "") === attemptId;

    await docRef.set(
      {
        uid: targetStudentId,
        email: targetEmail,
        emailVerified,
        attemptId,
        report: safeReport,
        updatedByUid: String(caller.uid || "").trim(),
        updatedByRole: String(caller.role || "student").trim(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt:
          existingData.createdAt ||
          admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    let emailed = false;
    if (emailVerified && targetEmail && !alreadyEmailedAttempt) {
      const content = buildPlacementReportEmailContent({
        report: safeReport,
        recipientLabel: targetEmail,
      });
      await queueEmailNotification({
        to: targetEmail,
        subject: "Your Sound Spell Type Online Placement Report",
        text: content.text,
        html: content.html,
      });

      await docRef.set(
        {
          lastEmailedAttemptId: attemptId,
          emailedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      emailed = true;
    }

    return {
      saved: true,
      emailed,
      needsVerification: !emailVerified,
      attemptId,
      studentId: targetStudentId,
    };
  },
);

exports.applyWordFix = functions.https.onCall(async (data, context) => {
  try {
    if (_initError) {
      throw new functions.https.HttpsError(
        "internal",
        "Module init failed: " + (_initError?.message || String(_initError)),
        {
          errorMessage: _initError?.message || String(_initError),
          stage: "init",
        },
      );
    }

    console.log("applyWordFix step:start", {
      authenticated: Boolean(context && context.auth && context.auth.uid),
      hasData: Boolean(data),
      word: String((data && data.word) || ""),
    });

    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in as an educator to patch words.",
      );
    }

    const callerUid = context.auth.uid;
    const tokenEmail = String(context?.auth?.token?.email || "").trim();
    const tokenEmailVerified = context?.auth?.token?.email_verified;

    let callerData = null;
    try {
      console.log("applyWordFix step:lookupUser", { callerUid });
      const callerDoc = await getFirestore()
        .collection("users")
        .doc(callerUid)
        .get();
      callerData = callerDoc.exists ? callerDoc.data() : null;
      console.log("applyWordFix step:userLoaded", {
        docExists: callerDoc.exists,
        hasDocEmail: Boolean(callerData && callerData.email),
      });
    } catch (lookupError) {
      // Keep callable usable even if the users doc is missing or temporarily unreadable.
      console.error("applyWordFix step:userLookupError", {
        message: lookupError?.message || String(lookupError),
      });
    }

    const hasDocEmail = Boolean(callerData && callerData.email);
    const hasTokenEmail = Boolean(tokenEmail);
    const isTokenVerified = tokenEmailVerified !== false;
    const isEducator = hasDocEmail || (hasTokenEmail && isTokenVerified);

    if (!isEducator) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only educator accounts can patch words.",
      );
    }

    const normalizeList = (value, separators) => {
      if (Array.isArray(value)) {
        return value.map((item) => String(item || "").trim()).filter(Boolean);
      }

      const raw = String(value || "").trim();
      if (!raw) {
        return [];
      }

      return raw
        .split(separators)
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    };

    const word = String((data && data.word) || "")
      .trim()
      .toUpperCase();
    const graphemes = normalizeList(data && data.graphemes, /[,\n]+/).map((g) =>
      g.toUpperCase(),
    );
    const phonemes = normalizeList(data && data.phonemes, /[\s,\n]+/).map((p) =>
      p.toUpperCase(),
    );
    const syllables = normalizeList(data && data.syllables, /[.\s,\n]+/).map(
      (s) => s.toLowerCase(),
    );

    if (!word) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "word is required.",
      );
    }

    if (!graphemes.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "At least one grapheme is required.",
      );
    }

    if (!phonemes.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "At least one phoneme is required.",
      );
    }

    console.log("applyWordFix step:firestoreWrite", {
      word,
      graphemes,
      phonemes,
    });
    const wordDocRef = getFirestore().collection("words").doc(word);
    const existingWordDoc = await wordDocRef.get();
    const existingWordData = existingWordDoc.exists
      ? existingWordDoc.data()
      : {};
    const nextSyllables = syllables.length
      ? syllables
      : Array.isArray(existingWordData?.syllables)
        ? existingWordData.syllables
        : [word.toLowerCase()];

    await wordDocRef.set(
      {
        word,
        graphemes,
        phonemes,
        syllables: nextSyllables,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: callerUid,
      },
      { merge: true },
    );
    console.log("applyWordFix step:firestoreWriteDone");

    const lexiconPathCandidates = [
      path.resolve(__dirname, "..", "data", "SoundSpellerDatabase.json"),
      path.resolve(__dirname, "data", "SoundSpellerDatabase.json"),
    ];
    const lexiconPath = lexiconPathCandidates.find((candidate) =>
      fs.existsSync(candidate),
    );
    const runningInCloudRuntime = Boolean(process.env.K_SERVICE);

    let lexiconUpdated = false;
    let lexiconFound = false;
    let lexiconError = null;
    let lexiconStatus = "not_attempted";
    try {
      if (!lexiconPath) {
        lexiconStatus = runningInCloudRuntime
          ? "skipped_cloud_runtime"
          : "json_file_not_found";
      } else {
        const raw = await fs.promises.readFile(lexiconPath, "utf8");
        const parsed = JSON.parse(raw);
        const lexicon = Array.isArray(parsed?.ssLexicon)
          ? parsed.ssLexicon
          : null;

        if (!lexicon) {
          throw new Error(
            "Missing ssLexicon array in SoundSpellerDatabase.json",
          );
        }

        const row = lexicon.find(
          (entry) =>
            String(entry?.word || "")
              .trim()
              .toUpperCase() === word,
        );

        if (row) {
          lexiconFound = true;
          row.grap = graphemes.join(",");
          row.phon = phonemes.join(" ");
          row.syll = nextSyllables.join(".");
          await fs.promises.writeFile(
            lexiconPath,
            JSON.stringify(parsed, null, 2),
          );
          lexiconUpdated = true;
          lexiconStatus = "updated";
        } else {
          lexiconStatus = "row_not_found";
        }
      }
    } catch (error) {
      lexiconStatus = "error";
      lexiconError = error?.message || String(error);
      console.error("applyWordFix JSON update error", {
        message: lexiconError,
      });
    }

    console.log("applyWordFix step:done", {
      lexiconFound,
      lexiconUpdated,
      lexiconError,
      lexiconStatus,
    });
    return {
      status: "success",
      word,
      firestoreUpdated: true,
      lexiconFound,
      lexiconUpdated,
      lexiconError,
      lexiconStatus,
      graphemes,
      phonemes,
      syllables: nextSyllables,
    };
  } catch (error) {
    console.error("applyWordFix step:error", {
      message: error?.message || String(error),
      code: error?.code,
      stack: error?.stack,
    });
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
      "internal",
      "An unexpected error occurred while patching the word.",
      { errorMessage: error?.message || String(error), errorCode: error?.code },
    );
  }
});

const ROLE_RANK = {
  student: 0,
  parent: 1,
  tutor: 1,
  educator: 2,
  schoolAdmin: 3,
  admin: 4,
};

const RESET_EMAIL_API_KEY = "AIzaSyBC9FNI_d_Lse9Kw1u_1jbWUvqcHShHXZQ";

function normalizeRole(input) {
  const value = String(input || "").trim();
  const v = value.toLowerCase().replace(/\s+/g, "");
  if (v === "admin") return "admin";
  if (v === "schooladmin" || value === "schoolAdmin") return "schoolAdmin";
  if (v === "educator" || v === "teacher") return "educator";
  if (
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
  return "student";
}

function deriveRoleFromClaims(claims, fallbackEmail = "") {
  void fallbackEmail;
  const roleFromClaim = normalizeRole(claims?.role);
  if (claims?.admin) return "admin";
  if (claims?.schoolAdmin) return "schoolAdmin";
  if (claims?.parent) return "parent";
  if (claims?.tutor) return "tutor";
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
    docRole === "educator" ||
    docRole === "parent" ||
    docRole === "tutor" ||
    docRole === "student"
  ) {
    return docRole;
  }
  return claimsRole || docRole || "student";
}

function isParentRole(role) {
  return role === "parent" || role === "tutor";
}

function ensureAuthenticated(context) {
  if (!context?.auth?.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be signed in.",
    );
  }
  return context.auth.uid;
}

async function inferManagedRoleFromOwnedStudents(uid) {
  const db = getFirestore();
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

    const homeClassDoc = homeClassSnap.docs[0];
    const homeClass = homeClassDoc.data() || {};
    const className = String(
      homeClass.normalizedName || homeClass.name || "",
    ).toLowerCase();
    const inferredRole = className.includes("tutor") ? "tutor" : "parent";

    return {
      role: inferredRole,
      docPatch: {
        role: inferredRole,
        homeSchoolId: String(homeClass.schoolId || "").trim(),
        homeClassId: String(homeClassDoc.id || "").trim(),
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
  const classSnap = await getFirestore()
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
      classIds: [String(classDoc.id || "").trim()].filter(Boolean),
    },
  };
}

async function getCallerAccess(context) {
  const callerUid = ensureAuthenticated(context);
  const callerRecord = await admin.auth().getUser(callerUid);
  const claimsRole = deriveRoleFromClaims(
    callerRecord.customClaims || {},
    callerRecord.email || "",
  );
  let callerDoc = {};
  try {
    let callerDocSnap = await getFirestore()
      .collection("users")
      .doc(callerUid)
      .get();

    if (!callerDocSnap.exists) {
      const normalizedEmail = String(callerRecord.email || "")
        .trim()
        .toLowerCase();
      if (normalizedEmail) {
        const emailLocalPart = normalizedEmail.split("@")[0] || "";
        const [
          emailDocSnap,
          emailQuerySnap,
          usernameEmailSnap,
          usernameLocalSnap,
        ] = await Promise.all([
          getFirestore().collection("users").doc(normalizedEmail).get(),
          getFirestore()
            .collection("users")
            .where("email", "==", normalizedEmail)
            .limit(1)
            .get(),
          getFirestore()
            .collection("users")
            .where("username", "==", normalizedEmail)
            .limit(1)
            .get(),
          emailLocalPart
            ? getFirestore()
                .collection("users")
                .where("username", "==", emailLocalPart)
                .limit(1)
                .get()
            : Promise.resolve({ empty: true, docs: [] }),
        ]);
        if (emailDocSnap.exists) {
          callerDocSnap = emailDocSnap;
        } else if (!emailQuerySnap.empty) {
          callerDocSnap = emailQuerySnap.docs[0];
        } else if (!usernameEmailSnap.empty) {
          callerDocSnap = usernameEmailSnap.docs[0];
        } else if (!usernameLocalSnap.empty) {
          callerDocSnap = usernameLocalSnap.docs[0];
        }
      }
    }

    callerDoc = callerDocSnap.exists ? callerDocSnap.data() || {} : {};
  } catch (_err) {
    callerDoc = {};
  }

  if (!String(callerDoc?.role || "").trim()) {
    try {
      const inferred = await inferManagedRoleFromOwnedStudents(callerUid);
      if (inferred?.role) {
        callerDoc = {
          ...callerDoc,
          ...(inferred.docPatch || {}),
        };
      } else {
        const inferredEducator =
          await inferEducatorRoleFromAssignedClasses(callerUid);
        if (inferredEducator?.role) {
          callerDoc = {
            ...callerDoc,
            ...(inferredEducator.docPatch || {}),
          };
        }
      }
    } catch (_err) {
      // Keep best-effort callerDoc from direct lookup.
    }
  }

  const docRole = normalizeRole(callerDoc?.role || "");
  let callerRole = pickEffectiveRole(
    claimsRole,
    callerDoc?.role ? docRole : null,
  );

  // Legacy safety: authenticated email users without explicit role metadata
  // should default to managed parent scope, not student scope.
  if (
    callerRole === "student" &&
    String(callerRecord.email || "").trim().length > 0
  ) {
    callerRole = "parent";
    if (!String(callerDoc?.role || "").trim()) {
      callerDoc = { ...callerDoc, role: "parent" };
    }
  }

  return {
    uid: callerUid,
    role: callerRole,
    email: String(callerRecord.email || "").toLowerCase(),
    doc: callerDoc,
  };
}

function requireAtLeastRole(caller, minRole) {
  const callerRank = ROLE_RANK[caller.role] || 0;
  const requiredRank = ROLE_RANK[minRole] || 0;
  if (callerRank < requiredRank) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Insufficient permissions.",
    );
  }
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

async function sendResetEmailInvite(email) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${RESET_EMAIL_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
      }),
    },
  );

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new functions.https.HttpsError(
      "internal",
      `Failed to send reset email invite (${response.status}). ${bodyText}`,
    );
  }
}

async function queueEmailNotification({ to, subject, text, html }) {
  const recipients = Array.isArray(to)
    ? to
        .map((v) =>
          String(v || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean)
    : [
        String(to || "")
          .trim()
          .toLowerCase(),
      ].filter(Boolean);

  if (!recipients.length) return { queued: false, reason: "no-recipients" };

  // Uses Firebase "Trigger Email" extension convention (collection: mail).
  // If the extension is not installed, this write is harmless and provides an
  // audit trail for what would have been sent.
  await getFirestore()
    .collection("mail")
    .add({
      to: recipients,
      message: {
        subject: String(subject || "Notification"),
        text: String(text || ""),
        html: String(html || text || ""),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "functions/index.js",
    });

  return { queued: true };
}

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const toFiniteNumberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function sanitizePlacementReport(rawReport) {
  const report = rawReport && typeof rawReport === "object" ? rawReport : {};
  const partResults = Array.isArray(report.partResults)
    ? report.partResults.map((part) => {
        const words = Array.isArray(part?.words)
          ? part.words.map((wordResult) => ({
              word: String(wordResult?.word || "").trim(),
              typed: String(wordResult?.typed || "").trim(),
              isCorrect: Boolean(wordResult?.isCorrect),
              correctSpelling: String(wordResult?.correctSpelling || "").trim(),
              alternatives: Array.isArray(wordResult?.alternatives)
                ? wordResult.alternatives
                    .map((alt) => String(alt || "").trim())
                    .filter(Boolean)
                : [],
            }))
          : [];

        return {
          partNumber: toFiniteNumberOrNull(part?.partNumber),
          partTitle: String(part?.partTitle || "").trim(),
          wrongCount: toFiniteNumberOrNull(part?.wrongCount) || 0,
          outcome: {
            code: String(part?.outcome?.code || "").trim(),
            note: String(part?.outcome?.note || "").trim(),
          },
          words,
        };
      })
    : [];

  return {
    version: toFiniteNumberOrNull(report.version) || 1,
    generatedAt: String(report.generatedAt || new Date().toISOString()),
    recommendedStartPart:
      toFiniteNumberOrNull(report.recommendedStartPart) || 1,
    stoppedAtPartNumber: toFiniteNumberOrNull(report.stoppedAtPartNumber),
    retakeWarning: String(report.retakeWarning || "").trim(),
    partResults,
  };
}

function buildPlacementReportEmailContent({ report, recipientLabel = "" }) {
  const safeRecipient = escapeHtml(recipientLabel || "Student");
  const recommended = escapeHtml(report.recommendedStartPart);
  const stoppedAt = report.stoppedAtPartNumber
    ? `<p><strong>Assessment stopped at Part ${escapeHtml(
        report.stoppedAtPartNumber,
      )}.</strong></p>`
    : "";

  const partRows = (Array.isArray(report.partResults) ? report.partResults : [])
    .map((part) => {
      const words = (Array.isArray(part.words) ? part.words : [])
        .map((w) => {
          const status = w.isCorrect ? "Correct" : "Incorrect";
          const typed = escapeHtml(w.typed || "(blank)");
          const correct = escapeHtml(w.correctSpelling || "");
          const alternatives =
            Array.isArray(w.alternatives) && w.alternatives.length
              ? ` (alternatives: ${escapeHtml(w.alternatives.join(", "))})`
              : "";
          const correction = w.isCorrect
            ? ""
            : ` - typed: <strong>${typed}</strong>; correct: <strong>${correct}</strong>${alternatives}`;
          return `<li>${escapeHtml(w.word)}: ${status}${correction}</li>`;
        })
        .join("");

      return `
        <section style="margin:12px 0;padding:12px;border:1px solid #ddd;border-radius:8px;">
          <h3 style="margin:0 0 6px 0;">Part ${escapeHtml(part.partNumber)}: ${escapeHtml(
            part.partTitle,
          )}</h3>
          <p style="margin:0 0 6px 0;"><strong>Wrong answers:</strong> ${escapeHtml(
            part.wrongCount,
          )}</p>
          <p style="margin:0 0 6px 0;">${escapeHtml(part?.outcome?.note || "")}</p>
          <ul style="margin:0;padding-left:18px;">${words}</ul>
        </section>
      `;
    })
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">
      <h2>Sound Spell Type Online Placement Report</h2>
      <p>Hello ${safeRecipient},</p>
      <p><strong>Recommended starting part:</strong> Part ${recommended}</p>
      ${stoppedAt}
      ${report.retakeWarning ? `<p>${escapeHtml(report.retakeWarning)}</p>` : ""}
      ${partRows}
    </div>
  `;

  const textLines = [];
  textLines.push("Sound Spell Type Online Placement Report");
  textLines.push(
    `Recommended starting part: Part ${report.recommendedStartPart}`,
  );
  if (report.stoppedAtPartNumber) {
    textLines.push(`Assessment stopped at Part ${report.stoppedAtPartNumber}.`);
  }
  if (report.retakeWarning) {
    textLines.push(report.retakeWarning);
  }

  (Array.isArray(report.partResults) ? report.partResults : []).forEach(
    (part) => {
      textLines.push("");
      textLines.push(`Part ${part.partNumber}: ${part.partTitle}`);
      textLines.push(`Wrong answers: ${part.wrongCount}`);
      if (part?.outcome?.note) {
        textLines.push(part.outcome.note);
      }
      (Array.isArray(part.words) ? part.words : []).forEach((w) => {
        if (w.isCorrect) {
          textLines.push(`- ${w.word}: Correct`);
        } else {
          textLines.push(
            `- ${w.word}: Incorrect (typed: ${w.typed || "(blank)"}; correct: ${
              w.correctSpelling
            })`,
          );
        }
      });
    },
  );

  return {
    html,
    text: textLines.join("\n"),
  };
}

async function countTopAdmins() {
  let nextPageToken;
  let count = 0;
  do {
    const page = await admin.auth().listUsers(1000, nextPageToken);
    for (const user of page.users) {
      if (Boolean(user.customClaims && user.customClaims.admin)) {
        count += 1;
      }
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return count;
}

async function writeAdminAuditLog({
  actorUid,
  actorRole,
  action,
  targetUserId,
  status,
  before,
  after,
  reason,
}) {
  try {
    await getFirestore()
      .collection("adminAuditLogs")
      .add({
        actorUid,
        actorRole,
        action,
        targetUserId,
        status,
        reason: reason || null,
        before: before || null,
        after: after || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (error) {
    console.error("Failed to write admin audit log", error);
  }
}

function chunk(array, size) {
  const output = [];
  for (let i = 0; i < array.length; i += size) {
    output.push(array.slice(i, i + size));
  }
  return output;
}

async function getAuthUsersByUid(uids) {
  const output = new Map();
  const uidBatches = chunk(Array.from(new Set(uids)).filter(Boolean), 100);
  for (const batch of uidBatches) {
    if (!batch.length) continue;
    const result = await admin.auth().getUsers(batch.map((uid) => ({ uid })));
    for (const userRecord of result.users) {
      output.set(userRecord.uid, userRecord);
    }
  }
  return output;
}

async function moveStudentClassMembership({
  username,
  previousEducator,
  previousClassroom,
  nextEducator,
  nextClassroom,
}) {
  const previousEducatorId = String(previousEducator || "").trim();
  const previousClassId = String(previousClassroom || "").trim();
  const nextEducatorId = String(nextEducator || "").trim();
  const nextClassId = String(nextClassroom || "").trim();

  if (previousEducatorId && previousClassId) {
    await getFirestore()
      .collection("users")
      .doc(previousEducatorId)
      .collection("classes")
      .doc(previousClassId)
      .set(
        {
          students: admin.firestore.FieldValue.arrayRemove(username),
        },
        { merge: true },
      );
  }
  if (nextEducatorId && nextClassId) {
    await getFirestore()
      .collection("users")
      .doc(nextEducatorId)
      .collection("classes")
      .doc(nextClassId)
      .set(
        {
          students: admin.firestore.FieldValue.arrayUnion(username),
        },
        { merge: true },
      );
  }
}

async function deleteQueryDocs(query, handleDoc) {
  const snap = await query.get();
  for (const doc of snap.docs) {
    await handleDoc(doc);
  }
  return snap.docs.length;
}

async function removeStudentFromClassDocs(userId) {
  const classesSnap = await getFirestore()
    .collection("classes")
    .where("studentIds", "array-contains", userId)
    .get();

  for (const doc of classesSnap.docs) {
    await doc.ref.set(
      {
        studentIds: admin.firestore.FieldValue.arrayRemove(userId),
      },
      { merge: true },
    );
  }
}

async function removeStudentFromCustomLessons(userId) {
  const lessonsSnap = await getFirestore()
    .collection("customLessons")
    .where("assignedStudentIds", "array-contains", userId)
    .get();

  for (const doc of lessonsSnap.docs) {
    const assignedStudentIds = Array.isArray(doc.data()?.assignedStudentIds)
      ? doc.data().assignedStudentIds
      : [];
    if (assignedStudentIds.length <= 1) {
      await doc.ref.delete();
    } else {
      await doc.ref.set(
        {
          assignedStudentIds: admin.firestore.FieldValue.arrayRemove(userId),
        },
        { merge: true },
      );
    }
  }
}

async function deleteStudentProgress(userId) {
  await deleteQueryDocs(
    getFirestore()
      .collection("customLessonProgress")
      .where("studentId", "==", userId),
    async (doc) => {
      await doc.ref.delete();
    },
  );
}

function randomPassword(length = 12) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

exports.ensureInitialAdmin = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAccess(context);
  if (caller.email !== "mark@birdhaven.us") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only mark@birdhaven.us can bootstrap the initial admin role.",
    );
  }

  await admin
    .auth()
    .setCustomUserClaims(caller.uid, buildClaimsForRole("admin"));
  await getFirestore().collection("users").doc(caller.uid).set(
    {
      email: caller.email,
      role: "admin",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await writeAdminAuditLog({
    actorUid: caller.uid,
    actorRole: caller.role,
    action: "ensureInitialAdmin",
    targetUserId: caller.uid,
    status: "success",
    after: { role: "admin" },
  });

  return { status: "success", role: "admin" };
});

// Returns server-resolved caller role/doc so client login routing does not
// depend on Firestore rules for legacy non-uid keyed user docs.
exports.resolveMyRoleContext = functions.https.onCall(
  async (_data, context) => {
    const caller = await getCallerAccess(context);
    return {
      uid: caller.uid,
      role: caller.role,
      email: caller.email,
      userDoc: caller.doc || null,
    };
  },
);

exports.adminListUsers = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAccess(context);
  requireAtLeastRole(caller, "schoolAdmin");

  const usersSnap = await getFirestore().collection("users").get();
  const docs = usersSnap.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() || {},
  }));
  const authByUid = await getAuthUsersByUid(docs.map((doc) => doc.id));
  const studentsSnap = await getDb().ref("/students").once("value");
  const studentsObj = studentsSnap.exists() ? studentsSnap.val() || {} : {};

  const educatorCounts = {};
  const ownerCounts = {};
  for (const doc of docs) {
    const educatorId = String(doc.data.educator || "").trim();
    if (educatorId) {
      educatorCounts[educatorId] = (educatorCounts[educatorId] || 0) + 1;
    }
    const ownerId = String(
      doc.data.ownerId || doc.data.parentOwnerId || "",
    ).trim();
    if (ownerId) {
      ownerCounts[ownerId] = (ownerCounts[ownerId] || 0) + 1;
    }
  }

  const seen = new Set();
  const users = [];
  for (const doc of docs) {
    const authUser = authByUid.get(doc.id);
    const roleFromDoc = normalizeRole(doc.data.role);
    const roleFromClaims = authUser
      ? deriveRoleFromClaims(authUser.customClaims || {}, authUser.email || "")
      : roleFromDoc;
    const role = roleFromDoc !== "student" ? roleFromDoc : roleFromClaims;

    users.push({
      id: doc.id,
      email: String(doc.data.email || authUser?.email || ""),
      username: String(
        doc.data.username ||
          (doc.data.email ? String(doc.data.email).split("@")[0] : doc.id),
      ),
      firstName: String(doc.data.firstName || ""),
      lastName: String(doc.data.lastName || ""),
      role,
      educator: String(doc.data.educator || ""),
      assignedStudentCount:
        role === "parent" || role === "tutor"
          ? ownerCounts[doc.id] || 0
          : educatorCounts[doc.id] || 0,
      createdAt: authUser?.metadata?.creationTime || doc.data.createdAt || null,
      hasPassword:
        role === "student"
          ? Boolean(studentsObj[doc.id])
          : Array.isArray(authUser?.providerData)
            ? authUser.providerData.some(
                (provider) => provider?.providerId === "password",
              )
            : false,
      usesStudentPassword: Boolean(studentsObj[doc.id]),
    });
    seen.add(doc.id);
  }

  for (const username of Object.keys(studentsObj)) {
    if (seen.has(username)) continue;
    users.push({
      id: username,
      email: "",
      username,
      firstName: "",
      lastName: "",
      role: "student",
      educator: String(studentsObj[username]?.educator || ""),
      assignedStudentCount: 0,
      createdAt: null,
      hasPassword: true,
      usesStudentPassword: true,
    });
  }

  users.sort((a, b) => {
    const rankA = ROLE_RANK[a.role] || 0;
    const rankB = ROLE_RANK[b.role] || 0;
    if (rankA !== rankB) return rankB - rankA;
    return String(a.email || a.username || "").localeCompare(
      String(b.email || b.username || ""),
    );
  });

  const educators = users
    .filter((user) => user.role === "educator" || user.role === "schoolAdmin")
    .map((user) => ({
      id: user.id,
      label:
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.email ||
        user.username ||
        user.id,
    }));

  const classesByEducator = {};
  await Promise.all(
    educators.map(async (educator) => {
      const classesSnap = await getFirestore()
        .collection("users")
        .doc(educator.id)
        .collection("classes")
        .get();
      classesByEducator[educator.id] = classesSnap.docs.map((doc) => doc.id);
    }),
  );

  return { users, educators, classesByEducator };
});

exports.adminCreateUser = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAccess(context);
  requireAtLeastRole(caller, "schoolAdmin");

  const role = normalizeRole(data?.role);
  if ((role === "admin" || role === "schoolAdmin") && caller.role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only top-level admins can create admins.",
    );
  }

  const firstName = String(data?.firstName || "").trim();
  const lastName = String(data?.lastName || "").trim();
  const username = String(data?.username || "").trim();
  const requestedMode = String(data?.usernameMode || data?.usernameChoice || "")
    .trim()
    .toLowerCase();
  const useGeneratedMode = requestedMode === "generated";
  const useEmailMode = requestedMode === "email";
  const displayName = [firstName, lastName].filter(Boolean).join(" ");

  if (role === "student") {
    const providedEmail = String(data?.email || "")
      .trim()
      .toLowerCase();

    if (useGeneratedMode && (!firstName || !lastName)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "First and last name are required for generated usernames.",
      );
    }
    if (useEmailMode && !isValidEmail(providedEmail || username)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A valid student email is required for email sign-in.",
      );
    }

    let resolvedUsername = "";
    if (useGeneratedMode) {
      resolvedUsername = await generateUsername(firstName, lastName);
    } else {
      const manualIdentifier = username || providedEmail;
      if (manualIdentifier) {
        resolvedUsername = isValidEmail(manualIdentifier)
          ? manualIdentifier.toLowerCase()
          : manualIdentifier;
      } else {
        resolvedUsername = await generateUsername(firstName, lastName);
      }
    }

    const existing = await getStudentRef(resolvedUsername).once("value");
    if (existing.exists()) {
      throw new functions.https.HttpsError(
        "already-exists",
        "A student with that username already exists.",
      );
    }

    const educatorId = String(data?.educator || "").trim();
    const classroom = String(data?.classroom || "").trim();
    const tempPassword = randomPassword(12);
    const hash = await bcrypt.hash(tempPassword, saltRounds);

    await getStudentRef(resolvedUsername).set({
      p: hash,
      educator: educatorId || null,
    });

    const studentSchoolId = String(data?.schoolId || "").trim();
    const studentEmail =
      providedEmail ||
      (isValidEmail(resolvedUsername) ? resolvedUsername.toLowerCase() : "");
    const requestedOwnerId = String(
      data?.ownerId || data?.parentOwnerId || "",
    ).trim();
    const defaultOwnerId =
      caller.role === "admin" ? "" : String(caller.uid || "").trim();
    const ownerId = requestedOwnerId || defaultOwnerId;
    const requestedOwnerRole = normalizeRole(data?.ownerRole || "");
    const ownerRole =
      requestedOwnerRole !== "student"
        ? requestedOwnerRole
        : caller.role === "admin"
          ? "student"
          : normalizeRole(caller.role);

    await getFirestore()
      .collection("users")
      .doc(resolvedUsername)
      .set(
        {
          username: resolvedUsername,
          firstName,
          lastName,
          email: studentEmail || null,
          role: "student",
          ...(ownerId ? { ownerId } : {}),
          ...(ownerRole !== "student" ? { ownerRole } : {}),
          ...(ownerId ? { parentOwnerId: ownerId } : {}),
          educator: educatorId || null,
          classroom: classroom || null,
          ...(studentSchoolId
            ? {
                schoolId: studentSchoolId,
                homeSchoolId: studentSchoolId,
              }
            : {}),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          passwordResetRequired: true,
        },
        { merge: true },
      );

    if (educatorId && classroom) {
      await moveStudentClassMembership({
        username: resolvedUsername,
        previousEducator: null,
        previousClassroom: null,
        nextEducator: educatorId,
        nextClassroom: classroom,
      });
    }

    await writeAdminAuditLog({
      actorUid: caller.uid,
      actorRole: caller.role,
      action: "adminCreateUser",
      targetUserId: resolvedUsername,
      status: "success",
      after: {
        role: "student",
        educator: educatorId || null,
        ownerId: ownerId || null,
        ownerRole: ownerRole !== "student" ? ownerRole : null,
      },
    });

    return {
      status: "success",
      userId: resolvedUsername,
      role: "student",
      tempPassword,
      inviteSent: false,
    };
  }

  const email = String(data?.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "email is required for educator/admin accounts.",
    );
  }

  const requestedSchoolId = String(data?.schoolId || "").trim();
  const isSchoolScopedStaffRole = role === "educator" || role === "schoolAdmin";
  if (requestedSchoolId && isSchoolScopedStaffRole) {
    const schoolSnap = await getFirestore()
      .collection("schools")
      .doc(requestedSchoolId)
      .get();
    if (!schoolSnap.exists || schoolSnap.data()?.isActive === false) {
      throw new functions.https.HttpsError(
        "not-found",
        "School not found or inactive.",
      );
    }
  }

  const userRecord = await admin.auth().createUser({
    email,
    displayName: displayName || undefined,
    emailVerified: false,
  });

  const userDoc = {
    email,
    username: username || email.split("@")[0],
    firstName,
    lastName,
    role,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    progress: {},
  };
  if (requestedSchoolId && isSchoolScopedStaffRole) {
    userDoc.schoolId = requestedSchoolId;
    userDoc.school = requestedSchoolId;
    userDoc.homeSchoolId = requestedSchoolId;
  }

  await admin
    .auth()
    .setCustomUserClaims(userRecord.uid, buildClaimsForRole(role));

  await getFirestore()
    .collection("users")
    .doc(userRecord.uid)
    .set(userDoc, { merge: true });

  await sendResetEmailInvite(email);

  await writeAdminAuditLog({
    actorUid: caller.uid,
    actorRole: caller.role,
    action: "adminCreateUser",
    targetUserId: userRecord.uid,
    status: "success",
    after: { role, email },
  });

  return {
    status: "success",
    userId: userRecord.uid,
    role,
    email,
    inviteSent: true,
  };
});

exports.adminUpdateUser = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAccess(context);
  requireAtLeastRole(caller, "parent");

  const userId = String(data?.userId || "").trim();
  if (!userId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "userId is required.",
    );
  }

  const updates = data?.updates || {};
  const userRef = getFirestore().collection("users").doc(userId);
  const userSnap = await userRef.get();
  const existing = userSnap.exists ? userSnap.data() || {} : {};
  let existingRole = normalizeRole(existing.role);
  if (existingRole === "student" && !existing.role) {
    const hasStudentUsername = Boolean(String(existing.username || "").trim());
    const requestedRole = Object.prototype.hasOwnProperty.call(updates, "role")
      ? normalizeRole(updates.role)
      : "student";
    if (requestedRole !== "student") {
      existingRole = requestedRole;
    }

    // Legacy student records can miss the explicit role field. Treat records
    // that already have a student username as student, even if an email is
    // being edited, to avoid misclassifying them as educator.
    if (existingRole === "student" && !hasStudentUsername) {
      const inferredRole = deriveRoleFromClaims(
        {},
        String(existing.email || ""),
      );
      if (inferredRole !== "student") {
        existingRole = inferredRole;
      }
    }

    if (existingRole === "student") {
      try {
        const authUser = await admin.auth().getUser(userId);
        const inferredRole = deriveRoleFromClaims(
          authUser.customClaims || {},
          authUser.email || "",
        );
        if (inferredRole !== "student") {
          existingRole = inferredRole;
        }
      } catch (error) {
        // Student usernames are not Firebase Auth users; ignore not-found here.
      }
    }
  }

  const isParentOrEducatorTutorOrSchoolAdmin =
    caller.role === "parent" ||
    caller.role === "educator" ||
    caller.role === "tutor" ||
    caller.role === "schoolAdmin";
  if (isParentOrEducatorTutorOrSchoolAdmin) {
    if (existingRole !== "student") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Management users can only update student accounts.",
      );
    }

    if (
      caller.role === "parent" ||
      caller.role === "tutor" ||
      caller.role === "schoolAdmin"
    ) {
      const ownerId = String(
        existing.ownerId || existing.parentOwnerId || "",
      ).trim();
      if (!ownerId || ownerId !== caller.uid) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "You can only update students you created.",
        );
      }
    }

    if (caller.role === "educator") {
      const targetUsername = String(existing.username || userId).trim();
      const classesSnap = await getFirestore()
        .collection("classes")
        .where("educatorId", "==", caller.uid)
        .where("isActive", "==", true)
        .get();
      const canManageStudent = classesSnap.docs.some((doc) => {
        const studentIds = Array.isArray(doc.data()?.studentIds)
          ? doc.data().studentIds
          : [];
        return (
          studentIds.includes(userId) ||
          (targetUsername && studentIds.includes(targetUsername))
        );
      });
      if (!canManageStudent) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "You can only update students assigned to your classes.",
        );
      }
    }

    const allowedKeys = new Set(["firstName", "lastName", "password"]);
    const invalidKey = Object.keys(updates).find((k) => !allowedKeys.has(k));
    if (invalidKey) {
      throw new functions.https.HttpsError(
        "permission-denied",
        `Field ${invalidKey} cannot be updated with your role.`,
      );
    }
  }

  const nextRole = updates.role ? normalizeRole(updates.role) : existingRole;
  const touchesAdmin = existingRole === "admin" || nextRole === "admin";
  if (touchesAdmin && caller.role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only top-level admins can modify admin accounts.",
    );
  }

  if (existingRole === "admin" && nextRole !== "admin") {
    const adminCount = await countTopAdmins();
    if (adminCount <= 1) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Cannot demote the last top-level admin.",
      );
    }
  }

  const patch = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const hasSchoolIdUpdate = Object.prototype.hasOwnProperty.call(
    updates,
    "schoolId",
  );
  const nextPassword = Object.prototype.hasOwnProperty.call(updates, "password")
    ? String(updates.password || "").trim()
    : "";
  if (nextPassword && nextPassword.length < 6) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Password must be at least 6 characters.",
    );
  }

  if (Object.prototype.hasOwnProperty.call(updates, "firstName")) {
    patch.firstName = String(updates.firstName || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "lastName")) {
    patch.lastName = String(updates.lastName || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "educator")) {
    patch.educator = String(updates.educator || "").trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "classroom")) {
    patch.classroom = String(updates.classroom || "").trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "username")) {
    const nextUsername = String(updates.username || "").trim();
    const currentUsername = String(existing.username || userId).trim();
    if (
      existingRole === "student" &&
      nextUsername &&
      nextUsername !== currentUsername
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Renaming student usernames is not supported yet.",
      );
    }
    patch.username = nextUsername;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "role")) {
    patch.role = nextRole;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "email")) {
    patch.email = String(updates.email || "")
      .trim()
      .toLowerCase();
  }

  const nextUsesSchoolScope =
    nextRole === "educator" ||
    nextRole === "schoolAdmin" ||
    nextRole === "student";
  if (hasSchoolIdUpdate) {
    const nextSchoolId = String(updates.schoolId || "").trim();
    if (nextSchoolId && nextUsesSchoolScope) {
      const schoolSnap = await getFirestore()
        .collection("schools")
        .doc(nextSchoolId)
        .get();
      if (!schoolSnap.exists || schoolSnap.data()?.isActive === false) {
        throw new functions.https.HttpsError(
          "not-found",
          "School not found or inactive.",
        );
      }
    }

    if (nextSchoolId && nextUsesSchoolScope) {
      patch.schoolId = nextSchoolId;
      // For students, only set homeSchoolId (not the legacy `school` field used by educator views).
      if (nextRole !== "student") {
        patch.school = nextSchoolId;
      }
      patch.homeSchoolId = nextSchoolId;
    } else {
      patch.schoolId = admin.firestore.FieldValue.delete();
      patch.school = admin.firestore.FieldValue.delete();
      patch.homeSchoolId = admin.firestore.FieldValue.delete();
    }
  } else if (
    (existingRole === "educator" || existingRole === "schoolAdmin") &&
    !nextUsesSchoolScope
  ) {
    patch.schoolId = admin.firestore.FieldValue.delete();
    patch.school = admin.firestore.FieldValue.delete();
    patch.homeSchoolId = admin.firestore.FieldValue.delete();
  }

  if (
    existingRole !== "student" &&
    nextRole === "student" &&
    !Object.prototype.hasOwnProperty.call(patch, "username")
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "A username is required when converting a user to student role.",
    );
  }

  await userRef.set(patch, { merge: true });

  if (nextRole === "student") {
    const studentUsername = String(
      existing.username || patch.username || userId,
    ).trim();
    const existingStudent = await getStudentRef(studentUsername).once("value");
    if (!existingStudent.exists()) {
      const initialPassword = nextPassword || randomPassword(12);
      const hash = await bcrypt.hash(initialPassword, saltRounds);
      await getStudentRef(studentUsername).set({
        p: hash,
        educator:
          String(patch.educator || existing.educator || "").trim() || null,
      });
    } else {
      const studentPatch = {
        educator:
          String(patch.educator || existing.educator || "").trim() || null,
      };
      if (nextPassword) {
        studentPatch.p = await bcrypt.hash(nextPassword, saltRounds);
      }
      await getStudentRef(studentUsername).update(studentPatch);
    }

    const previousEducator = existing.educator || null;
    const previousClassroom = existing.classroom || null;
    const nextEducator = Object.prototype.hasOwnProperty.call(patch, "educator")
      ? patch.educator
      : existing.educator || null;
    const nextClassroom = Object.prototype.hasOwnProperty.call(
      patch,
      "classroom",
    )
      ? patch.classroom
      : existing.classroom || null;

    if (
      String(previousEducator || "") !== String(nextEducator || "") ||
      String(previousClassroom || "") !== String(nextClassroom || "")
    ) {
      await moveStudentClassMembership({
        username: studentUsername,
        previousEducator,
        previousClassroom,
        nextEducator,
        nextClassroom,
      });
    }
  } else if (existingRole === "student") {
    const studentUsername = String(existing.username || userId).trim();
    await getStudentRef(studentUsername).remove();
    await moveStudentClassMembership({
      username: studentUsername,
      previousEducator: existing.educator || null,
      previousClassroom: existing.classroom || null,
      nextEducator: null,
      nextClassroom: null,
    });
  }

  if (existingRole !== "student") {
    const authUpdates = {};
    if (Object.prototype.hasOwnProperty.call(updates, "email") && patch.email) {
      authUpdates.email = patch.email;
    }
    if (nextPassword) {
      authUpdates.password = nextPassword;
    }
    const displayName = [
      Object.prototype.hasOwnProperty.call(patch, "firstName")
        ? patch.firstName
        : existing.firstName,
      Object.prototype.hasOwnProperty.call(patch, "lastName")
        ? patch.lastName
        : existing.lastName,
    ]
      .filter(Boolean)
      .join(" ");
    if (displayName) {
      authUpdates.displayName = displayName;
    }
    if (Object.keys(authUpdates).length) {
      await admin.auth().updateUser(userId, authUpdates);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "role")) {
      await admin
        .auth()
        .setCustomUserClaims(userId, buildClaimsForRole(nextRole));
    }
  }

  await writeAdminAuditLog({
    actorUid: caller.uid,
    actorRole: caller.role,
    action: "adminUpdateUser",
    targetUserId: userId,
    status: "success",
    before: {
      role: existingRole,
      email: existing.email || null,
      firstName: existing.firstName || null,
      lastName: existing.lastName || null,
    },
    after: {
      role: nextRole,
      email: patch.email || existing.email || null,
      firstName: Object.prototype.hasOwnProperty.call(patch, "firstName")
        ? patch.firstName
        : existing.firstName || null,
      lastName: Object.prototype.hasOwnProperty.call(patch, "lastName")
        ? patch.lastName
        : existing.lastName || null,
    },
  });

  return { status: "success" };
});

exports.adminDeleteUser = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAccess(context);
  requireAtLeastRole(caller, "schoolAdmin");

  const userId = String(data?.userId || "").trim();
  if (!userId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "userId is required.",
    );
  }

  const userRef = getFirestore().collection("users").doc(userId);
  const userSnap = await userRef.get();
  const existing = userSnap.exists ? userSnap.data() || {} : {};
  const role = normalizeRole(existing.role);

  if (role === "admin" && caller.role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only top-level admins can delete admin accounts.",
    );
  }

  if (role === "admin") {
    const adminCount = await countTopAdmins();
    if (adminCount <= 1) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Cannot delete the last top-level admin.",
      );
    }
  }

  const hasStudents = await getFirestore()
    .collection("users")
    .where("educator", "==", userId)
    .limit(1)
    .get();
  if (!hasStudents.empty) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Cannot delete a user who still has students assigned.",
    );
  }

  await deleteStudentProgress(userId);
  await removeStudentFromCustomLessons(userId);
  await removeStudentFromClassDocs(userId);

  await userRef.delete();
  if (role === "student") {
    await getStudentRef(existing.username || userId).remove();
    await moveStudentClassMembership({
      username: String(existing.username || userId).trim(),
      previousEducator: existing.educator || null,
      previousClassroom: existing.classroom || null,
      nextEducator: null,
      nextClassroom: null,
    });
  }

  if (role !== "student") {
    try {
      await admin.auth().deleteUser(userId);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") {
        throw error;
      }
    }
  }

  await writeAdminAuditLog({
    actorUid: caller.uid,
    actorRole: caller.role,
    action: "adminDeleteUser",
    targetUserId: userId,
    status: "success",
    before: {
      role,
      email: existing.email || null,
      username: existing.username || null,
    },
  });

  return { status: "success" };
});

exports.adminSendResetEmail = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAccess(context);
  requireAtLeastRole(caller, "schoolAdmin");

  const userId = String(data?.userId || "").trim();
  if (!userId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "userId is required.",
    );
  }

  const userDoc = await getFirestore().collection("users").doc(userId).get();
  const userData = userDoc.exists ? userDoc.data() || {} : {};
  const role = normalizeRole(userData.role);
  if (role === "admin" && caller.role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only top-level admins can reset admin passwords.",
    );
  }

  let email = String(userData.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    try {
      const record = await admin.auth().getUser(userId);
      email = String(record.email || "")
        .trim()
        .toLowerCase();
    } catch (error) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "No email-based account found for this user.",
      );
    }
  }

  if (!email) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "No email available for this account.",
    );
  }

  await sendResetEmailInvite(email);

  await getFirestore().collection("users").doc(userId).set(
    {
      passwordResetRequired: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await writeAdminAuditLog({
    actorUid: caller.uid,
    actorRole: caller.role,
    action: "adminSendResetEmail",
    targetUserId: userId,
    status: "success",
    after: { email },
  });

  return { status: "success", email };
});

function getSchoolAdminRequestCollection() {
  return getFirestore().collection("schoolAdminRoleRequests");
}

function getAdminNotificationEmails() {
  const cfg = functions.config();
  const raw = String(cfg?.notifications?.admin_email || "").trim();
  if (!raw) return ["mark@birdhaven.us"];
  return raw
    .split(/[;,\s]+/)
    .map((v) =>
      String(v || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

exports.requestSchoolAdminAccess = functions.https.onCall(
  async (data, context) => {
    const caller = await getCallerAccess(context);
    const callerDocRef = getFirestore().collection("users").doc(caller.uid);
    const callerDocSnap = await callerDocRef.get();
    const callerDoc = callerDocSnap.exists ? callerDocSnap.data() || {} : {};
    const effectiveRole = resolveRequesterRole({
      callerRole: caller.role,
      callerDocRole: callerDoc.role,
    });

    if (!canRequestSchoolAdminAccess(effectiveRole)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "This account already has admin-level access.",
      );
    }

    const requestedSchoolId = String(data?.schoolId || "").trim();
    const requestedSchoolName = String(data?.schoolName || "").trim();
    const reason = String(data?.reason || "").trim();
    const requestRef = getSchoolAdminRequestCollection().doc(caller.uid);
    const existingSnap = await requestRef.get();
    const existing = existingSnap.exists ? existingSnap.data() || {} : null;

    if (isPendingSchoolAdminRequest(existing)) {
      return { status: "already-pending", requestId: requestRef.id };
    }

    const payload = {
      requesterUid: caller.uid,
      requesterEmail: caller.email,
      firstName: String(callerDoc.firstName || "").trim(),
      lastName: String(callerDoc.lastName || "").trim(),
      requestedSchoolId: requestedSchoolId || null,
      requestedSchoolName: requestedSchoolName || null,
      reason: reason || null,
      status: "pending",
      createdAt: existing
        ? existing.createdAt || admin.firestore.FieldValue.serverTimestamp()
        : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedByUid: null,
      decisionNote: null,
    };

    await requestRef.set(payload, { merge: true });
    await callerDocRef.set(
      {
        requestedRole: "schoolAdmin",
        schoolAdminRequestStatus: "pending",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await writeAdminAuditLog({
      actorUid: caller.uid,
      actorRole: effectiveRole,
      action: "requestSchoolAdminAccess",
      targetUserId: caller.uid,
      status: "success",
      after: {
        requestedRole: "schoolAdmin",
        requestedSchoolId: requestedSchoolId || null,
      },
      reason,
    });

    const requesterName = [payload.firstName, payload.lastName]
      .filter(Boolean)
      .join(" ");
    const recipients = getAdminNotificationEmails();
    await queueEmailNotification({
      to: recipients,
      subject: "School Admin Access Request",
      text:
        `A user requested School Admin access.\n\n` +
        `Name: ${requesterName || "(not provided)"}\n` +
        `Email: ${caller.email || "(not provided)"}\n` +
        `User ID: ${caller.uid}\n` +
        `Requested School ID: ${requestedSchoolId || "(not provided)"}\n` +
        `Requested School Name: ${requestedSchoolName || "(not provided)"}\n` +
        `Reason: ${reason || "(not provided)"}\n\n` +
        `Review in Management > Requests.`,
    });

    return { status: "success", requestId: requestRef.id };
  },
);

exports.adminListSchoolAdminRequests = functions.https.onCall(
  async (data, context) => {
    const caller = await getCallerAccess(context);
    if (!canManageSchoolAdminRequests(caller.role)) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only top-level admins can perform this action.",
      );
    }

    const { statusFilter, isValidStatusFilter, limit } =
      normalizeSchoolAdminRequestListArgs(data);

    // Keep this callable resilient even when a composite index is missing.
    // When filtering by status, avoid requiring status+updatedAt by sorting
    // the filtered result in memory.
    const baseCollection = getSchoolAdminRequestCollection();
    const snap = isValidStatusFilter
      ? await baseCollection.where("status", "==", statusFilter).get()
      : await baseCollection.orderBy("updatedAt", "desc").limit(limit).get();

    let requests = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    if (isValidStatusFilter) {
      requests = requests
        .sort((a, b) => {
          const aMs =
            typeof a?.updatedAt?.toMillis === "function"
              ? a.updatedAt.toMillis()
              : 0;
          const bMs =
            typeof b?.updatedAt?.toMillis === "function"
              ? b.updatedAt.toMillis()
              : 0;
          return bMs - aMs;
        })
        .slice(0, limit);
    }

    return { requests };
  },
);

exports.adminReviewSchoolAdminRequest = functions.https.onCall(
  async (data, context) => {
    const caller = await getCallerAccess(context);
    if (!canManageSchoolAdminRequests(caller.role)) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only top-level admins can perform this action.",
      );
    }

    const { requestId, decision, decisionNote, forcedSchoolId, isValid } =
      parseSchoolAdminReviewInput(data);

    if (!requestId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "requestId is required.",
      );
    }
    if (!isValid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "decision must be approve or deny.",
      );
    }

    const requestRef = getSchoolAdminRequestCollection().doc(requestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Request not found.");
    }

    const request = requestSnap.data() || {};
    if (String(request.status || "") !== "pending") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Only pending requests can be reviewed.",
      );
    }

    // requestId is validated above, so in practice this fallback makes
    // missing requesterUid data recoverable for legacy/incomplete records.
    const requesterUid = String(request.requesterUid || requestId).trim();
    if (!requesterUid) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Request is missing requester uid.",
      );
    }

    const requesterDocRef = getFirestore()
      .collection("users")
      .doc(requesterUid);
    const requesterDocSnap = await requesterDocRef.get();
    const requesterDoc = requesterDocSnap.exists
      ? requesterDocSnap.data() || {}
      : {};

    const requestedSchoolId =
      forcedSchoolId || String(request.requestedSchoolId || "").trim();

    if (decision === "approve") {
      if (requestedSchoolId) {
        const schoolSnap = await getFirestore()
          .collection("schools")
          .doc(requestedSchoolId)
          .get();
        if (!schoolSnap.exists || schoolSnap.data()?.isActive === false) {
          throw new functions.https.HttpsError(
            "not-found",
            "Requested school not found or inactive.",
          );
        }
      }

      await admin
        .auth()
        .setCustomUserClaims(requesterUid, buildClaimsForRole("schoolAdmin"));

      await requesterDocRef.set(
        {
          role: "schoolAdmin",
          requestedRole: admin.firestore.FieldValue.delete(),
          schoolAdminRequestStatus: "approved",
          ...(requestedSchoolId
            ? {
                schoolId: requestedSchoolId,
                school: requestedSchoolId,
                homeSchoolId: requestedSchoolId,
              }
            : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } else {
      await requesterDocRef.set(
        {
          requestedRole: admin.firestore.FieldValue.delete(),
          schoolAdminRequestStatus: "denied",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    await requestRef.set(
      {
        status: decision === "approve" ? "approved" : "denied",
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedByUid: caller.uid,
        decisionNote: decisionNote || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await writeAdminAuditLog({
      actorUid: caller.uid,
      actorRole: caller.role,
      action: "adminReviewSchoolAdminRequest",
      targetUserId: requesterUid,
      status: "success",
      before: {
        requestStatus: "pending",
        role: normalizeRole(requesterDoc.role),
      },
      after: {
        requestStatus: decision === "approve" ? "approved" : "denied",
        role:
          decision === "approve"
            ? "schoolAdmin"
            : normalizeRole(requesterDoc.role),
      },
      reason: decisionNote,
    });

    const requesterEmail = String(
      request.requesterEmail || requesterDoc.email || "",
    )
      .trim()
      .toLowerCase();
    if (requesterEmail) {
      await queueEmailNotification({
        to: requesterEmail,
        subject:
          decision === "approve"
            ? "School Admin Access Approved"
            : "School Admin Access Request Update",
        text:
          decision === "approve"
            ? "Your School Admin access request has been approved. Please sign in again to refresh permissions."
            : `Your School Admin access request was not approved.${decisionNote ? ` Note: ${decisionNote}` : ""}`,
      });
    }

    return {
      status: "success",
      requestId,
      decision: decision === "approve" ? "approved" : "denied",
    };
  },
);

exports.adminListAuditLogs = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAccess(context);
  requireAtLeastRole(caller, "admin");

  const maxLimit = Math.min(Math.max(Number(data?.limit || 50), 1), 200);
  const snap = await getFirestore()
    .collection("adminAuditLogs")
    .orderBy("createdAt", "desc")
    .limit(maxLimit)
    .get();

  const logs = snap.docs.map((doc) => {
    const payload = doc.data() || {};
    const timestamp = payload.createdAt?.toDate
      ? payload.createdAt.toDate().toISOString()
      : null;
    return {
      id: doc.id,
      actorUid: payload.actorUid || "",
      actorRole: payload.actorRole || "",
      action: payload.action || "",
      targetUserId: payload.targetUserId || "",
      status: payload.status || "",
      reason: payload.reason || "",
      createdAt: timestamp,
    };
  });

  return { logs };
});

// ─── v2 Org Management callables ─────────────────────────────────────────────
// Re-export callable functions from orgManagement.js.
const orgMgmt = require("./orgManagement");
exports.mgmtListData = orgMgmt.mgmtListData;
exports.mgmtCreateSchool = orgMgmt.mgmtCreateSchool;
exports.mgmtUpdateSchool = orgMgmt.mgmtUpdateSchool;
exports.mgmtArchiveSchool = orgMgmt.mgmtArchiveSchool;
exports.mgmtCreateClass = orgMgmt.mgmtCreateClass;
exports.mgmtUpdateClass = orgMgmt.mgmtUpdateClass;
exports.mgmtArchiveClass = orgMgmt.mgmtArchiveClass;
exports.mgmtAssignStudentClasses = orgMgmt.mgmtAssignStudentClasses;
exports.mgmtBootstrapParentHomeScope = orgMgmt.mgmtBootstrapParentHomeScope;
exports.mgmtParentCreateStudent = orgMgmt.mgmtParentCreateStudent;
exports.mgmtAssignSchoolAdmin = orgMgmt.mgmtAssignSchoolAdmin;
exports.mgmtAssignEducatorToSchool = orgMgmt.mgmtAssignEducatorToSchool;
exports.mgmtListAccountabilityQueue = orgMgmt.mgmtListAccountabilityQueue;
exports.mgmtRecordAccountabilityReminder =
  orgMgmt.mgmtRecordAccountabilityReminder;
exports.mgmtDebugUser = orgMgmt.mgmtDebugUser;
