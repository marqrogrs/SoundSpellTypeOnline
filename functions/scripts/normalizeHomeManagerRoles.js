#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const admin = require("firebase-admin");
const { normalizeRole } = require("../roleUtils");

const PROJECT_ID = "soundspeller-c5e53";
const BACKUP_DIR = path.resolve(__dirname, "backups");
const VALID_MODES = new Set(["dry-run", "apply"]);
const FIREBASE_CLI_CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_CLIENT_SECRET = "j9iP2LJxY5wV7fR3s2qK6mT8";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    confirm: false,
    projectId: PROJECT_ID,
    limit: 0,
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

function loadFirebaseCliCredential() {
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
      const adcPath = path.join(
        os.homedir(),
        ".config",
        "gcloud",
        "application_default_credentials.json",
      );
      if (fs.existsSync(adcPath)) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
        console.log("Using gcloud application default credentials.");
      } else {
        const tmpPath = loadFirebaseCliCredential();
        if (tmpPath) {
          console.log(
            "Using Firebase CLI credentials (firebase login session).",
          );
        }
      }
    }

    admin.initializeApp({ projectId });
  }
}

function normalizeManagerRole(value) {
  const normalized = normalizeRole(value);
  if (normalized === "tutor") return "tutor";
  return "parent";
}

function roleFromClassMetadata(homeClass) {
  const normalizedName = String(homeClass?.normalizedName || "")
    .trim()
    .toLowerCase();
  const name = String(homeClass?.name || "")
    .trim()
    .toLowerCase();

  const candidates = [normalizedName, name];
  if (
    candidates.some(
      (value) =>
        value === "tutor" ||
        value.includes("tutor") ||
        value.includes("reading_specialist") ||
        value.includes("readingspecialist"),
    )
  ) {
    return "tutor";
  }

  return "parent";
}

async function loadAllUsersById(db) {
  const userSnap = await db.collection("users").get();
  const map = new Map();
  userSnap.docs.forEach((doc) => {
    map.set(doc.id, { id: doc.id, ...(doc.data() || {}) });
  });
  return map;
}

function makeBackupPath() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return path.join(
    BACKUP_DIR,
    `normalize-home-manager-roles-${timestamp()}.json`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureArgs(args);
  ensureInitialized(args.projectId);

  const db = admin.firestore();
  const [usersById, homeClassesSnap] = await Promise.all([
    loadAllUsersById(db),
    db.collection("classes").where("schoolType", "==", "home").get(),
  ]);

  const classesToInspect = args.limit
    ? homeClassesSnap.docs.slice(0, args.limit)
    : homeClassesSnap.docs;

  const classUpdates = [];
  const studentUpdates = [];

  for (const classDoc of classesToInspect) {
    const classData = classDoc.data() || {};
    const classId = classDoc.id;
    const educatorId = String(classData.educatorId || "").trim();

    const educatorUser = educatorId ? usersById.get(educatorId) : null;
    const roleFromUser = educatorUser
      ? normalizeManagerRole(educatorUser.role)
      : "";
    const roleFromClass = roleFromClassMetadata(classData);
    const targetRole = roleFromUser || roleFromClass;

    const desiredClassName = targetRole === "tutor" ? "Tutor" : "Parent";
    const desiredNormalizedName = targetRole;

    const currentClassName = String(classData.name || "").trim();
    const currentNormalizedName = String(classData.normalizedName || "").trim();

    if (
      currentClassName !== desiredClassName ||
      currentNormalizedName.toLowerCase() !== desiredNormalizedName
    ) {
      classUpdates.push({
        classId,
        schoolId: String(classData.schoolId || ""),
        educatorId,
        before: {
          name: currentClassName,
          normalizedName: currentNormalizedName,
        },
        after: {
          name: desiredClassName,
          normalizedName: desiredNormalizedName,
        },
      });
    }

    const classStudentIds = new Set();
    const explicitIds = Array.isArray(classData.studentIds)
      ? classData.studentIds
      : [];
    explicitIds.forEach((id) => {
      const normalized = String(id || "").trim();
      if (normalized) classStudentIds.add(normalized);
    });

    const querySnap = await db
      .collection("users")
      .where("role", "==", "student")
      .where("classIds", "array-contains", classId)
      .get();
    querySnap.docs.forEach((doc) => classStudentIds.add(doc.id));

    for (const studentId of classStudentIds) {
      const student = usersById.get(studentId);
      if (!student) continue;

      const currentOwnerRole = String(student.ownerRole || "")
        .trim()
        .toLowerCase();
      const currentOwnerId = String(student.ownerId || "").trim();
      const currentParentOwnerId = String(student.parentOwnerId || "").trim();
      const targetOwnerId =
        educatorId || currentOwnerId || currentParentOwnerId;

      if (
        currentOwnerRole !== targetRole ||
        (targetOwnerId && currentOwnerId !== targetOwnerId) ||
        (targetOwnerId && currentParentOwnerId !== targetOwnerId)
      ) {
        studentUpdates.push({
          studentId,
          classId,
          before: {
            ownerRole: currentOwnerRole,
            ownerId: currentOwnerId,
            parentOwnerId: currentParentOwnerId,
          },
          after: {
            ownerRole: targetRole,
            ownerId: targetOwnerId,
            parentOwnerId: targetOwnerId,
          },
        });
      }
    }
  }

  const summary = {
    mode: args.mode,
    projectId: args.projectId,
    inspectedHomeClasses: classesToInspect.length,
    classUpdates: classUpdates.length,
    studentUpdates: studentUpdates.length,
    sampleClassUpdates: classUpdates.slice(0, 25),
    sampleStudentUpdates: studentUpdates.slice(0, 25),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (
    args.mode !== "apply" ||
    (!classUpdates.length && !studentUpdates.length)
  ) {
    return;
  }

  const backupPath = makeBackupPath();
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        summary,
        classUpdates,
        studentUpdates,
      },
      null,
      2,
    ),
  );
  console.log(`Backup written to ${backupPath}`);

  const timestampValue = admin.firestore.FieldValue.serverTimestamp();
  const classBatchSize = 350;
  for (let i = 0; i < classUpdates.length; i += classBatchSize) {
    const chunk = classUpdates.slice(i, i + classBatchSize);
    const batch = db.batch();
    chunk.forEach((row) => {
      batch.set(
        db.collection("classes").doc(row.classId),
        {
          name: row.after.name,
          normalizedName: row.after.normalizedName,
          updatedAt: timestampValue,
          managerRoleNormalizedBy: "normalizeHomeManagerRoles",
        },
        { merge: true },
      );
    });
    await batch.commit();
    console.log(
      `Committed class batch ${Math.floor(i / classBatchSize) + 1} (${chunk.length} docs).`,
    );
  }

  const studentBatchSize = 350;
  for (let i = 0; i < studentUpdates.length; i += studentBatchSize) {
    const chunk = studentUpdates.slice(i, i + studentBatchSize);
    const batch = db.batch();
    chunk.forEach((row) => {
      const patch = {
        ownerRole: row.after.ownerRole,
        updatedAt: timestampValue,
        managerRoleNormalizedBy: "normalizeHomeManagerRoles",
      };
      if (row.after.ownerId) patch.ownerId = row.after.ownerId;
      if (row.after.parentOwnerId)
        patch.parentOwnerId = row.after.parentOwnerId;
      batch.set(db.collection("users").doc(row.studentId), patch, {
        merge: true,
      });
    });
    await batch.commit();
    console.log(
      `Committed student batch ${Math.floor(i / studentBatchSize) + 1} (${chunk.length} docs).`,
    );
  }

  console.log(
    `Applied normalization: ${classUpdates.length} classes, ${studentUpdates.length} students.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
