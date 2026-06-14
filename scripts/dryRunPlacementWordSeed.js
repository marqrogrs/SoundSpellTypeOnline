#!/usr/bin/env node
/*
 * Dry-run placement word seed preview.
 *
 * This script does NOT write to Firestore. It prints the upsert payloads that
 * would be used to seed placement-test nonsense words in the words collection.
 */

const path = require("node:path");

const { PLACEMENT_TEST_PARTS } = require(
  path.resolve(__dirname, "../src/data/placementTestData.cjs"),
);

const nowIso = new Date().toISOString();

const docs = [];
for (const part of PLACEMENT_TEST_PARTS) {
  const partNumber = Number(part?.number || 0);
  const partTitle = String(part?.title || "").trim();

  for (const entry of Array.isArray(part?.words) ? part.words : []) {
    const word = String(entry?.word || "")
      .trim()
      .toLowerCase();
    if (!word) {
      continue;
    }

    docs.push({
      id: word,
      data: {
        word,
        graphemes: Array.isArray(entry?.graphemes)
          ? entry.graphemes.map((g) => String(g || "").trim()).filter(Boolean)
          : [],
        phonemes: Array.isArray(entry?.phonemes)
          ? entry.phonemes.map((p) => String(p || "").trim()).filter(Boolean)
          : [],
        placement: {
          enabled: true,
          partNumber,
          partTitle,
          alternatives: Array.isArray(entry?.alternatives)
            ? entry.alternatives
                .map((alt) =>
                  String(alt || "")
                    .trim()
                    .toLowerCase(),
                )
                .filter(Boolean)
            : [],
          updatedAtPreview: nowIso,
        },
      },
    });
  }
}

const byPart = new Map();
for (const doc of docs) {
  const key = `${doc.data.placement.partNumber}: ${doc.data.placement.partTitle}`;
  if (!byPart.has(key)) {
    byPart.set(key, 0);
  }
  byPart.set(key, byPart.get(key) + 1);
}

console.log("Placement Word Seed Dry-Run");
console.log("---------------------------");
console.log(`Total word docs: ${docs.length}`);
console.log("");

for (const [partKey, count] of byPart.entries()) {
  console.log(`${partKey} -> ${count} docs`);
}

console.log("");
console.log("Preview payload (first 8 docs):");
console.log(JSON.stringify(docs.slice(0, 8), null, 2));
console.log("");
console.log(
  "No Firestore writes were performed. This is a safe dry-run preview only.",
);
