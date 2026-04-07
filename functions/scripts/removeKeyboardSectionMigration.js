/* eslint-disable no-console */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");
const os = require("os");

const VALID_MODES = new Set(["dry-run", "apply", "rollback"]);

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    confirm: false,
    backupFile: "",
    projectId: "",
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--mode=")) {
      args.mode = arg.split("=")[1];
      return;
    }
    if (arg === "--confirm") {
      args.confirm = true;
      return;
    }
    if (arg.startsWith("--backup=")) {
      args.backupFile = arg.split("=")[1];
      return;
    }
    if (arg.startsWith("--project=")) {
      args.projectId = arg.split("=")[1];
    }
  });

  return args;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function toSectionString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function shiftSectionKey(sectionKey) {
  const parsed = Number(sectionKey);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < 2 || parsed > 13) {
    return null;
  }
  return String(parsed - 1);
}

function shiftLessonId(lessonId) {
  const raw = String(lessonId || "").trim();
  if (!raw) {
    return raw;
  }

  const pieces = raw.split(".");
  const prefix = Number(pieces[0]);
  if (!Number.isInteger(prefix)) {
    return raw;
  }
  if (prefix < 2 || prefix > 13) {
    return raw;
  }

  pieces[0] = String(prefix - 1);
  return pieces.join(".");
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function commitBatchOps(db, ops) {
  const groups = chunk(ops, 450);
  for (const group of groups) {
    const batch = db.batch();
    group.forEach((op) => {
      if (op.type === "set") {
        batch.set(op.ref, op.data, op.options || {});
      } else if (op.type === "update") {
        batch.update(op.ref, op.data);
      } else if (op.type === "delete") {
        batch.delete(op.ref);
      }
    });
    await batch.commit();
  }
}

function buildUserProgressMigration(progress) {
  const source = progress && typeof progress === "object" ? progress : {};
  const target = {};

  Object.entries(source).forEach(([key, value]) => {
    const shifted = shiftSectionKey(key);
    if (key === "1") {
      return;
    }
    if (shifted) {
      target[shifted] = value;
      return;
    }
    target[key] = value;
  });

  return target;
}

function loadFirebaseCliCredential() {
  // Firebase CLI OAuth2 client credentials (public, from firebase-tools source)
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

  // Write a temporary ADC file in authorized_user format so firebase-admin
  // can pick it up via GOOGLE_APPLICATION_CREDENTIALS.
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

  // Clean up temp file when process exits.
  process.on("exit", () => {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  });

  return tmpPath;
}

function ensureInitialized() {
  const explicitProjectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "soundspeller-c5e53";

  // Ensure google-auth-library can resolve project ID in local scripts.
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || explicitProjectId;
  process.env.GOOGLE_CLOUD_PROJECT =
    process.env.GOOGLE_CLOUD_PROJECT || explicitProjectId;

  if (!admin.apps.length) {
    // When ADC is unavailable (local dev), fall back to Firebase CLI credentials.
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const tmpPath = loadFirebaseCliCredential();
      if (tmpPath) {
        console.log("Using Firebase CLI credentials (firebase login session).");
      }
    }

    admin.initializeApp({ projectId: explicitProjectId });
  }
}

async function readSnapshot(db) {
  const [lessonsSnap, lessonSectionsSnap, usersSnap] = await Promise.all([
    db.collection("lessons").get(),
    db.collection("lessonSection").get(),
    db.collection("users").get(),
  ]);

  return {
    lessons: lessonsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    lessonSection: lessonSectionsSnap.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    })),
    users: usersSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  };
}

function buildPlan(snapshot) {
  const lessonDeletes = [];
  const lessonUpdates = [];
  const lessonIdCollisions = new Map();

  snapshot.lessons.forEach(({ id, data }) => {
    const section = toSectionString(data.lesson_section);
    if (section === "1") {
      lessonDeletes.push({ id, data });
      return;
    }

    const shiftedSection = shiftSectionKey(section);
    if (!shiftedSection) {
      return;
    }

    const shiftedLessonId = shiftLessonId(data.lesson_id);
    const updated = {
      ...data,
      lesson_section: shiftedSection,
      lesson_id: shiftedLessonId,
    };
    lessonUpdates.push({ id, before: data, after: updated });

    const collisionKey = shiftedLessonId;
    if (!lessonIdCollisions.has(collisionKey)) {
      lessonIdCollisions.set(collisionKey, []);
    }
    lessonIdCollisions.get(collisionKey).push(id);
  });

  const duplicateLessonIds = Array.from(lessonIdCollisions.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([lessonId, ids]) => ({ lessonId, ids }));

  const sectionDeletes = [];
  const sectionWrites = [];
  snapshot.lessonSection.forEach(({ id, data }) => {
    const section = toSectionString(id || data.lesson_section);
    if (section === "1") {
      sectionDeletes.push(id);
      return;
    }

    const shiftedSection = shiftSectionKey(section);
    if (!shiftedSection) {
      return;
    }

    sectionDeletes.push(id);
    sectionWrites.push({ id: shiftedSection, data });
  });

  const userUpdates = snapshot.users
    .map(({ id, data }) => {
      const beforeProgress = data.progress || {};
      const afterProgress = buildUserProgressMigration(beforeProgress);
      const changed =
        JSON.stringify(beforeProgress) !== JSON.stringify(afterProgress);
      if (!changed) {
        return null;
      }
      return {
        id,
        beforeProgress,
        afterProgress,
      };
    })
    .filter(Boolean);

  return {
    lessonDeletes,
    lessonUpdates,
    duplicateLessonIds,
    sectionDeletes,
    sectionWrites,
    userUpdates,
  };
}

function printPlan(plan) {
  console.log("\nMigration summary:");
  console.log(`- lessons to delete (section 1): ${plan.lessonDeletes.length}`);
  console.log(`- lessons to shift/update: ${plan.lessonUpdates.length}`);
  console.log(`- lessonSection docs to delete: ${plan.sectionDeletes.length}`);
  console.log(`- lessonSection docs to write: ${plan.sectionWrites.length}`);
  console.log(`- users with progress updates: ${plan.userUpdates.length}`);

  if (plan.duplicateLessonIds.length > 0) {
    console.log("\nDuplicate lesson_id collisions detected after shift:");
    plan.duplicateLessonIds.forEach(({ lessonId, ids }) => {
      console.log(`- lesson_id ${lessonId}: doc IDs ${ids.join(", ")}`);
    });
  }
}

function makeBackupPath(custom) {
  if (custom) {
    return path.resolve(process.cwd(), custom);
  }
  const backupDir = path.resolve(process.cwd(), "scripts", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  return path.join(
    backupDir,
    `remove-keyboard-section-backup-${timestamp()}.json`,
  );
}

function writeBackupFile(filePath, snapshot) {
  const payload = {
    createdAt: new Date().toISOString(),
    snapshot,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

async function runDryOrApply({ mode, confirm, backupFile }) {
  ensureInitialized();
  const db = admin.firestore();

  const snapshot = await readSnapshot(db);
  const plan = buildPlan(snapshot);
  printPlan(plan);

  if (plan.duplicateLessonIds.length > 0) {
    throw new Error(
      "Aborting migration because shifted lesson_id values would collide.",
    );
  }

  if (mode === "dry-run") {
    console.log("\nDry run complete. No data was changed.");
    return;
  }

  if (!confirm) {
    throw new Error("Apply mode requires --confirm. No changes were made.");
  }

  const backupPath = makeBackupPath(backupFile);
  writeBackupFile(backupPath, snapshot);
  console.log(`\nBackup written to: ${backupPath}`);

  const ops = [];

  plan.lessonDeletes.forEach(({ id }) => {
    ops.push({
      type: "delete",
      ref: db.collection("lessons").doc(id),
    });
  });

  plan.lessonUpdates.forEach(({ id, after }) => {
    ops.push({
      type: "set",
      ref: db.collection("lessons").doc(id),
      data: after,
      options: { merge: false },
    });
  });

  plan.sectionDeletes.forEach((id) => {
    ops.push({
      type: "delete",
      ref: db.collection("lessonSection").doc(id),
    });
  });

  plan.sectionWrites.forEach(({ id, data }) => {
    ops.push({
      type: "set",
      ref: db.collection("lessonSection").doc(String(id)),
      data,
      options: { merge: false },
    });
  });

  plan.userUpdates.forEach(({ id, afterProgress }) => {
    ops.push({
      type: "update",
      ref: db.collection("users").doc(id),
      data: { progress: afterProgress },
    });
  });

  await commitBatchOps(db, ops);

  console.log("\nApply complete.");
  console.log("- lessons and sections shifted down by one (2..13 -> 1..12)");
  console.log("- section 1 lessons removed");
  console.log("- user progress remapped");
  console.log(
    "- use --mode=rollback --backup=<path> to restore snapshot if needed",
  );
}

async function runRollback({ backupFile }) {
  if (!backupFile) {
    throw new Error("Rollback requires --backup=<path-to-backup-json>.");
  }

  ensureInitialized();
  const db = admin.firestore();

  const resolvedPath = path.resolve(process.cwd(), backupFile);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Backup file not found: ${resolvedPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const snapshot = payload && payload.snapshot;
  if (!snapshot) {
    throw new Error("Backup file is missing snapshot data.");
  }

  const [currentLessons, currentSections] = await Promise.all([
    db.collection("lessons").get(),
    db.collection("lessonSection").get(),
  ]);

  const ops = [];

  currentLessons.docs.forEach((doc) => {
    ops.push({ type: "delete", ref: doc.ref });
  });
  currentSections.docs.forEach((doc) => {
    ops.push({ type: "delete", ref: doc.ref });
  });
  (snapshot.lessons || []).forEach(({ id, data }) => {
    ops.push({
      type: "set",
      ref: db.collection("lessons").doc(id),
      data,
      options: { merge: false },
    });
  });

  (snapshot.lessonSection || []).forEach(({ id, data }) => {
    ops.push({
      type: "set",
      ref: db.collection("lessonSection").doc(id),
      data,
      options: { merge: false },
    });
  });

  (snapshot.users || []).forEach(({ id, data }) => {
    ops.push({
      type: "set",
      ref: db.collection("users").doc(id),
      data,
      options: { merge: false },
    });
  });

  await commitBatchOps(db, ops);

  console.log("Rollback complete.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.projectId) {
    process.env.FIREBASE_PROJECT_ID = args.projectId;
    process.env.GCLOUD_PROJECT = args.projectId;
    process.env.GOOGLE_CLOUD_PROJECT = args.projectId;
  }

  if (!VALID_MODES.has(args.mode)) {
    throw new Error("Invalid --mode. Use dry-run, apply, or rollback.");
  }

  if (args.mode === "rollback") {
    await runRollback(args);
    return;
  }

  await runDryOrApply(args);
}

main().catch((error) => {
  console.error("Migration script failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
