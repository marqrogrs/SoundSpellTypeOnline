#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DEFAULT_WORDS_PATH = path.resolve(process.cwd(), "data/words.json");
const DEFAULT_OUT_PATH = path.resolve(
  process.cwd(),
  "public/wiktionary-definitions.json",
);
const DEFAULT_MISSING_PATH = path.resolve(
  process.cwd(),
  "data/wiktionary-missing.json",
);

const normalizeWord = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z'-]/g, "");

const buildCandidateKeys = (word) => {
  const normalized = normalizeWord(word);
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];

  if (normalized.endsWith("ies") && normalized.length > 3) {
    candidates.push(`${normalized.slice(0, -3)}y`);
  }
  if (normalized.endsWith("es") && normalized.length > 2) {
    candidates.push(normalized.slice(0, -2));
  }
  if (normalized.endsWith("s") && normalized.length > 1) {
    candidates.push(normalized.slice(0, -1));
  }
  if (normalized.endsWith("ed") && normalized.length > 2) {
    const stem = normalized.slice(0, -2);
    candidates.push(stem);
    if (!stem.endsWith("e")) {
      candidates.push(`${stem}e`);
    }
    if (/(.)\1$/.test(stem)) {
      candidates.push(stem.slice(0, -1));
    }
  }
  if (normalized.endsWith("ing") && normalized.length > 3) {
    const stem = normalized.slice(0, -3);
    candidates.push(stem);
    if (!stem.endsWith("e")) {
      candidates.push(`${stem}e`);
    }
    if (/(.)\1$/.test(stem)) {
      candidates.push(stem.slice(0, -1));
    }
  }
  if (normalized.endsWith("ied") && normalized.length > 3) {
    candidates.push(`${normalized.slice(0, -3)}y`);
  }

  return [...new Set(candidates.filter(Boolean))];
};

const parseArgs = (argv) => {
  const result = {
    dumpPath: "",
    wordsPath: DEFAULT_WORDS_PATH,
    outPath: DEFAULT_OUT_PATH,
    missingPath: DEFAULT_MISSING_PATH,
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--dump=")) {
      result.dumpPath = path.resolve(
        process.cwd(),
        arg.slice("--dump=".length),
      );
      return;
    }
    if (arg.startsWith("--words=")) {
      result.wordsPath = path.resolve(
        process.cwd(),
        arg.slice("--words=".length),
      );
      return;
    }
    if (arg.startsWith("--out=")) {
      result.outPath = path.resolve(process.cwd(), arg.slice("--out=".length));
      return;
    }
    if (arg.startsWith("--missing=")) {
      result.missingPath = path.resolve(
        process.cwd(),
        arg.slice("--missing=".length),
      );
      return;
    }

    throw new Error(`Unknown argument: ${arg}`);
  });

  if (!result.dumpPath) {
    throw new Error(
      "Missing required --dump=<path-to-enwiktionary-jsonl> argument.",
    );
  }

  if (!fs.existsSync(result.dumpPath)) {
    throw new Error(`Wiktionary dump file not found: ${result.dumpPath}`);
  }

  return result;
};

const readLessonWords = (wordsPath) => {
  const raw = JSON.parse(fs.readFileSync(wordsPath, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error(`Expected array in lesson words file: ${wordsPath}`);
  }

  const set = new Set();
  raw.forEach((entry) => {
    const normalized = normalizeWord(entry && entry.word);
    if (normalized) {
      set.add(normalized);
    }
  });

  return [...set].sort();
};

const getEnglishEntryWord = (entry) => {
  if (!entry || typeof entry !== "object") {
    return "";
  }

  const langCode = String(entry.lang_code || "")
    .trim()
    .toLowerCase();
  const lang = String(entry.lang || "")
    .trim()
    .toLowerCase();
  if (langCode && langCode !== "en") {
    return "";
  }
  if (!langCode && lang && lang !== "english") {
    return "";
  }

  const lemma = normalizeWord(entry.word || entry.title);
  return lemma;
};

const extractSense = (entry) => {
  const senses = Array.isArray(entry && entry.senses) ? entry.senses : [];
  for (let i = 0; i < senses.length; i += 1) {
    const sense = senses[i] || {};

    const glosses = [];
    if (Array.isArray(sense.glosses)) {
      glosses.push(...sense.glosses.map((item) => String(item || "").trim()));
    }
    if (Array.isArray(sense.raw_glosses)) {
      glosses.push(
        ...sense.raw_glosses.map((item) => String(item || "").trim()),
      );
    }

    const definition = glosses.find(
      (gloss) =>
        gloss &&
        !/^inflection of\b/i.test(gloss) &&
        !/^plural of\b/i.test(gloss) &&
        !/^past tense of\b/i.test(gloss),
    );

    if (!definition) {
      continue;
    }

    let exampleSentence = "";
    const examples = Array.isArray(sense.examples) ? sense.examples : [];
    for (let j = 0; j < examples.length; j += 1) {
      const example = examples[j];
      const text =
        typeof example === "string"
          ? example
          : String((example && (example.text || example.example)) || "").trim();
      if (text) {
        exampleSentence = text;
        break;
      }
    }

    return {
      definition,
      exampleSentence,
      partOfSpeech: String(entry.pos || "").trim(),
      source: "wiktionary-dump",
    };
  }

  return null;
};

const chooseBetterEntry = (current, candidate) => {
  if (!current) {
    return candidate;
  }

  const currentHasExample = Boolean(
    String(current.exampleSentence || "").trim(),
  );
  const candidateHasExample = Boolean(
    String(candidate.exampleSentence || "").trim(),
  );

  if (candidateHasExample && !currentHasExample) {
    return candidate;
  }

  if (
    String(candidate.definition || "").length >
    String(current.definition || "").length + 20
  ) {
    return candidate;
  }

  return current;
};

const buildWantedForms = (lessonWords) => {
  const wanted = new Set();
  lessonWords.forEach((word) => {
    buildCandidateKeys(word).forEach((candidate) => wanted.add(candidate));
  });
  return wanted;
};

const extractMatchingForms = (entry, wantedForms) => {
  const matches = new Set();
  const forms = Array.isArray(entry && entry.forms) ? entry.forms : [];

  forms.forEach((item) => {
    const normalized = normalizeWord(item && item.form);
    if (!normalized) {
      return;
    }

    if (wantedForms.has(normalized)) {
      matches.add(normalized);
    }
  });

  return [...matches];
};

const streamDumpMatches = async (dumpPath, wantedForms) => {
  const found = new Map();
  let scanned = 0;
  let matched = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(dumpPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = String(line || "").trim();
    if (!trimmed) {
      continue;
    }

    scanned += 1;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch (_error) {
      continue;
    }

    const lemma = getEnglishEntryWord(entry);
    if (!lemma) {
      continue;
    }

    const lemmaIsWanted = wantedForms.has(lemma);
    const matchingForms = extractMatchingForms(entry, wantedForms);
    if (!lemmaIsWanted && matchingForms.length === 0) {
      continue;
    }

    const sense = extractSense(entry);
    if (!sense) {
      continue;
    }

    if (lemmaIsWanted) {
      const previous = found.get(lemma) || null;
      found.set(lemma, chooseBetterEntry(previous, sense));
      matched += 1;
    }

    matchingForms.forEach((form) => {
      const previous = found.get(form) || null;
      found.set(form, chooseBetterEntry(previous, sense));
      matched += 1;
    });
  }

  return { found, scanned, matched };
};

const buildOutput = (lessonWords, foundMap) => {
  const wordsOut = {};
  const missing = [];

  lessonWords.forEach((lessonWord) => {
    const candidates = buildCandidateKeys(lessonWord);
    let selected = null;
    let selectedKey = "";

    for (let i = 0; i < candidates.length; i += 1) {
      const key = candidates[i];
      const entry = foundMap.get(key);
      if (entry) {
        selected = entry;
        selectedKey = key;
        break;
      }
    }

    if (!selected) {
      missing.push(lessonWord);
      return;
    }

    wordsOut[lessonWord] = {
      definition: String(selected.definition || "").trim(),
      exampleSentence: String(selected.exampleSentence || "").trim(),
      partOfSpeech: String(selected.partOfSpeech || "").trim(),
      source: "wiktionary-local",
      lookupKey: selectedKey,
    };
  });

  return { words: wordsOut, missing };
};

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const lessonWords = readLessonWords(args.wordsPath);
  const wantedForms = buildWantedForms(lessonWords);

  console.log(`Lesson words: ${lessonWords.length}`);
  console.log(`Wanted forms (with simple lemmas): ${wantedForms.size}`);

  const { found, scanned, matched } = await streamDumpMatches(
    args.dumpPath,
    wantedForms,
  );

  const output = buildOutput(lessonWords, found);

  writeJson(args.outPath, { words: output.words });
  writeJson(args.missingPath, {
    totalLessonWords: lessonWords.length,
    matchedWords: Object.keys(output.words).length,
    missingWords: output.missing.length,
    missing: output.missing,
  });

  console.log(`Dump lines scanned: ${scanned}`);
  console.log(`Matching entries seen: ${matched}`);
  console.log(`Unique matched forms: ${found.size}`);
  console.log(
    `Output definitions written: ${Object.keys(output.words).length}`,
  );
  console.log(`Missing lesson words: ${output.missing.length}`);
  console.log(`Output file: ${args.outPath}`);
  console.log(`Missing report: ${args.missingPath}`);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
