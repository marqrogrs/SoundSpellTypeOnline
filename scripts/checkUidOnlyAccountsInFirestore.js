/*
  Diagnostic script: compare no-email Auth accounts with Firestore users docs.

  Default behavior uses live Firebase Auth via Admin SDK listUsers().
  Optional offline mode:
    AUTH_EXPORT_JSON=/tmp/fb_users.json node scripts/checkUidOnlyAccountsInFirestore.js
*/
const admin = require("../functions/node_modules/firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || "soundspeller-c5e53",
  });
}

const db = admin.firestore();

async function listAllAuthUsers() {
  const users = [];
  let pageToken;
  do {
    const result = await admin.auth().listUsers(1000, pageToken);
    users.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);
  return users;
}

function getUsersFromExport(exportPath) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const data = require(exportPath);
  return data.users || [];
}

function pickUserFields(data) {
  return {
    role: data.role,
    email: data.email,
    username: data.username,
    firstName: data.firstName,
    lastName: data.lastName,
    classIds: Array.isArray(data.classIds) ? data.classIds : [],
    educatorId: data.educatorId,
    ownerId: data.ownerId,
    parentOwnerId: data.parentOwnerId,
    schoolId: data.schoolId,
  };
}

async function main() {
  const exportPath = process.env.AUTH_EXPORT_JSON;
  const users = exportPath
    ? getUsersFromExport(exportPath)
    : await listAllAuthUsers();

  const noEmailUids = exportPath
    ? users.filter((u) => !u.email).map((u) => u.localId)
    : users.filter((u) => !u.email).map((u) => u.uid);

  console.log(`Total auth accounts: ${users.length}`);
  console.log(`No-email auth accounts: ${noEmailUids.length}`);

  const rows = [];
  for (const uid of noEmailUids) {
    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) {
      rows.push({
        uid,
        firestoreUserDocExists: false,
      });
      continue;
    }

    const data = snap.data() || {};
    rows.push({
      uid,
      firestoreUserDocExists: true,
      ...pickUserFields(data),
    });
  }

  const missing = rows.filter((r) => !r.firestoreUserDocExists);
  const present = rows.filter((r) => r.firestoreUserDocExists);
  const unclassedStudents = present.filter(
    (r) =>
      r.role === "student" &&
      Array.isArray(r.classIds) &&
      r.classIds.length === 0,
  );

  console.log("\nSummary:");
  console.log(
    JSON.stringify(
      {
        totalNoEmailAuthAccounts: noEmailUids.length,
        firestoreUserDocPresent: present.length,
        firestoreUserDocMissing: missing.length,
        unclassedStudentDocsAmongPresent: unclassedStudents.length,
      },
      null,
      2,
    ),
  );

  console.log("\nDetailed rows:");
  rows.forEach((r) => console.log(JSON.stringify(r)));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
