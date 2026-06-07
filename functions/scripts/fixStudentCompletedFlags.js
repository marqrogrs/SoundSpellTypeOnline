/* eslint-disable no-console */
"use strict";

/**
 * fixStudentCompletedFlags.js
 *
 * Reads a student's Firestore progress doc and prints (dry-run) or clears
 * (apply) any level-completion flags where the student's stored progress
 * shows 0 correct_words AND 0 score — indicating the flag was set
 * erroneously.
 *
 * Usage:
 *   node scripts/fixStudentCompletedFlags.js --uid=student1 --lessons=1.3,1.4 [--mode=apply] [--confirm]
 */

const admin = require("firebase-admin");

const PROJECT_ID = "soundspeller-c5e53";

function parseArgs(argv) {
  const args = { uid: "", lessons: [], mode: "dry-run", confirm: false };
  argv.forEach((arg) => {
    if (arg.startsWith("--uid=")) args.uid = arg.split("=")[1];
    if (arg.startsWith("--lessons="))
      args.lessons = arg
        .split("=")[1]
        .split(",")
        .map((s) => s.trim());
    if (arg.startsWith("--mode=")) args.mode = arg.split("=")[1];
    if (arg === "--confirm") args.confirm = true;
  });
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.uid) {
    console.error("--uid is required");
    process.exit(1);
  }
  if (!args.lessons.length) {
    console.error("--lessons is required (e.g. --lessons=1.3,1.4)");
    process.exit(1);
  }
  if (args.mode === "apply" && !args.confirm) {
    console.error("Refusing to write without --confirm");
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const db = admin.firestore();

  const docRef = db.collection("users").doc(args.uid);
  const snap = await docRef.get();
  if (!snap.exists) {
    console.error(`No Firestore doc found for uid: ${args.uid}`);
    process.exit(1);
  }

  const data = snap.data();
  const progress = data.progress || {};

  const updates = {}; // Firestore field paths -> new values
  let anyProblems = false;

  for (const lessonId of args.lessons) {
    const dotIdx = lessonId.lastIndexOf(".");
    const section = lessonId.substring(0, dotIdx);
    const subsection = lessonId.substring(dotIdx + 1);

    const lessonProgress = (progress[section] || {})[subsection] || {};

    console.log(
      `\n=== Lesson ${lessonId} (section=${section}, sub=${subsection}) ===`,
    );

    const LEVEL_COUNT = 3;
    for (let i = 0; i < LEVEL_COUNT; i++) {
      const lp = lessonProgress[i] || {};
      const completed = Boolean(lp.completed);
      const correctWords = Array.isArray(lp.correct_words)
        ? lp.correct_words.length
        : 0;
      const highScore = Number(lp.high_score) || 0;
      const score = Number(lp.score) || 0;
      const completedWords = Number(lp.completed_words) || 0;

      // high_score persists from historical runs; use current score + correct_words only
      const hasRealActivity =
        correctWords > 0 || score > 0 || completedWords > 0;
      const flagIsSpurious = completed && !hasRealActivity;

      console.log(
        `  Level ${i + 1}: completed=${completed} correctWords=${correctWords} highScore=${highScore} score=${score} completedWords=${completedWords}` +
          (flagIsSpurious ? "  ← SPURIOUS FLAG" : ""),
      );

      if (flagIsSpurious) {
        anyProblems = true;
        const fieldPath = `progress.${section}.${subsection}.${i}.completed`;
        updates[fieldPath] = false;
      }
    }
  }

  if (!anyProblems) {
    console.log("\nNo spurious completed flags found. Nothing to do.");
    return;
  }

  console.log("\nFields to clear:");
  Object.keys(updates).forEach((k) => console.log(`  ${k} -> false`));

  if (args.mode === "dry-run") {
    console.log(
      "\n[DRY-RUN] No changes written. Re-run with --mode=apply --confirm to apply.",
    );
    return;
  }

  // update() treats dot-notation keys as nested field paths, which is what we need
  await docRef.update(updates);
  console.log(
    `\n[APPLIED] Cleared ${Object.keys(updates).length} spurious completed flag(s) for ${args.uid}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
