/* eslint-disable no-console */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const admin = require("firebase-admin");

const PROJECT_ID = "soundspeller-c5e53";

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    confirm: false,
    projectId: PROJECT_ID,
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
    }
  });

  if (!["dry-run", "apply"].includes(args.mode)) {
    throw new Error("--mode must be one of: dry-run, apply");
  }

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
      // ignore cleanup errors
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

function isLikelyFirestoreId(value) {
  return /^[A-Za-z0-9]{20}$/.test(String(value || ""));
}

async function loadSchoolNameById(db) {
  const snap = await db.collection("schools").get();
  const map = new Map();
  snap.docs.forEach((doc) => {
    const name = String(doc.data()?.name || "").trim();
    if (name) {
      map.set(doc.id, name);
    }
  });
  return map;
}

async function findUpdates(db, schoolNameById) {
  const snap = await db
    .collection("customLessons")
    .where("type", "==", "forSchool")
    .get();

  const updates = [];
  let missingSchoolId = 0;
  let missingSchoolDoc = 0;

  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const assignedSchoolId = String(data.assignedSchoolId || "").trim();
    const assignedSchoolName = String(data.assignedSchoolName || "").trim();

    if (!assignedSchoolId) {
      missingSchoolId += 1;
      return;
    }

    const resolvedName = schoolNameById.get(assignedSchoolId) || "";
    if (!resolvedName) {
      missingSchoolDoc += 1;
      return;
    }

    const hasBadName =
      !assignedSchoolName ||
      assignedSchoolName === assignedSchoolId ||
      isLikelyFirestoreId(assignedSchoolName) ||
      assignedSchoolName !== resolvedName;

    if (hasBadName) {
      updates.push({
        ref: doc.ref,
        id: doc.id,
        assignedSchoolId,
        previousName: assignedSchoolName,
        nextName: resolvedName,
      });
    }
  });

  return {
    updates,
    scanned: snap.size,
    missingSchoolId,
    missingSchoolDoc,
  };
}

async function applyUpdates(updates) {
  const batchSize = 400;
  let committed = 0;

  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = updates.slice(i, i + batchSize);
    const batch = admin.firestore().batch();
    chunk.forEach((item) => {
      batch.update(item.ref, {
        assignedSchoolName: item.nextName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    committed += chunk.length;
    console.log(`Committed ${committed}/${updates.length} updates...`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureInitialized(args.projectId);

  const db = admin.firestore();
  const schoolNameById = await loadSchoolNameById(db);
  const result = await findUpdates(db, schoolNameById);

  console.log("\nBackfill plan:");
  console.log(`- mode: ${args.mode}`);
  console.log(`- scanned forSchool lessons: ${result.scanned}`);
  console.log(`- lessons missing assignedSchoolId: ${result.missingSchoolId}`);
  console.log(`- lessons with unknown schoolId: ${result.missingSchoolDoc}`);
  console.log(`- lessons to update: ${result.updates.length}`);

  result.updates.slice(0, 10).forEach((item) => {
    console.log(
      `  • ${item.id}: ${item.assignedSchoolId} :: '${item.previousName}' -> '${item.nextName}'`,
    );
  });

  if (args.mode === "dry-run") {
    console.log("\nDry run complete. No writes performed.");
    return;
  }

  if (!args.confirm) {
    throw new Error("Refusing to write without --confirm");
  }

  await applyUpdates(result.updates);
  console.log("\nApply complete.");
}

main().catch((error) => {
  console.error("Backfill failed:", error?.message || error);
  process.exitCode = 1;
});
