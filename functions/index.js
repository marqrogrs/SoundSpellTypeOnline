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

    let lexiconUpdated = false;
    let lexiconFound = false;
    let lexiconError = null;
    try {
      if (!lexiconPath) {
        throw new Error(
          "SoundSpellerDatabase.json not found in deployed paths",
        );
      }

      const raw = await fs.promises.readFile(lexiconPath, "utf8");
      const parsed = JSON.parse(raw);
      const lexicon = Array.isArray(parsed?.ssLexicon)
        ? parsed.ssLexicon
        : null;

      if (!lexicon) {
        throw new Error("Missing ssLexicon array in SoundSpellerDatabase.json");
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
      }
    } catch (error) {
      lexiconError = error?.message || String(error);
      console.error("applyWordFix JSON update error", {
        message: lexiconError,
      });
    }

    console.log("applyWordFix step:done", {
      lexiconFound,
      lexiconUpdated,
      lexiconError,
    });
    return {
      status: "success",
      word,
      firestoreUpdated: true,
      lexiconFound,
      lexiconUpdated,
      lexiconError,
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
