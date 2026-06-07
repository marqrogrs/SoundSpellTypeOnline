#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const DEFAULT_WORDS_PATH = path.resolve(process.cwd(), "data/words.json");
const DEFAULT_IN_PATH = path.resolve(
  process.cwd(),
  "public/wiktionary-definitions.json",
);
const DEFAULT_MISSING_PATH = path.resolve(
  process.cwd(),
  "data/wiktionary-missing.json",
);
const DEFAULT_OUT_PATH = DEFAULT_IN_PATH;
const DEFAULT_REPORT_PATH = DEFAULT_MISSING_PATH;
const WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php";
const MAX_TITLES_PER_REQUEST = 20;
const SEARCH_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 10000;
const MISSPELLING_MIN_LENGTH = 5;
const LOCAL_TYPO_CORRECTIONS = {
  britian: "britain",
  beligerent: "belligerent",
  beligerence: "belligerence",
  celebate: "celibate",
  combustable: "combustible",
  consultantcy: "consultancy",
  earfull: "earful",
  elibible: "eligible",
  agregious: "egregious",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeWord = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z'-]/g, "");

const titleCaseWord = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .split(/([-'\s]+)/)
    .map((part) => {
      if (!part || /^[-'\s]+$/.test(part)) {
        return part;
      }
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join("");

const parseArgs = (argv) => {
  const result = {
    wordsPath: DEFAULT_WORDS_PATH,
    inPath: DEFAULT_IN_PATH,
    missingPath: DEFAULT_MISSING_PATH,
    outPath: DEFAULT_OUT_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    skipMisspellingChecks: true,
    misspellingsOnly: false,
    networkMisspellings: false,
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--words=")) {
      result.wordsPath = path.resolve(
        process.cwd(),
        arg.slice("--words=".length),
      );
      return;
    }
    if (arg.startsWith("--in=")) {
      result.inPath = path.resolve(process.cwd(), arg.slice("--in=".length));
      return;
    }
    if (arg.startsWith("--missing=")) {
      result.missingPath = path.resolve(
        process.cwd(),
        arg.slice("--missing=".length),
      );
      return;
    }
    if (arg.startsWith("--out=")) {
      result.outPath = path.resolve(process.cwd(), arg.slice("--out=".length));
      return;
    }
    if (arg.startsWith("--report=")) {
      result.reportPath = path.resolve(
        process.cwd(),
        arg.slice("--report=".length),
      );
      return;
    }
    if (arg === "--with-misspellings") {
      result.skipMisspellingChecks = false;
      return;
    }
    if (arg === "--skip-misspellings") {
      result.skipMisspellingChecks = true;
      return;
    }
    if (arg === "--misspellings-only") {
      result.misspellingsOnly = true;
      return;
    }
    if (arg === "--network-misspellings") {
      result.networkMisspellings = true;
      return;
    }

    throw new Error(`Unknown argument: ${arg}`);
  });

  [result.wordsPath, result.inPath, result.missingPath].forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Required input file not found: ${filePath}`);
    }
  });

  return result;
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const readOriginalWords = (wordsPath) => {
  const raw = readJson(wordsPath);
  if (!Array.isArray(raw)) {
    throw new Error(`Expected array in lesson words file: ${wordsPath}`);
  }

  const originalForms = new Map();
  raw.forEach((entry) => {
    const original = String((entry && entry.word) || "").trim();
    const normalized = normalizeWord(original);
    if (!normalized || originalForms.has(normalized)) {
      return;
    }
    originalForms.set(normalized, original);
  });

  return originalForms;
};

const buildTitleVariants = (word, originalWord) => {
  const normalized = normalizeWord(word);
  const original = String(originalWord || "").trim();
  const variants = [titleCaseWord(normalized), normalized.toUpperCase()];

  if (original) {
    variants.unshift(original);
  }

  return [...new Set(variants.filter(Boolean))];
};

const chunkArray = (values, size) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const fetchJson = async (url, attempt = 1) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "sound-spell-type-online/1.0 (definition enrichment)",
      },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);

    if (attempt < 3 && error && error.name === "AbortError") {
      await sleep(500 * attempt);
      return fetchJson(url, attempt + 1);
    }

    throw error;
  }

  clearTimeout(timeoutId);

  if (response.ok) {
    return response.json();
  }

  if (attempt < 5 && (response.status === 429 || response.status >= 500)) {
    const retryAfterHeader = Number(response.headers.get("retry-after") || "0");
    const retryDelayMs =
      retryAfterHeader > 0 ? retryAfterHeader * 1000 : 1000 * attempt;
    await sleep(retryDelayMs);
    return fetchJson(url, attempt + 1);
  }

  throw new Error(`Request failed (${response.status}) for ${url}`);
};

const summarizeExtract = (extract) => {
  const text = String(extract || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences || sentences.length === 0) {
    return text.slice(0, 280).trim();
  }

  const first = sentences[0].trim();
  const second = sentences[1] ? sentences[1].trim() : "";
  const combined = second ? `${first} ${second}` : first;
  if (combined.length <= 280) {
    return combined;
  }
  return first;
};

const isDisambiguationPage = (page, summary) => {
  if (!page || typeof page !== "object") {
    return true;
  }

  if (
    page.missing ||
    (page.pageprops && page.pageprops.disambiguation !== undefined)
  ) {
    return true;
  }

  return /may refer to:?$|may refer to\b/i.test(String(summary || "").trim());
};

const collectPageMappings = (query) => {
  const redirects = new Map();
  const normalized = new Map();

  (query.normalized || []).forEach((item) => {
    redirects.set(String(item.from || ""), String(item.to || ""));
    normalized.set(String(item.from || ""), String(item.to || ""));
  });

  (query.redirects || []).forEach((item) => {
    redirects.set(String(item.from || ""), String(item.to || ""));
  });

  return { redirects, normalized };
};

const resolveCandidateTitle = (candidate, redirects) => {
  let current = candidate;
  const seen = new Set();

  while (redirects.has(current) && !seen.has(current)) {
    seen.add(current);
    current = redirects.get(current);
  }

  return current;
};

const fetchWikipediaSummaries = async (words, originalForms) => {
  const wordCandidates = new Map();
  const titleToWords = new Map();

  words.forEach((word) => {
    const candidates = buildTitleVariants(word, originalForms.get(word));
    wordCandidates.set(word, candidates);
    candidates.forEach((candidate) => {
      const existing = titleToWords.get(candidate) || [];
      existing.push(word);
      titleToWords.set(candidate, existing);
    });
  });

  const allTitles = [...titleToWords.keys()];
  const pageResults = new Map();
  const requests = chunkArray(allTitles, MAX_TITLES_PER_REQUEST);

  for (let index = 0; index < requests.length; index += 1) {
    const titles = requests[index];
    const url = new URL(WIKIPEDIA_API_URL);
    url.searchParams.set("action", "query");
    url.searchParams.set("prop", "extracts|description|pageprops|info");
    url.searchParams.set("exintro", "1");
    url.searchParams.set("explaintext", "1");
    url.searchParams.set("redirects", "1");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("inprop", "url");
    url.searchParams.set("titles", titles.join("|"));

    const payload = await fetchJson(url.toString());
    const query = payload && payload.query ? payload.query : {};
    const { redirects, normalized } = collectPageMappings(query);
    const pages = Array.isArray(query.pages) ? query.pages : [];
    const pagesByTitle = new Map(
      pages.map((page) => [String(page.title || ""), page]),
    );

    titles.forEach((candidate) => {
      const normalizedTitle = normalized.get(candidate) || candidate;
      const resolvedTitle = resolveCandidateTitle(normalizedTitle, redirects);
      const page = pagesByTitle.get(resolvedTitle);
      if (!page) {
        return;
      }

      const summary = summarizeExtract(page.extract);
      if (!summary || isDisambiguationPage(page, summary)) {
        return;
      }

      pageResults.set(candidate, {
        title: String(page.title || resolvedTitle).trim(),
        summary,
        description: String(page.description || "").trim(),
        canonicalUrl: String(page.fullurl || "").trim(),
      });
    });

    console.log(`Wikipedia summary batches: ${index + 1}/${requests.length}`);

    if (index + 1 < requests.length) {
      await sleep(250);
    }
  }

  const matches = new Map();
  words.forEach((word) => {
    const candidates = wordCandidates.get(word) || [];
    const match = candidates
      .map((candidate) => pageResults.get(candidate) || null)
      .find(Boolean);
    if (!match) {
      return;
    }

    matches.set(word, {
      definition: match.summary,
      exampleSentence: "",
      partOfSpeech: String(match.description || "").trim(),
      source: "wikipedia-summary",
      sourceTitle: match.title,
      sourceUrl:
        match.canonicalUrl ||
        `https://en.wikipedia.org/wiki/${encodeURIComponent(match.title)}`,
    });
  });

  return matches;
};

const damerauLevenshteinDistance = (left, right) => {
  const a = String(left || "");
  const b = String(right || "");
  const rows = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );

  for (let i = 0; i <= a.length; i += 1) {
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    rows[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + substitutionCost,
      );

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }

  return rows[a.length][b.length];
};

const areLikelyRelatedTypos = (word, suggestion) => {
  const normalizedWord = normalizeWord(word);
  const normalizedSuggestion = normalizeWord(suggestion);
  if (!normalizedWord || !normalizedSuggestion) {
    return false;
  }

  const prefixLen = Math.min(
    3,
    normalizedWord.length,
    normalizedSuggestion.length,
  );
  if (
    prefixLen >= 2 &&
    normalizedWord.slice(0, prefixLen) !==
      normalizedSuggestion.slice(0, prefixLen)
  ) {
    return false;
  }

  return true;
};

const isLikelyMisspelling = (word, suggestion) => {
  const normalizedWord = normalizeWord(word);
  const normalizedSuggestion = normalizeWord(suggestion);
  if (
    !normalizedWord ||
    !normalizedSuggestion ||
    normalizedWord === normalizedSuggestion ||
    normalizedWord.length < MISSPELLING_MIN_LENGTH
  ) {
    return false;
  }

  if (!areLikelyRelatedTypos(normalizedWord, normalizedSuggestion)) {
    return false;
  }

  const distance = damerauLevenshteinDistance(
    normalizedWord,
    normalizedSuggestion,
  );
  const maxDistance = normalizedWord.length >= 9 ? 3 : 2;
  return distance <= maxDistance;
};

const findRedirectMisspelling = async (word) => {
  const url = new URL(WIKIPEDIA_API_URL);
  url.searchParams.set("action", "query");
  url.searchParams.set("titles", word);
  url.searchParams.set("redirects", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");

  const payload = await fetchJson(url.toString());
  const query = payload && payload.query ? payload.query : {};
  const redirects = Array.isArray(query.redirects) ? query.redirects : [];
  const redirect = redirects[0] || null;
  const from = String((redirect && redirect.from) || "").trim();
  const to = String((redirect && redirect.to) || "").trim();
  if (!from || !to || normalizeWord(from) !== normalizeWord(word)) {
    return null;
  }

  if (!isLikelyMisspelling(word, to)) {
    return null;
  }

  return {
    word,
    suggestion: to,
    distance: damerauLevenshteinDistance(
      normalizeWord(word),
      normalizeWord(to),
    ),
    method: "wikipedia-redirect",
    confidence: "high",
  };
};

const findLikelyMisspelling = async (word, options = {}) => {
  const normalizedWord = normalizeWord(word);
  const localSuggestion = LOCAL_TYPO_CORRECTIONS[normalizedWord];
  if (localSuggestion && isLikelyMisspelling(word, localSuggestion)) {
    return {
      word,
      suggestion: localSuggestion,
      distance: damerauLevenshteinDistance(normalizedWord, localSuggestion),
      method: "local-high-confidence",
      confidence: "high",
    };
  }

  if (!options.useNetwork) {
    return null;
  }

  try {
    const redirectMatch = await findRedirectMisspelling(word);
    if (redirectMatch) {
      return redirectMatch;
    }
  } catch (_error) {
    // fall through to search-based guessing
  }

  const url = new URL(WIKIPEDIA_API_URL);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", word);
  url.searchParams.set("srwhat", "text");
  url.searchParams.set("srlimit", "5");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");

  try {
    const payload = await fetchJson(url.toString());
    const results = payload && payload.query ? payload.query.search : [];
    const candidates = Array.isArray(results)
      ? results
          .map((item) => String((item && item.title) || "").trim())
          .filter(Boolean)
      : [];
    const suggestion = candidates
      .filter((title) => isLikelyMisspelling(word, title))
      .sort((left, right) => {
        const leftDistance = damerauLevenshteinDistance(
          normalizeWord(word),
          normalizeWord(left),
        );
        const rightDistance = damerauLevenshteinDistance(
          normalizeWord(word),
          normalizeWord(right),
        );
        return leftDistance - rightDistance;
      })[0];

    if (!suggestion) {
      return null;
    }

    return {
      word,
      suggestion,
      distance: damerauLevenshteinDistance(
        normalizeWord(word),
        normalizeWord(suggestion),
      ),
      method: "wikipedia-search",
      confidence: "medium",
    };
  } catch (_error) {
    return null;
  }
};

const mapWithConcurrency = async (values, limit, iteratee, onProgress) => {
  const results = new Array(values.length);
  let cursor = 0;
  let completed = 0;

  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (cursor < values.length) {
        const currentIndex = cursor;
        cursor += 1;
        results[currentIndex] = await iteratee(
          values[currentIndex],
          currentIndex,
        );
        completed += 1;
        if (typeof onProgress === "function") {
          onProgress({
            completed,
            total: values.length,
            index: currentIndex,
            value: values[currentIndex],
          });
        }
        if (completed % 50 === 0 || completed === values.length) {
          console.log(
            `Misspelling checks completed: ${completed}/${values.length}`,
          );
        }
      }
    },
  );

  await Promise.all(workers);
  return results;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const originalForms = readOriginalWords(args.wordsPath);
  const outputPayload = readJson(args.inPath);
  const reportPayload = readJson(args.missingPath);
  const words =
    outputPayload && typeof outputPayload === "object" && outputPayload.words
      ? outputPayload.words
      : {};
  const missing = Array.isArray(reportPayload && reportPayload.missing)
    ? reportPayload.missing.map((item) => normalizeWord(item)).filter(Boolean)
    : [];

  console.log(`Wikipedia fallback candidates: ${missing.length}`);

  let wikipediaMatches = new Map();
  let unresolved = missing;
  if (!args.misspellingsOnly) {
    wikipediaMatches = await fetchWikipediaSummaries(missing, originalForms);
    unresolved = missing.filter((word) => !wikipediaMatches.has(word));
  }

  console.log(`Wikipedia matches found: ${wikipediaMatches.size}`);
  console.log(`Unresolved after Wikipedia: ${unresolved.length}`);

  wikipediaMatches.forEach((entry, word) => {
    words[word] = entry;
  });

  let likelyMisspellings = [];
  if (!args.skipMisspellingChecks) {
    const misspellingChecks = await mapWithConcurrency(
      unresolved,
      SEARCH_CONCURRENCY,
      (word) =>
        findLikelyMisspelling(word, {
          useNetwork: args.networkMisspellings,
        }),
      args.misspellingsOnly
        ? ({ completed, total, value }) => {
            if (completed % 25 === 0 || completed === total) {
              console.log(
                `Misspelling worker progress: ${completed}/${total} (last: ${value})`,
              );
            }
          }
        : null,
    );
    likelyMisspellings = misspellingChecks.filter(Boolean);
  }

  writeJson(args.outPath, { words });
  writeJson(args.reportPath, {
    totalLessonWords: Number(reportPayload.totalLessonWords || 0),
    matchedWords: Object.keys(words).length,
    missingWords: unresolved.length,
    wikipediaMatches: wikipediaMatches.size,
    likelyMisspellings: likelyMisspellings.length,
    misspellingSuggestions: likelyMisspellings,
    missing: unresolved,
  });

  console.log(`Likely misspellings flagged: ${likelyMisspellings.length}`);
  console.log(`Updated output file: ${args.outPath}`);
  console.log(`Updated report file: ${args.reportPath}`);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
