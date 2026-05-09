/* eslint-disable no-console */
"use strict";

/**
 * Migration: Fix UR,E (final) words where the UR grapheme maps to Y+ER phonemes
 * and the trailing E is silent.
 *
 * Pattern: graphemes end with ...,UR,E  and phonemes end with ...Y ER
 * Correct encoding: the UR grapheme carries both Y and ER; the silent E is
 * represented by a double-hyphen separator (--) before the Y token so that the
 * alignment engine knows the E is silent.
 *
 * Example:
 *   FAILURE  graphemes: F,AI,L,UR,E   phonemes: F,EY,LL,--Y,ER
 *
 * Usage:
 *   node fixUrePhonemesMigration.js --mode=dry-run
 *   node fixUrePhonemesMigration.js --mode=apply --confirm
 *   node fixUrePhonemesMigration.js --mode=rollback --backup=<path>
 *   node fixUrePhonemesMigration.js --mode=rollback-preview --backup=<path>
 *
 * Options:
 *   --words=FAILURE,FIGURE   restrict to specific words (comma-separated)
 *   --project=<id>           override Firebase project ID
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const admin = require("firebase-admin");

const VALID_MODES = new Set([
  "dry-run",
  "apply",
  "rollback",
  "rollback-preview",
]);
const PROJECT_ID = "soundspeller-c5e53";
const BACKUP_DIR = path.resolve(__dirname, "backups");

// Words this migration targets: ...URE ending where UR = Y+ER and final E is silent.
const TARGET_WORDS = new Set([
  "CONFIGURE",
  "DISFIGURE",
  "FAILURE",
  "FIGURE",
  "INSECURE",
  "MANICURE",
  "PEDICURE",
  "RECONFIGURE",
  "TENURE",
]);

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    confirm: false,
    projectId: PROJECT_ID,
    words: [],
    backupFile: "",
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--mode=")) {
      args.mode = arg.split("=")[1];
    } else if (arg === "--confirm") {
      args.confirm = true;
    } else if (arg.startsWith("--project=")) {
      args.projectId = arg.split("=")[1] || PROJECT_ID;
    } else if (arg.startsWith("--words=")) {
      args.words = arg
        .split("=")[1]
        .split(",")
        .map((v) =>
          String(v || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean);
    } else if (arg.startsWith("--backup=")) {
      args.backupFile = String(arg.split("=")[1] || "").trim();
    }
  });

  return args;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
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
  if (!fs.existsSync(configPath)) return null;

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }

  const refreshToken = config.tokens && config.tokens.refresh_token;
  if (!refreshToken) return null;

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
      /* ignore */
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

function normalizeList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) =>
      String(item || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
}

/**
 * Given a Firestore phonemes array like ["F", "EY", "LL", "Y", "ER"] for a
 * word whose graphemes end with UR,E, return the corrected phoneme array where
 * the silent-E is encoded as a "--Y" split token on the UR grapheme.
 *
 * Input phonemes should already be the string array stored in Firestore by the
 * applyWordFix function (each phoneme or separator is its own string element).
 *
 * The Firestore phoneme format written by applyWordFix joins phonemes that
 * belong to the same grapheme with hyphen-separated tokens inside one string,
 * e.g. ["F", "EY", "LL--Y", "ER"] where LL--Y means L-phoneme + silent-grapheme
 * marker + Y.  In practice the existing Firestore docs for these words may
 * store the phonemes in a legacy $oid format; this migration only touches words
 * that already have a string-array phoneme list (set by WordFixAdmin) or seeds
 * from the JSON lexicon phoneme string.
 *
 * Correction rule:
 *   Find the last occurrence of "Y" in the phoneme array. If the element
 *   immediately before "Y" ends without "--", and the last grapheme is "E"
 *   (silent) with grapheme before it being "UR", then prefix that "Y" element
 *   with "--".
 */
function buildCorrectedPhonemes(graphemes, phonemes) {
  const gList = normalizeList(graphemes);
  const pList = normalizeList(phonemes);

  // Must end with UR,E graphemes
  if (gList.length < 2) return null;
  if (gList[gList.length - 1] !== "E") return null;
  if (gList[gList.length - 2] !== "UR") return null;

  // Must end with ...Y ER (or ...Y-ER combined) in phonemes
  // After normalisation each phoneme is its own element.
  // We look for the penultimate element being exactly "Y" and last being "ER",
  // or the last two being part of the final UR grapheme mapping.
  if (pList.length < 2) return null;

  const last = pList[pList.length - 1];
  const penultimate = pList[pList.length - 2];

  // Already correct – penultimate ends with "--Y"
  if (penultimate.endsWith("--Y")) return null;

  if (last !== "ER") return null;
  if (penultimate !== "Y") return null;

  // Fix: replace "Y" with "--Y" (marks the UR grapheme as consuming Y+ER while
  // the following E grapheme is silent).
  const corrected = [...pList];
  corrected[corrected.length - 2] = "--Y";
  return corrected;
}

async function loadWordDocs(db, words) {
  const results = [];
  for (const group of chunk(words, 200)) {
    const refs = group.map((word) => db.collection("words").doc(word));
    const docs = await db.getAll(...refs);
    docs.forEach((doc) => {
      results.push({
        word: doc.id,
        exists: doc.exists,
        data: doc.exists ? doc.data() : null,
      });
    });
  }
  return results;
}

function resolveBackupFilePath(backupFile) {
  if (backupFile) return path.resolve(process.cwd(), backupFile);

  if (!fs.existsSync(BACKUP_DIR)) return "";

  const candidates = fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => /^fix-ure-phonemes-backup-.*\.json$/i.test(name))
    .map((name) => {
      const fullPath = path.join(BACKUP_DIR, name);
      let mtime = 0;
      try {
        mtime = fs.statSync(fullPath).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { fullPath, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return candidates.length ? candidates[0].fullPath : "";
}

function loadRollbackPayload(args) {
  const resolvedBackupPath = resolveBackupFilePath(args.backupFile);
  if (!resolvedBackupPath) {
    throw new Error(
      "Rollback requires --backup=<path> or an existing backup file in functions/scripts/backups.",
    );
  }
  if (!fs.existsSync(resolvedBackupPath)) {
    throw new Error(`Backup file not found: ${resolvedBackupPath}`);
  }
  const payload = JSON.parse(fs.readFileSync(resolvedBackupPath, "utf8"));
  const updates = Array.isArray(payload?.updates) ? payload.updates : [];
  return { resolvedBackupPath, updates };
}

async function runRollbackPreview(args) {
  const { resolvedBackupPath, updates } = loadRollbackPayload(args);
  if (!updates.length) {
    console.log(`No updates found in backup: ${resolvedBackupPath}`);
    return;
  }
  console.log(
    JSON.stringify(
      {
        mode: "rollback-preview",
        backup: resolvedBackupPath,
        restoreCount: updates.length,
        sampleRestores: updates.slice(0, 20).map((item) => ({
          word: item.word,
          restorePhonemes: normalizeList(item?.before?.phonemes),
        })),
      },
      null,
      2,
    ),
  );
}

async function runRollback(args) {
  const { resolvedBackupPath, updates } = loadRollbackPayload(args);
  if (!updates.length) {
    console.log(`No updates found in backup: ${resolvedBackupPath}`);
    return;
  }
  ensureInitialized(args.projectId);
  const db = admin.firestore();

  for (const group of chunk(updates, 400)) {
    const batch = db.batch();
    group.forEach((item) => {
      batch.set(
        db.collection("words").doc(item.word),
        {
          phonemes: normalizeList(item?.before?.phonemes),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: "fixUrePhonemesMigrationRollback",
        },
        { merge: true },
      );
    });
    await batch.commit();
  }

  console.log(`Rollback applied from ${resolvedBackupPath}`);
  console.log(`Restored ${updates.length} word documents.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!VALID_MODES.has(args.mode)) {
    throw new Error(`Invalid mode: ${args.mode}`);
  }
  if (args.mode === "rollback-preview") {
    await runRollbackPreview(args);
    return;
  }
  if (args.mode === "rollback") {
    await runRollback(args);
    return;
  }
  if (args.mode === "apply" && !args.confirm) {
    throw new Error("Refusing to write without --confirm");
  }

  ensureInitialized(args.projectId);
  const db = admin.firestore();

  let targetWords = [...TARGET_WORDS];
  if (args.words.length) {
    const allowed = new Set(args.words);
    targetWords = targetWords.filter((w) => allowed.has(w));
  }

  const docs = await loadWordDocs(db, targetWords);
  const docByWord = new Map(docs.map((entry) => [entry.word, entry]));

  const updates = [];
  const alreadyCorrect = [];
  const missingDocs = [];
  const skipped = [];

  for (const word of targetWords) {
    const live = docByWord.get(word);
    if (!live || !live.exists) {
      missingDocs.push(word);
      continue;
    }

    const liveGraphemes = normalizeList(live.data?.graphemes);
    const livePhonemes = normalizeList(live.data?.phonemes);

    if (!livePhonemes.length) {
      skipped.push({
        word,
        reason: "phonemes not string-array (legacy $oid format)",
      });
      continue;
    }

    const corrected = buildCorrectedPhonemes(liveGraphemes, livePhonemes);

    if (corrected === null) {
      alreadyCorrect.push({ word, phonemes: livePhonemes });
      continue;
    }

    updates.push({
      word,
      before: {
        graphemes: liveGraphemes,
        phonemes: livePhonemes,
        syllables: Array.isArray(live.data?.syllables)
          ? live.data.syllables
          : [],
      },
      after: {
        phonemes: corrected,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: args.mode,
        targetCount: targetWords.length,
        updateCount: updates.length,
        alreadyCorrectCount: alreadyCorrect.length,
        missingCount: missingDocs.length,
        skippedCount: skipped.length,
        updates: updates.map((item) => ({
          word: item.word,
          before: item.before.phonemes,
          after: item.after.phonemes,
        })),
        alreadyCorrect: alreadyCorrect.map((item) => item.word),
        missing: missingDocs,
        skipped,
      },
      null,
      2,
    ),
  );

  if (args.mode !== "apply" || !updates.length) return;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(
    BACKUP_DIR,
    `fix-ure-phonemes-backup-${timestamp()}.json`,
  );
  fs.writeFileSync(backupPath, JSON.stringify({ updates }, null, 2));
  console.log(`Backup saved to ${backupPath}`);

  for (const group of chunk(updates, 400)) {
    const batch = db.batch();
    group.forEach((item) => {
      batch.set(
        db.collection("words").doc(item.word),
        {
          phonemes: item.after.phonemes,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: "fixUrePhonemesMigration",
        },
        { merge: true },
      );
    });
    await batch.commit();
  }

  console.log(`Applied ${updates.length} updates to Firestore.`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
