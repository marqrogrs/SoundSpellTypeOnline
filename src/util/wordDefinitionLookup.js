const WIKTIONARY_DATA_URL = "/wiktionary-definitions.json";

let wiktionaryDataPromise = null;

const normalizeWord = (value) => {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z'-]/g, "");
};

const toDisplayWord = (value) => {
  return String(value || "")
    .trim()
    .replace(/[_\s]+/g, " ");
};

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
    candidates.push(normalized.slice(0, -2));
  }
  if (normalized.endsWith("ing") && normalized.length > 3) {
    candidates.push(normalized.slice(0, -3));
  }

  return [...new Set(candidates.filter(Boolean))];
};

const loadWiktionaryData = async () => {
  if (!wiktionaryDataPromise) {
    wiktionaryDataPromise = fetch(WIKTIONARY_DATA_URL, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Failed loading local Wiktionary data (${response.status}).`,
          );
        }
        return response.json();
      })
      .then((payload) => {
        const words =
          payload && typeof payload === "object" ? payload.words : null;
        if (!words || typeof words !== "object") {
          throw new Error(
            "Local Wiktionary payload is missing a words object.",
          );
        }
        return words;
      });
  }

  return wiktionaryDataPromise;
};

export const lookupWordDefinition = async (word) => {
  const words = await loadWiktionaryData();
  const candidateKeys = buildCandidateKeys(word);

  for (let i = 0; i < candidateKeys.length; i += 1) {
    const key = candidateKeys[i];
    const entry = words[key];
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const definition = String(entry.definition || "").trim();
    const exampleSentenceRaw = String(entry.exampleSentence || "").trim();
    const partOfSpeech = String(entry.partOfSpeech || "").trim();

    if (!definition) {
      continue;
    }

    const resolvedWord = String(word || "").trim() || key;
    const exampleSentence = exampleSentenceRaw;

    return {
      lookupKey: key,
      word: resolvedWord,
      definition,
      exampleSentence,
      partOfSpeech,
      source: "wiktionary-local",
    };
  }

  return null;
};

export const clearWordDefinitionCache = () => {
  wiktionaryDataPromise = null;
};
