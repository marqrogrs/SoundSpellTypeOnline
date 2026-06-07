#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const DEFAULT_INPUT_PATH = path.resolve(
  process.cwd(),
  "data/wiktionary-missing.json",
);
const DEFAULT_OUTPUT_PATH = path.resolve(
  process.cwd(),
  "data/wiktionary-misspelling-suggestions.csv",
);
const DEFAULT_PAIRS_OUTPUT_PATH = path.resolve(
  process.cwd(),
  "data/wiktionary-misspelling-pairs.csv",
);

const parseArgs = (argv) => {
  const result = {
    inputPath: DEFAULT_INPUT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    pairsOutputPath: DEFAULT_PAIRS_OUTPUT_PATH,
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--in=")) {
      result.inputPath = path.resolve(process.cwd(), arg.slice("--in=".length));
      return;
    }
    if (arg.startsWith("--out=")) {
      result.outputPath = path.resolve(
        process.cwd(),
        arg.slice("--out=".length),
      );
      return;
    }
    if (arg.startsWith("--pairs-out=")) {
      result.pairsOutputPath = path.resolve(
        process.cwd(),
        arg.slice("--pairs-out=".length),
      );
      return;
    }

    throw new Error(`Unknown argument: ${arg}`);
  });

  if (!fs.existsSync(result.inputPath)) {
    throw new Error(`Input file not found: ${result.inputPath}`);
  }

  return result;
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const escapeCsv = (value) => {
  const text = String(value == null ? "" : value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const payload = readJson(args.inputPath);
  const suggestions = Array.isArray(payload && payload.misspellingSuggestions)
    ? payload.misspellingSuggestions
    : [];

  const header = ["word", "suggestion", "distance", "method", "confidence"];
  const lines = [header.join(",")];
  const pairLines = [["word", "suggestion"].join(",")];

  suggestions.forEach((item) => {
    lines.push(
      [
        escapeCsv(item && item.word),
        escapeCsv(item && item.suggestion),
        escapeCsv(item && item.distance),
        escapeCsv(item && item.method),
        escapeCsv(item && item.confidence),
      ].join(","),
    );

    pairLines.push(
      [escapeCsv(item && item.word), escapeCsv(item && item.suggestion)].join(
        ",",
      ),
    );
  });

  fs.mkdirSync(path.dirname(args.outputPath), { recursive: true });
  fs.writeFileSync(args.outputPath, `${lines.join("\n")}\n`, "utf8");

  fs.mkdirSync(path.dirname(args.pairsOutputPath), { recursive: true });
  fs.writeFileSync(args.pairsOutputPath, `${pairLines.join("\n")}\n`, "utf8");

  console.log(`Suggestions exported: ${suggestions.length}`);
  console.log(`CSV file: ${args.outputPath}`);
  console.log(`Pairs CSV file: ${args.pairsOutputPath}`);
};

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
