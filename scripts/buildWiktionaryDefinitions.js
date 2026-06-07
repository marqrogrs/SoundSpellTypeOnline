#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const DEFAULT_INPUT_PATH = path.resolve(
  process.cwd(),
  "data/wiktionary-definitions.json",
);
const DEFAULT_OUTPUT_PATH = path.resolve(
  process.cwd(),
  "public/wiktionary-definitions.json",
);
const DEFAULT_SEED_WORDS_PATH = path.resolve(process.cwd(), "data/words.json");

const STARTER_DATA = {
  words: {
    spacious: {
      definition: "Having a lot of space; roomy.",
      exampleSentence:
        "The new classroom is spacious enough for all the students.",
      partOfSpeech: "adjective",
      source: "wiktionary-local",
    },
    end: {
      definition: "The final part or point of something.",
      exampleSentence: "We read to the end of the story before lunch.",
      partOfSpeech: "noun",
      source: "wiktionary-local",
    },
    her: {
      definition:
        "Used as the object form of she, or to show something belongs to a female person.",
      exampleSentence: "I gave her the pencil, and she put it in her bag.",
      partOfSpeech: "pronoun",
      source: "wiktionary-local",
    },
    dad: {
      definition: "Father; an informal word for one’s male parent.",
      exampleSentence: "My dad helped me practice spelling after dinner.",
      partOfSpeech: "noun",
      source: "wiktionary-local",
    },
    fad: {
      definition: "Something that is very popular for a short time.",
      exampleSentence: "The toy was a fad that disappeared after a few months.",
      partOfSpeech: "noun",
      source: "wiktionary-local",
    },
    gad: {
      definition: "To move about from place to place, especially for pleasure.",
      exampleSentence: "On weekends they gad around town visiting friends.",
      partOfSpeech: "verb",
      source: "wiktionary-local",
    },
  },
};

const normalizeWord = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z'-]/g, "");

const parseArgs = (argv) => {
  const result = {
    inPath: DEFAULT_INPUT_PATH,
    outPath: DEFAULT_OUTPUT_PATH,
    seedWordsPath: DEFAULT_SEED_WORDS_PATH,
    ensureCoverage: true,
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--in=")) {
      result.inPath = path.resolve(process.cwd(), arg.slice("--in=".length));
      return;
    }

    if (arg.startsWith("--out=")) {
      result.outPath = path.resolve(process.cwd(), arg.slice("--out=".length));
      return;
    }

    if (arg.startsWith("--seed-words=")) {
      result.seedWordsPath = path.resolve(
        process.cwd(),
        arg.slice("--seed-words=".length),
      );
      return;
    }

    if (arg === "--no-ensure-coverage") {
      result.ensureCoverage = false;
      return;
    }

    throw new Error(`Unknown argument: ${arg}`);
  });

  return result;
};

const normalizePayload = (payload) => {
  const words = payload && typeof payload === "object" ? payload.words : null;
  if (!words || typeof words !== "object") {
    throw new Error(
      "Input must be a JSON object with a top-level words object.",
    );
  }

  const normalizedWords = {};
  Object.entries(words).forEach(([rawWord, rawEntry]) => {
    const word = normalizeWord(rawWord);
    if (!word || !rawEntry || typeof rawEntry !== "object") {
      return;
    }

    const definition = String(rawEntry.definition || "").trim();
    if (!definition) {
      return;
    }

    normalizedWords[word] = {
      definition,
      exampleSentence: String(rawEntry.exampleSentence || "").trim(),
      partOfSpeech: String(rawEntry.partOfSpeech || "").trim(),
      source: "wiktionary-local",
    };
  });

  return { words: normalizedWords };
};

const readSeedWords = (seedWordsPath) => {
  if (!fs.existsSync(seedWordsPath)) {
    return [];
  }

  const raw = JSON.parse(fs.readFileSync(seedWordsPath, "utf8"));
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((entry) => normalizeWord(entry && entry.word)).filter(Boolean);
};

const ensureCoverageForSeedWords = (normalizedPayload, seedWords) => {
  const words = normalizedPayload.words || {};
  let inserted = 0;

  seedWords.forEach((word) => {
    if (words[word]) {
      return;
    }

    words[word] = {
      definition: `A lesson word: ${word}.`,
      exampleSentence: `${word.toUpperCase()} is included in the lesson word list.`,
      partOfSpeech: "",
      source: "wiktionary-seeded",
    };
    inserted += 1;
  });

  return inserted;
};

const readInputData = (inPath) => {
  if (!fs.existsSync(inPath)) {
    console.warn(`Input file not found at ${inPath}. Using starter entries.`);
    return STARTER_DATA;
  }

  return JSON.parse(fs.readFileSync(inPath, "utf8"));
};

const writeOutputData = (outPath, payload) => {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const inputPayload = readInputData(args.inPath);
  const normalized = normalizePayload(inputPayload);

  let inserted = 0;
  if (args.ensureCoverage) {
    const seedWords = readSeedWords(args.seedWordsPath);
    inserted = ensureCoverageForSeedWords(normalized, seedWords);
  }

  writeOutputData(args.outPath, normalized);

  console.log(
    `Wrote ${Object.keys(normalized.words).length} Wiktionary entries to ${args.outPath}`,
  );
  if (inserted > 0) {
    console.log(`Seeded ${inserted} missing lesson words.`);
  }
};

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
