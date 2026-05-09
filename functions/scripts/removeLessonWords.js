/* eslint-disable no-console */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const admin = require("firebase-admin");

const PROJECT_ID = "soundspeller-c5e53";

function parseArgs(argv) {
  const args = {
    lessonId: "",
    words: [],
    mode: "dry-run",
    confirm: false,
    projectId: PROJECT_ID,
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--lesson=")) {
      args.lessonId = String(arg.split("=")[1] || "").trim();
      return;
    }
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

function normalizeWords(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((w) => String(w || "").trim()).filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.lessonId) {
    throw new Error("Missing --lesson=<lesson_id>");
  }
  if (!args.words.length) {
    throw new Error("Missing --words=WORD1,WORD2");
  }
  if (!new Set(["dry-run", "apply"]).has(args.mode)) {
    throw new Error("--mode must be dry-run or apply");
  }
  if (args.mode === "apply" && !args.confirm) {
    throw new Error("Refusing to write without --confirm");
  }

  ensureInitialized(args.projectId);
  const db = admin.firestore();

  const requestedWords = new Set(args.words);

  const lessonSnap = await db
    .collection("lessons")
    .where("lesson_id", "==", args.lessonId)
    .get();

  if (lessonSnap.empty) {
    throw new Error(`No lesson found for lesson_id ${args.lessonId}`);
  }

  const updates = [];
  lessonSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const currentWords = normalizeWords(data.words);

    const keptWords = currentWords.filter(
      (w) => !requestedWords.has(String(w).trim().toUpperCase()),
    );

    const removedWords = currentWords.filter((w) =>
      requestedWords.has(String(w).trim().toUpperCase()),
    );

    updates.push({
      id: doc.id,
      lesson_id: String(data.lesson_id || ""),
      beforeCount: currentWords.length,
      afterCount: keptWords.length,
      removedWords,
      beforeWords: currentWords,
      afterWords: keptWords,
    });
  });

  console.log(
    JSON.stringify(
      {
        mode: args.mode,
        lessonId: args.lessonId,
        requestedWords: [...requestedWords],
        matchedDocs: updates.length,
        docs: updates.map((u) => ({
          id: u.id,
          lesson_id: u.lesson_id,
          beforeCount: u.beforeCount,
          afterCount: u.afterCount,
          removedWords: u.removedWords,
        })),
      },
      null,
      2,
    ),
  );

  if (args.mode !== "apply") {
    return;
  }

  for (const u of updates) {
    await db.collection("lessons").doc(u.id).set(
      {
        words: u.afterWords,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: "removeLessonWordsScript",
      },
      { merge: true },
    );
  }

  console.log("Applied updates:", updates.length);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
