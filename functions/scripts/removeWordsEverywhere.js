/* eslint-disable no-console */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const admin = require("firebase-admin");

const PROJECT_ID = "soundspeller-c5e53";

function parseArgs(argv) {
  const args = {
    words: [],
    mode: "dry-run",
    confirm: false,
    projectId: PROJECT_ID,
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--words=")) {
      args.words = String(arg.split("=")[1] || "")
        .split(",")
        .map((w) =>
          String(w || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean);
      return;
    }
    if (arg.startsWith("--mode=")) {
      args.mode = String(arg.split("=")[1] || "")
        .trim()
        .toLowerCase();
      return;
    }
    if (arg === "--confirm") {
      args.confirm = true;
      return;
    }
    if (arg.startsWith("--project=")) {
      args.projectId = String(arg.split("=")[1] || "").trim() || PROJECT_ID;
    }
  });

  return args;
}

function loadFirebaseCliCredential() {
  const FIREBASE_CLI_CLIENT_ID =
    "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
  const FIREBASE_CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

  const configPath = path.join(
    os.homedir(),
    ".config",
    "configstore",
    "firebase-tools.json",
  );
  if (!fs.existsSync(configPath)) {
    return null;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }

  const refreshToken = config.tokens && config.tokens.refresh_token;
  if (!refreshToken) {
    return null;
  }

  const adc = {
    type: "authorized_user",
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: refreshToken,
  };
  const tmpPath = path.join(
    os.tmpdir(),
    `firebase-cli-adc-${process.pid}.json`,
  );
  fs.writeFileSync(tmpPath, JSON.stringify(adc), { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
  process.on("exit", () => {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup failure
    }
  });
  return tmpPath;
}

function ensureInitialized(projectId) {
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || projectId;
  process.env.GOOGLE_CLOUD_PROJECT =
    process.env.GOOGLE_CLOUD_PROJECT || projectId;

  if (!admin.apps.length) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const tmpPath = loadFirebaseCliCredential();
      if (tmpPath) {
        console.log("Using Firebase CLI credentials (firebase login session).");
      }
    }
    admin.initializeApp({ projectId });
  }
}

function normalizeWord(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeWordArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((w) => String(w || "").trim())
    .filter(Boolean)
    .map((w) => w.toUpperCase());
}

async function findWordDocsToDelete(db, requestedWords) {
  const candidates = new Map();

  // If doc IDs are words, catch them directly.
  requestedWords.forEach((word) => {
    candidates.set(`words/${word}`, { id: word, reason: "doc-id" });
  });

  // If schema stores word field, catch those too.
  const chunkSize = 10;
  const words = [...requestedWords];
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    const snap = await db.collection("words").where("word", "in", chunk).get();
    snap.docs.forEach((doc) => {
      candidates.set(`words/${doc.id}`, { id: doc.id, reason: "word-field" });
    });
  }

  // Filter out non-existing doc-id candidates.
  const final = [];
  const refs = [...candidates.values()].map((item) =>
    db.collection("words").doc(item.id),
  );
  const docs = await db.getAll(...refs);
  docs.forEach((docSnap, idx) => {
    if (docSnap.exists) {
      final.push({
        id: docSnap.id,
        reason: [...candidates.values()][idx].reason,
        word: normalizeWord(docSnap.get("word") || docSnap.id),
      });
    }
  });

  return final;
}

async function findLessonDocsToUpdate(db, collectionName, requestedWords) {
  const snap = await db.collection(collectionName).get();
  const updates = [];

  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const before = normalizeWordArray(data.words);
    if (!before.length) {
      return;
    }

    const removed = before.filter((w) => requestedWords.has(normalizeWord(w)));
    if (!removed.length) {
      return;
    }

    const after = before.filter((w) => !requestedWords.has(normalizeWord(w)));
    updates.push({
      collection: collectionName,
      id: doc.id,
      beforeCount: before.length,
      afterCount: after.length,
      removed,
      after,
    });
  });

  return updates;
}

async function applyWordDeletes(db, wordDocs) {
  const batchLimit = 400;
  for (let i = 0; i < wordDocs.length; i += batchLimit) {
    const group = wordDocs.slice(i, i + batchLimit);
    const batch = db.batch();
    group.forEach((item) => {
      batch.delete(db.collection("words").doc(item.id));
    });
    await batch.commit();
  }
}

async function applyLessonUpdates(db, updates) {
  const batchLimit = 400;
  for (let i = 0; i < updates.length; i += batchLimit) {
    const group = updates.slice(i, i + batchLimit);
    const batch = db.batch();
    group.forEach((item) => {
      batch.set(
        db.collection(item.collection).doc(item.id),
        {
          words: item.after,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: "removeWordsEverywhereScript",
        },
        { merge: true },
      );
    });
    await batch.commit();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.words.length) {
    throw new Error("Missing --words=WORD1,WORD2");
  }
  if (!new Set(["dry-run", "apply"]).has(args.mode)) {
    throw new Error("--mode must be dry-run or apply");
  }
  if (args.mode === "apply" && !args.confirm) {
    throw new Error("Refusing to write without --confirm");
  }

  const requestedWords = new Set(args.words.map(normalizeWord));
  ensureInitialized(args.projectId);

  const db = admin.firestore();
  const [wordDocs, lessonUpdates, customLessonUpdates] = await Promise.all([
    findWordDocsToDelete(db, requestedWords),
    findLessonDocsToUpdate(db, "lessons", requestedWords),
    findLessonDocsToUpdate(db, "customLessons", requestedWords),
  ]);

  const allLessonUpdates = [...lessonUpdates, ...customLessonUpdates];

  console.log(
    JSON.stringify(
      {
        mode: args.mode,
        requestedWords: [...requestedWords],
        wordsDocsToDelete: wordDocs.length,
        lessonsDocsToUpdate: lessonUpdates.length,
        customLessonsDocsToUpdate: customLessonUpdates.length,
        removedFromLessonsTotal: allLessonUpdates.reduce(
          (sum, u) => sum + u.removed.length,
          0,
        ),
        wordDocIds: wordDocs.map((w) => w.id),
      },
      null,
      2,
    ),
  );

  if (args.mode !== "apply") {
    return;
  }

  await applyWordDeletes(db, wordDocs);
  await applyLessonUpdates(db, allLessonUpdates);

  console.log(
    JSON.stringify(
      {
        applied: true,
        deletedWordDocs: wordDocs.length,
        updatedLessonDocs: allLessonUpdates.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
