/* eslint-disable no-console */
"use strict";

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
const SOURCE_DB_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "data",
  "SoundSpellerDatabase.json",
);

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    confirm: false,
    projectId: PROJECT_ID,
    limit: 0,
    words: [],
    backupFile: "",
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
    if (arg.startsWith("--project=")) {
      args.projectId = arg.split("=")[1] || PROJECT_ID;
      return;
    }
    if (arg.startsWith("--limit=")) {
      args.limit = Number(arg.split("=")[1]) || 0;
      return;
    }
    if (arg.startsWith("--words=")) {
      args.words = arg
        .split("=")[1]
        .split(",")
        .map((value) =>
          String(value || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean);
      return;
    }
    if (arg.startsWith("--backup=")) {
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

function resolveBackupFilePath(backupFile) {
  if (backupFile) {
    return path.resolve(process.cwd(), backupFile);
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    return "";
  }

  const candidates = fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => /^fix-aw-ao-grapheme-backup-.*\.json$/i.test(name))
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

function splitPhonemeString(phon) {
  return String(phon || "")
    .replace(/-/g, " - ")
    .split(/\s+/)
    .map((item) =>
      String(item || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
}

function normalizeWordArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) =>
      String(item || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
}

function buildMergedAwGraphemes(graphemes, phonemes) {
  const sourceGraphemes = normalizeWordArray(graphemes);
  const sourcePhonemes = normalizeWordArray(phonemes);
  const next = [];
  let phonemeCursor = 0;
  let changed = false;

  for (let index = 0; index < sourceGraphemes.length; index += 1) {
    while (sourcePhonemes[phonemeCursor] === "-") {
      phonemeCursor += 1;
    }

    const grapheme = sourceGraphemes[index];
    const following = sourceGraphemes[index + 1];
    const mappedPhoneme = sourcePhonemes[phonemeCursor];

    if (
      grapheme === "A" &&
      following === "W" &&
      (mappedPhoneme === "AO" || mappedPhoneme === "AA")
    ) {
      next.push("AW");
      changed = true;
      index += 1;
      if (mappedPhoneme) {
        phonemeCursor += 1;
      }
      continue;
    }

    next.push(grapheme);
    if (mappedPhoneme) {
      phonemeCursor += 1;
    }
  }

  return {
    changed,
    graphemes: next,
  };
}

function deriveCandidateWords() {
  const parsed = JSON.parse(fs.readFileSync(SOURCE_DB_PATH, "utf8"));
  const lexicon = Array.isArray(parsed?.ssLexicon) ? parsed.ssLexicon : [];
  const candidates = [];

  lexicon.forEach((row) => {
    const word = String(row?.word || "")
      .trim()
      .toUpperCase();
    if (!word) {
      return;
    }

    const graphemes = String(row?.grap || "")
      .split(",")
      .map((item) =>
        String(item || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);
    const phonemes = splitPhonemeString(row?.phon || "");
    const merged = buildMergedAwGraphemes(graphemes, phonemes);

    if (merged.changed) {
      candidates.push({
        word,
        sourceGraphemes: graphemes,
        sourcePhonemes: phonemes,
        desiredGraphemes: merged.graphemes,
      });
    }
  });

  return candidates;
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
          restoreTo: normalizeWordArray(item?.before?.graphemes),
          currentFromBackupAfter: normalizeWordArray(item?.after?.graphemes),
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
          graphemes: normalizeWordArray(item?.before?.graphemes),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: "fixAwAoGraphemeMigrationRollback",
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

  let candidates = deriveCandidateWords();
  if (args.words.length) {
    const allowed = new Set(args.words);
    candidates = candidates.filter((row) => allowed.has(row.word));
  }
  if (args.limit > 0) {
    candidates = candidates.slice(0, args.limit);
  }

  const docs = await loadWordDocs(
    db,
    candidates.map((candidate) => candidate.word),
  );

  const docByWord = new Map(docs.map((entry) => [entry.word, entry]));
  const updates = [];
  const alreadyCorrect = [];
  const missingDocs = [];
  const skippedNoChange = [];

  candidates.forEach((candidate) => {
    const live = docByWord.get(candidate.word);
    if (!live || !live.exists) {
      missingDocs.push(candidate.word);
      return;
    }

    const liveGraphemes = normalizeWordArray(live.data?.graphemes);
    const livePhonemes = normalizeWordArray(live.data?.phonemes);
    const merged = buildMergedAwGraphemes(liveGraphemes, livePhonemes);

    if (!merged.changed) {
      if (
        JSON.stringify(liveGraphemes) ===
        JSON.stringify(candidate.desiredGraphemes)
      ) {
        alreadyCorrect.push(candidate.word);
      } else {
        skippedNoChange.push({
          word: candidate.word,
          graphemes: liveGraphemes,
          phonemes: livePhonemes,
        });
      }
      return;
    }

    updates.push({
      word: candidate.word,
      before: {
        graphemes: liveGraphemes,
        phonemes: livePhonemes,
        syllables: Array.isArray(live.data?.syllables)
          ? live.data.syllables
          : [],
      },
      after: {
        graphemes: merged.graphemes,
      },
    });
  });

  console.log(
    JSON.stringify(
      {
        mode: args.mode,
        candidateCount: candidates.length,
        updateCount: updates.length,
        alreadyCorrectCount: alreadyCorrect.length,
        missingCount: missingDocs.length,
        skippedNoChangeCount: skippedNoChange.length,
        sampleUpdates: updates.slice(0, 20).map((item) => ({
          word: item.word,
          before: item.before.graphemes,
          after: item.after.graphemes,
        })),
        sampleAlreadyCorrect: alreadyCorrect.slice(0, 20),
        sampleMissing: missingDocs.slice(0, 20),
        sampleSkippedNoChange: skippedNoChange.slice(0, 10),
      },
      null,
      2,
    ),
  );

  if (args.mode !== "apply" || !updates.length) {
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(
    BACKUP_DIR,
    `fix-aw-ao-grapheme-backup-${timestamp()}.json`,
  );
  fs.writeFileSync(backupPath, JSON.stringify({ updates }, null, 2));

  for (const group of chunk(updates, 400)) {
    const batch = db.batch();
    group.forEach((item) => {
      batch.set(
        db.collection("words").doc(item.word),
        {
          graphemes: item.after.graphemes,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: "fixAwAoGraphemeMigration",
        },
        { merge: true },
      );
    });
    await batch.commit();
  }

  console.log(`Applied ${updates.length} updates.`);
  console.log(`Backup saved to ${backupPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
