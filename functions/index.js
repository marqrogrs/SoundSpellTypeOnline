const functions = require("firebase-functions");
const admin = require("firebase-admin");
const bcrypt = require("bcryptjs");
const fs = require("node:fs");
const path = require("node:path");
const { assertCanResetStudentPassword } = require("./resetPasswordAccess");
const saltRounds = 10;

let _initError = null;
try {
  if (!admin.apps.length) {
    admin.initializeApp({
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
  if (!_db) _db = admin.database();
  return _db;
};
const getFirestore = () => {
  if (!_firestore) _firestore = admin.firestore();
  return _firestore;
};

const escapeXml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

exports.authenticateStudent = functions.https.onCall(async (data, context) => {
  const { username, password } = data || {};
  const requestUser = String(username || "").trim();
  console.log("authenticateStudent request", {
    hasUsername: Boolean(requestUser),
    callerAuthenticated: Boolean(context && context.auth && context.auth.uid),
  });

  return getDb()
    .ref("/students/" + username)
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
          return admin.auth().createCustomToken(requestUser);
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

  const { username, password, classroom } = data || {};
  if (!username || !password || !classroom) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "username, password, and classroom are required.",
    );
  }

  const educator_uid = context.auth.uid;
  try {
    const existing = await getDb()
      .ref("/students/" + username)
      .once("value");
    if (existing.exists()) {
      throw new functions.https.HttpsError(
        "already-exists",
        "A student with that username already exists.",
      );
    }

    const hash = await bcrypt.hash(password, saltRounds);
    await getDb()
      .ref("/students/" + username)
      .set({ p: hash, educator: educator_uid });

    console.log("Created realtime db entry - creating student user doc");
    await getFirestore()
      .collection("users")
      .doc(username)
      .set({ username, educator: educator_uid, classroom, progress: {} });

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

    return { status: "success" };
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
      "You must be signed in as an educator to reset student passwords.",
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

    const studentSnap = await getDb()
      .ref("/students/" + username)
      .once("value");
    const studentExists = studentSnap.exists();
    const studentRecord = studentExists ? studentSnap.val() || {} : null;

    assertCanResetStudentPassword({
      callerUid,
      callerData,
      studentExists,
      studentRecord,
    });

    const hash = await bcrypt.hash(password, saltRounds);
    await getDb()
      .ref("/students/" + username)
      .update({ p: hash });
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
  const word = String((data && data.word) || "").trim();
  const ipa = String((data && data.ipa) || "").trim();

  if (!word) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "word is required.",
    );
  }

  const cfg = functions.config();
  const key = cfg && cfg.azure_tts && cfg.azure_tts.key;
  const region = cfg && cfg.azure_tts && cfg.azure_tts.region;
  const voice =
    (cfg && cfg.azure_tts && cfg.azure_tts.voice) || "en-US-JennyNeural";

  if (!key || !region) {
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

  try {
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
  educator: 2,
  schoolAdmin: 3,
  admin: 4,
};

const RESET_EMAIL_API_KEY = "AIzaSyBC9FNI_d_Lse9Kw1u_1jbWUvqcHShHXZQ";

function normalizeRole(input) {
  const value = String(input || "").trim();
  if (value === "admin") return "admin";
  if (value === "schoolAdmin") return "schoolAdmin";
  if (value === "educator") return "educator";
  if (value === "parent") return "parent";
  return "student";
}

function deriveRoleFromClaims(claims, fallbackEmail = "") {
  const roleFromClaim = normalizeRole(claims?.role);
  if (claims?.admin) return "admin";
  if (claims?.schoolAdmin) return "schoolAdmin";
  if (roleFromClaim !== "student") return roleFromClaim;
  return fallbackEmail ? "educator" : "student";
}

function isParentRole(role) {
  return role === "parent";
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

async function getCallerAccess(context) {
  const callerUid = ensureAuthenticated(context);
  const callerRecord = await admin.auth().getUser(callerUid);
  const callerRole = deriveRoleFromClaims(
    callerRecord.customClaims || {},
    callerRecord.email || "",
  );
  return {
    uid: callerUid,
    role: callerRole,
    email: String(callerRecord.email || "").toLowerCase(),
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
  for (const doc of docs) {
    const educatorId = String(doc.data.educator || "").trim();
    if (educatorId) {
      educatorCounts[educatorId] = (educatorCounts[educatorId] || 0) + 1;
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
      assignedStudentCount: educatorCounts[doc.id] || 0,
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
  const displayName = [firstName, lastName].filter(Boolean).join(" ");

  if (role === "student") {
    if (!username) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "username is required for student accounts.",
      );
    }

    const existing = await getDb().ref(`/students/${username}`).once("value");
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

    await getDb()
      .ref(`/students/${username}`)
      .set({
        p: hash,
        educator: educatorId || null,
      });

    const studentSchoolId = String(data?.schoolId || "").trim();

    await getFirestore()
      .collection("users")
      .doc(username)
      .set(
        {
          username,
          firstName,
          lastName,
          role: "student",
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
        username,
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
      targetUserId: username,
      status: "success",
      after: { role: "student", educator: educatorId || null },
    });

    return {
      status: "success",
      userId: username,
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
    const requestedRole = Object.prototype.hasOwnProperty.call(updates, "role")
      ? normalizeRole(updates.role)
      : "student";
    if (requestedRole !== "student") {
      existingRole = requestedRole;
    }

    if (existingRole === "student") {
      const inferredRole = deriveRoleFromClaims(
        {},
        String(existing.email || updates.email || ""),
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

  const isParentOrEducator =
    caller.role === "parent" || caller.role === "educator";
  if (isParentOrEducator) {
    if (existingRole !== "student") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Parents and educators can only update student accounts.",
      );
    }

    if (caller.role === "parent") {
      const ownerId = String(existing.parentOwnerId || "").trim();
      if (!ownerId || ownerId !== caller.uid) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "You can only update your own students.",
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
    const existingStudent = await getDb()
      .ref(`/students/${studentUsername}`)
      .once("value");
    if (!existingStudent.exists()) {
      const initialPassword = nextPassword || randomPassword(12);
      const hash = await bcrypt.hash(initialPassword, saltRounds);
      await getDb()
        .ref(`/students/${studentUsername}`)
        .set({
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
      await getDb().ref(`/students/${studentUsername}`).update(studentPatch);
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
    await getDb().ref(`/students/${studentUsername}`).remove();
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

  const progressRef = await getFirestore()
    .collection("customLessonProgress")
    .where("studentId", "==", userId)
    .limit(1)
    .get();
  if (!progressRef.empty) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Cannot delete this user while lesson progress exists.",
    );
  }

  const assignedRef = await getFirestore()
    .collection("customLessons")
    .where("assignedStudentIds", "array-contains", userId)
    .limit(1)
    .get();
  if (!assignedRef.empty) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Cannot delete this user while assigned custom lessons exist.",
    );
  }

  await userRef.delete();
  await getDb().ref(`/students/${userId}`).remove();

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
// All management callables live in orgManagement.js; re-export them here so
// Firebase Functions picks them up from the single entry point.
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
exports.mgmtDebugUser = orgMgmt.mgmtDebugUser;
