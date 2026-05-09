/* eslint-disable no-console */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const admin = require("firebase-admin");

const PROJECT_ID = "soundspeller-c5e53";
const BACKUP_DIR = path.resolve(__dirname, "backups");
const VALID_MODES = new Set(["dry-run", "apply"]);
const STAFF_ROLES = new Set(["admin", "schoolAdmin", "educator", "parent"]);

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    confirm: false,
    projectId: PROJECT_ID,
    limit: 0,
    includeStudents: false,
  };

  argv.forEach((arg) => {
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
      return;
    }
    if (arg.startsWith("--limit=")) {
      const parsed = Number(String(arg.split("=")[1] || "").trim());
      args.limit =
        Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
      return;
    }
    if (arg === "--include-students") {
      args.includeStudents = true;
    }
  });

  return args;
}

function ensureArgs(args) {
  if (!VALID_MODES.has(args.mode)) {
    throw new Error("--mode must be dry-run or apply");
  }
  if (args.mode === "apply" && !args.confirm) {
    throw new Error("Refusing to write without --confirm");
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeRole(value) {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  if (role === "schooladmin") return "schoolAdmin";
  return role;
}

function toDate(value) {
  if (!value) return null;
  if (value && typeof value.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hasAnyLessonAttempt(progress) {
  if (!progress || typeof progress !== "object") {
    return false;
  }

  return Object.values(progress).some((sectionValue) => {
    if (!sectionValue || typeof sectionValue !== "object") {
      return false;
    }

    return Object.values(sectionValue).some((lessonValue) => {
      if (!lessonValue || typeof lessonValue !== "object") {
        return false;
      }

      return Object.values(lessonValue).some((levelValue) => {
        if (!levelValue || typeof levelValue !== "object") {
          return false;
        }

        const completedWords = Number(levelValue.completed_words) || 0;
        const score = Number(levelValue.score) || 0;
        const highScore = Number(levelValue.high_score) || 0;
        const correctWords = Array.isArray(levelValue.correct_words)
          ? levelValue.correct_words
          : [];

        return (
          completedWords > 0 ||
          score > 0 ||
          highScore > 0 ||
          Boolean(levelValue.completed) ||
          correctWords.length > 0
        );
      });
    });
  });
}

function hasAnyMasteredWord(wordsMasteredByDifficulty) {
  if (
    !wordsMasteredByDifficulty ||
    typeof wordsMasteredByDifficulty !== "object"
  ) {
    return false;
  }

  return Object.values(wordsMasteredByDifficulty).some((words) => {
    return Array.isArray(words) && words.length > 0;
  });
}

function chooseBackfillTimestamp(data) {
  const createdAt = toDate(data.createdAt);
  if (createdAt) {
    return admin.firestore.Timestamp.fromDate(createdAt);
  }

  const updatedAt = toDate(data.updatedAt);
  if (updatedAt) {
    return admin.firestore.Timestamp.fromDate(updatedAt);
  }

  return admin.firestore.Timestamp.now();
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
      // ignore
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

function writeReport(report) {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const reportPath = path.join(
    BACKUP_DIR,
    `firstLessonAttemptedAt-backfill-${timestamp()}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureArgs(args);
  ensureInitialized(args.projectId);

  const db = admin.firestore();
  const usersSnap = await db.collection("users").get();

  const rows = usersSnap.docs.map((doc) => {
    const data = doc.data() || {};
    const role = normalizeRole(data.role);
    const hasExistingTimestamp = Boolean(
      data.firstLessonAttemptedAt || data.first_lesson_attempted_at,
    );

    const isStaff = STAFF_ROLES.has(role);
    const isIncludedRole = args.includeStudents ? true : isStaff;

    const attemptedViaProgress = hasAnyLessonAttempt(data.progress);
    const attemptedViaMastered = hasAnyMasteredWord(
      data.words_mastered_by_difficulty,
    );
    const hasAttemptSignal = attemptedViaProgress || attemptedViaMastered;

    return {
      userId: doc.id,
      role,
      isStaff,
      isIncludedRole,
      hasExistingTimestamp,
      attemptedViaProgress,
      attemptedViaMastered,
      hasAttemptSignal,
      chosenTimestamp: chooseBackfillTimestamp(data),
    };
  });

  const candidates = rows
    .filter((row) => row.isIncludedRole)
    .filter((row) => !row.hasExistingTimestamp)
    .filter((row) => row.hasAttemptSignal);

  const limited = args.limit > 0 ? candidates.slice(0, args.limit) : candidates;

  const report = {
    mode: args.mode,
    projectId: args.projectId,
    includeStudents: args.includeStudents,
    limit: args.limit,
    scannedUsers: rows.length,
    includedUsers: rows.filter((row) => row.isIncludedRole).length,
    alreadyHadTimestamp: rows.filter((row) => row.hasExistingTimestamp).length,
    candidates: candidates.length,
    toProcess: limited.length,
    sample: limited.slice(0, 100).map((row) => ({
      userId: row.userId,
      role: row.role,
      attemptedViaProgress: row.attemptedViaProgress,
      attemptedViaMastered: row.attemptedViaMastered,
      backfillTimestamp: row.chosenTimestamp.toDate().toISOString(),
    })),
  };

  const reportPath = writeReport(report);

  console.log(JSON.stringify(report, null, 2));
  console.log(`Report written to ${reportPath}`);

  if (args.mode !== "apply" || limited.length === 0) {
    return;
  }

  const batchSize = 400;
  for (let i = 0; i < limited.length; i += batchSize) {
    const batch = db.batch();
    const chunk = limited.slice(i, i + batchSize);

    chunk.forEach((row) => {
      batch.set(
        db.collection("users").doc(row.userId),
        {
          firstLessonAttemptedAt: row.chosenTimestamp,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          firstLessonAttemptedBackfilledBy: "backfillFirstLessonAttemptedAt",
        },
        { merge: true },
      );
    });

    await batch.commit();
    console.log(
      `Committed batch ${Math.floor(i / batchSize) + 1} (${chunk.length} users).`,
    );
  }

  console.log(
    `Applied firstLessonAttemptedAt backfill to ${limited.length} users.`,
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
