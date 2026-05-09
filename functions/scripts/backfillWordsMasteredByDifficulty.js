/* eslint-disable no-console */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const admin = require("firebase-admin");

const PROJECT_ID = "soundspeller-c5e53";
const VALID_MODES = new Set(["dry-run", "apply"]);
const VALID_STRATEGIES = new Set(["full-only", "threshold-90"]);
const BACKUP_DIR = path.resolve(__dirname, "backups");

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    confirm: false,
    projectId: PROJECT_ID,
    limit: 0,
    strategy: "full-only",
    includeEducators: false,
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
    if (arg.startsWith("--strategy=")) {
      args.strategy = String(arg.split("=")[1] || "")
        .trim()
        .toLowerCase();
      return;
    }
    if (arg === "--include-educators") {
      args.includeEducators = true;
    }
  });

  return args;
}

function ensureArgs(args) {
  if (!VALID_MODES.has(args.mode)) {
    throw new Error("--mode must be dry-run or apply");
  }
  if (!VALID_STRATEGIES.has(args.strategy)) {
    throw new Error("--strategy must be full-only or threshold-90");
  }
  if (args.mode === "apply" && !args.confirm) {
    throw new Error("Refusing to write without --confirm");
  }
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

function normalizeWordList(value) {
  return (Array.isArray(value) ? value : [])
    .map((word) =>
      String(word || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
}

function buildActiveLessonWords(words, lessonId) {
  const cleanedWords = normalizeWordList(words);
  const normalizedLessonId = String(lessonId || "").trim();

  if (normalizedLessonId === "1.4") {
    const removed = new Set(["HID", "SAP", "POD", "SAT"]);
    return cleanedWords.filter((word) => !removed.has(word));
  }

  if (normalizedLessonId === "1.5") {
    const removed = new Set(["VAT"]);
    return cleanedWords.filter((word) => !removed.has(word));
  }

  if (normalizedLessonId === "5.2") {
    const removed = new Set(["ARM", "CAR"]);
    return cleanedWords.filter((word) => !removed.has(word));
  }

  if (normalizedLessonId === "8.5") {
    const removed = new Set([
      "GLUES",
      "CONSTRUES",
      "DEVALUES",
      "DEVALUED",
      "MISCUED",
      "IMBUES",
      "MISCUING",
      "STEWS",
      "CHEWS",
      "CHEWED",
      "BREWS",
      "BREWED",
      "NEWSCASTING",
      "RENEWALS",
    ]);
    return cleanedWords.filter((word) => !removed.has(word));
  }

  return cleanedWords;
}

function getLessonSubsection(lessonId) {
  const value = String(lessonId || "");
  const idx = value.lastIndexOf(".");
  return idx >= 0 ? value.substring(idx + 1) : value;
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

function toPercent(highScore, levelIndex, lessonWordCount) {
  const raw = Number(highScore) || 0;
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }

  if (raw <= 100) {
    return Math.max(0, Math.min(100, raw));
  }

  const maxLegacyPoints = lessonWordCount * (levelIndex + 1) * 5;
  if (!maxLegacyPoints) {
    return 0;
  }

  return Math.round((Math.min(raw, maxLegacyPoints) / maxLegacyPoints) * 100);
}

function isMasteredLevel(levelProgress, levelIndex, lessonWords, strategy) {
  const lessonWordCount = lessonWords.length;
  if (!lessonWordCount) {
    return false;
  }

  const percent = toPercent(
    levelProgress?.high_score,
    levelIndex,
    lessonWordCount,
  );
  if (strategy === "threshold-90") {
    return percent >= 90;
  }

  return percent >= 100;
}

async function loadLessonWordMap(db) {
  const lessonSnap = await db.collection("lessons").get();
  const map = {};

  lessonSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const lessonSection = String(data.lesson_section || "").trim();
    const lessonId = String(
      data.lesson_id !== undefined && data.lesson_id !== null
        ? data.lesson_id
        : doc.id,
    ).trim();

    const subsection = getLessonSubsection(lessonId);
    const activeWords = buildActiveLessonWords(data.words, lessonId);

    if (!lessonSection || !subsection || !activeWords.length) {
      return;
    }

    if (!map[lessonSection]) {
      map[lessonSection] = {};
    }

    map[lessonSection][subsection] = activeWords;
  });

  return map;
}

function getExistingMasteredSets(userData) {
  const root = userData?.words_mastered_by_difficulty || {};
  return {
    1: new Set(normalizeWordList(root[1] || root["1"] || [])),
    2: new Set(normalizeWordList(root[2] || root["2"] || [])),
    3: new Set(normalizeWordList(root[3] || root["3"] || [])),
  };
}

function extractWordsFromProgress(progress, lessonWordMap, strategy) {
  const out = {
    1: new Set(),
    2: new Set(),
    3: new Set(),
  };

  const sectionKeys = Object.keys(progress || {});
  sectionKeys.forEach((sectionKey) => {
    if (sectionKey === "custom") {
      // Custom lesson progress keys do not map cleanly to custom lesson ids.
      return;
    }

    const sectionProgress = progress[sectionKey] || {};
    const subsectionKeys = Object.keys(sectionProgress);

    subsectionKeys.forEach((subsectionKey) => {
      const lessonWords =
        (lessonWordMap[sectionKey] &&
          lessonWordMap[sectionKey][subsectionKey]) ||
        [];
      if (!lessonWords.length) {
        return;
      }

      const lessonProgress = sectionProgress[subsectionKey] || {};

      [0, 1, 2].forEach((levelIndex) => {
        const levelProgress =
          lessonProgress[levelIndex] ||
          lessonProgress[String(levelIndex)] ||
          {};

        if (
          !isMasteredLevel(levelProgress, levelIndex, lessonWords, strategy)
        ) {
          return;
        }

        const difficultyLevel = String(levelIndex + 1);
        lessonWords.forEach((word) => out[difficultyLevel].add(word));
      });
    });
  });

  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureArgs(args);
  ensureInitialized(args.projectId);

  const db = admin.firestore();
  const lessonWordMap = await loadLessonWordMap(db);

  let usersQuery = db.collection("users");
  if (args.limit > 0) {
    usersQuery = usersQuery.limit(args.limit);
  }

  const usersSnap = await usersQuery.get();
  let userDocs = usersSnap.docs;

  if (!args.includeEducators) {
    userDocs = userDocs.filter((doc) => {
      const data = doc.data() || {};
      return !(typeof data.email === "string" && data.email.trim().length > 0);
    });
  }

  const report = {
    mode: args.mode,
    strategy: args.strategy,
    includeEducators: args.includeEducators,
    totalUsersScanned: userDocs.length,
    usersWithProgress: 0,
    usersNeedingUpdate: 0,
    usersUpdated: 0,
    totalsAdded: { 1: 0, 2: 0, 3: 0 },
    perUser: [],
  };

  const writes = [];

  userDocs.forEach((doc) => {
    const data = doc.data() || {};
    const progress = data.progress || {};

    if (!Object.keys(progress).length) {
      return;
    }

    report.usersWithProgress += 1;

    const existing = getExistingMasteredSets(data);
    const extracted = extractWordsFromProgress(
      progress,
      lessonWordMap,
      args.strategy,
    );

    const added = { 1: [], 2: [], 3: [] };

    ["1", "2", "3"].forEach((level) => {
      extracted[level].forEach((word) => {
        if (!existing[level].has(word)) {
          existing[level].add(word);
          added[level].push(word);
        }
      });
      added[level].sort();
    });

    const addCount = added[1].length + added[2].length + added[3].length;
    if (!addCount) {
      return;
    }

    report.usersNeedingUpdate += 1;
    report.totalsAdded[1] += added[1].length;
    report.totalsAdded[2] += added[2].length;
    report.totalsAdded[3] += added[3].length;

    report.perUser.push({
      userId: doc.id,
      addedCounts: {
        1: added[1].length,
        2: added[2].length,
        3: added[3].length,
      },
      addedPreview: {
        1: added[1].slice(0, 8),
        2: added[2].slice(0, 8),
        3: added[3].slice(0, 8),
      },
    });

    if (args.mode === "apply") {
      const payload = {};
      ["1", "2", "3"].forEach((level) => {
        if (added[level].length) {
          payload[`words_mastered_by_difficulty.${level}`] =
            admin.firestore.FieldValue.arrayUnion(...added[level]);
        }
      });

      if (Object.keys(payload).length) {
        writes.push({ userId: doc.id, payload });
      }
    }
  });

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const reportPath = path.join(
    BACKUP_DIR,
    `backfillWordsMasteredByDifficulty-${args.mode}-${timestamp()}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        strategy: report.strategy,
        includeEducators: report.includeEducators,
        totalUsersScanned: report.totalUsersScanned,
        usersWithProgress: report.usersWithProgress,
        usersNeedingUpdate: report.usersNeedingUpdate,
        totalsAdded: report.totalsAdded,
        reportPath,
      },
      null,
      2,
    ),
  );

  if (args.mode !== "apply") {
    return;
  }

  for (const group of chunk(writes, 300)) {
    const batch = db.batch();
    group.forEach((entry) => {
      const ref = db.collection("users").doc(entry.userId);
      batch.set(ref, entry.payload, { merge: true });
    });
    await batch.commit();
    report.usersUpdated += group.length;
  }

  console.log(
    JSON.stringify(
      {
        usersUpdated: report.usersUpdated,
        totalsAdded: report.totalsAdded,
        reportPath,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (admin.apps.length) {
      await Promise.all(admin.apps.map((app) => app.delete()));
    }
  });
