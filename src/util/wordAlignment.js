const WORD_GRAPHEME_PHONEME_OVERRIDES = Object.freeze({
  FUTURE: ["F", ["Y", "UW"], "CH", "ER", null],
  FUTURES: ["F", ["Y", "UW"], "CH", "ER", null, "Z"],
  FUTURISM: ["F", ["Y", "UW"], "CH", "ER", "IH", "Z", "M", null],
  FUTURIST: ["F", ["Y", "UW"], "CH", "ER", "IH", "S", "T", null],
  FUTURISTIC: ["F", ["Y", "UW"], "CH", "ER", "IH", "S", "T", "IH", "K", null],
  BREW: ["B", "R", "UW"],
  BREWER: ["B", "R", "UW", "ER"],
  BREWING: ["B", "R", "UW", "IH", "NG"],
  CHEW: ["CH", "UW"],
  CHEWER: ["CH", "UW", "ER"],
  CHEWING: ["CH", "UW", "IH", "NG"],
  DREW: ["D", "R", "UW"],
  FLEW: ["F", "L", "UW"],
  GREW: ["G", "R", "UW"],
  NEW: ["N", "UW"],
  NEWSCAST: ["N", "UW", "Z", "K", "AE", "S", "T"],
  NEWSCASTER: ["N", "UW", "Z", "K", "AE", "S", "T", "ER"],
  NEWSCASTS: ["N", "UW", "Z", "K", "AE", "S", "T", "S"],
  NEWT: ["N", "UW", "T"],
  NEWTON: ["N", "UW", "T", "AA", "N"],
  SCREW: ["S", "K", "R", "UW"],
  SCREWED: ["S", "K", "R", "UW", "D"],
  SCREWING: ["S", "K", "R", "UW", "IH", "NG"],
  SCREWS: ["S", "K", "R", "UW", "Z"],
  STEW: ["S", "T", "UW"],
  STEWARD: ["S", "T", "UW", "ER", "D"],
  STEWARDESS: ["S", "T", "UW", "ER", "D", "EH", "S"],
  STEWED: ["S", "T", "UW", "D"],
  STEWING: ["S", "T", "UW", "IH", "NG"],
  MODULE: ["M", "AA", ["D", "JH"], "UW", "LL", null],
  MODULES: ["M", "AA", ["D", "JH"], "UW", "LL", "S"],
  RESCHEDULE: ["R", "IY", "S", "K", "EH", ["D", "JH"], "UW", "LL", null],
  RESCHEDULED: ["R", "IY", "S", "K", "EH", ["D", "JH"], "UW", "LL", "D"],
  SCHEDULE: ["S", "K", "EH", ["D", "JH"], "UW", "LL", null],
  SCHEDULED: ["S", "K", "EH", ["D", "JH"], "UW", "LL", "D"],
  SCHEDULER: ["S", "K", "EH", ["D", "JH"], "UW", "LL", "ER"],
  SCHEDULERS: ["S", "K", "EH", ["D", "JH"], "UW", "LL", "ER", "Z"],
  SCHEDULES: ["S", "K", "EH", ["D", "JH"], "UW", "LL", null, "Z"],
  UNSCHEDULED: ["AH", "N", "S", "K", "EH", ["D", "JH"], "UW", "LL", "D"],
});

// ONE-family: O maps to both W and AH (the /wʌ/ combination); E is silent.
const ONE_FAMILY_OVERRIDES = Object.freeze({
  ONE: [["W", "AH"], "N", null],
  ONES: [["W", "AH"], "N", null, "Z"],
  ONCE: [["W", "AH"], "N", "S", null],
  ANYONE: ["EH", "N", "IY", ["W", "AH"], "N", null],
  EVERYONE: ["EH", "V", "ER", "IY", ["W", "AH"], "N", null],
  SOMEONE: ["S", "AH", "M", null, ["W", "AH"], "N", null],
});

const normalizeAlignmentEntry = (entry) => {
  if (Array.isArray(entry)) {
    const normalizedItems = entry
      .map((item) => normalizeAlignmentEntry(item))
      .flat()
      .filter(Boolean);

    return normalizedItems.length ? normalizedItems : null;
  }

  if (entry == null) {
    return null;
  }

  const raw = String(entry).trim();
  if (!raw || raw === "-" || raw.toLowerCase() === "silent") {
    return null;
  }

  if (/\.mp3$/i.test(raw)) {
    return raw.toLowerCase();
  }

  const cleaned = raw.toUpperCase().replace(/[0-9]/g, "");
  return cleaned || null;
};

const normalizeAlignmentSequence = (sequence) => {
  if (!Array.isArray(sequence)) {
    return null;
  }

  return sequence.map((entry) => normalizeAlignmentEntry(entry));
};

export const normalizeWordGraphemeSequence = (graphemes) => {
  const trailingUeSuffixGraphemes = new Set(["S", "D"]);

  return (Array.isArray(graphemes) ? graphemes : [])
    .map((grapheme) => String(grapheme || "").trim())
    .filter(Boolean)
    .flatMap((grapheme) => {
      const upper = grapheme.toUpperCase();

      if (upper === "EDGE" || upper === "ENDGE") {
        return ["E", "DGE"];
      }

      return [upper];
    })
    .reduce((acc, grapheme, index, source) => {
      if (
        index >= source.length - 3 &&
        source[source.length - 3] === "Q" &&
        source[source.length - 2] === "U" &&
        source[source.length - 1] === "E"
      ) {
        if (index === source.length - 3) {
          acc.push("QUE");
        }
        return acc;
      }

      if (
        index >= source.length - 2 &&
        source[source.length - 2] === "U" &&
        source[source.length - 1] === "E"
      ) {
        if (index === source.length - 2) {
          acc.push("UE");
        }
        return acc;
      }

      if (
        index >= source.length - 3 &&
        source[source.length - 3] === "U" &&
        source[source.length - 2] === "E" &&
        trailingUeSuffixGraphemes.has(source[source.length - 1])
      ) {
        if (index === source.length - 3) {
          acc.push("UE");
        }
        if (index === source.length - 1) {
          acc.push(source[source.length - 1]);
        }
        return acc;
      }

      if (
        index === source.length - 1 &&
        source[index - 1] === "EW" &&
        grapheme === "W"
      ) {
        return acc;
      }

      acc.push(grapheme);
      return acc;
    }, []);
};

// Phoneme tokens that represent vowel sounds.  Any normalised token NOT in
// this set is treated as consonantal by buildFallbackPhonemeSequence.
const VOWEL_PHONEME_TOKENS = new Set([
  "AE",
  "AH",
  "AO",
  "AW",
  "AY",
  "EH",
  "ER",
  "EY",
  "IH",
  "IY",
  "OW",
  "OY",
  "UH",
  "UW",
]);

export const resolveExplicitGraphemePhonemeMap = ({
  word,
  graphemes,
  wordData,
}) => {
  const safeGraphemes = Array.isArray(graphemes) ? graphemes : [];
  if (!safeGraphemes.length) {
    return null;
  }

  const normalizedWord = String(word || "")
    .trim()
    .toUpperCase();

  const candidates = [
    wordData?.graphemePhonemeMap,
    wordData?.graphemePhonemeAlignment,
    WORD_GRAPHEME_PHONEME_OVERRIDES[normalizedWord],
    ONE_FAMILY_OVERRIDES[normalizedWord],
  ];

  for (const candidate of candidates) {
    const normalized = normalizeAlignmentSequence(candidate);
    if (!normalized) {
      continue;
    }

    if (normalized.length !== safeGraphemes.length) {
      continue;
    }

    return normalized;
  }

  return null;
};

/**
 * Builds the fallback per-grapheme phoneme sequence used when no explicit
 * grapheme-phoneme map is available for a word.  The same logic lives inside
 * the OutputWord flow callback; exposing it here makes it unit-testable.
 *
 * @param {string[]} graphemes          - Ordered grapheme list for the word.
 * @param {(string|null)[]} basePhonemes - Pre-normalised phoneme list from wordData.
 * @param {number|null} lessonSection   - Numeric lesson section (6/9/11 = E-Power).
 * @param {function} coercePhoneme      - Optional per-(grapheme, phoneme) coercion.
 * @returns {(string|string[]|null)[]}  - One entry per grapheme; null = silent.
 */
export const buildFallbackPhonemeSequence = (
  graphemes,
  basePhonemes,
  lessonSection,
  coercePhoneme = (_grapheme, phoneme) => phoneme,
) => {
  const safeGraphemes = Array.isArray(graphemes) ? graphemes : [];
  const safeBase = Array.isArray(basePhonemes) ? basePhonemes : [];
  let phonemeCursor = 0;

  return safeGraphemes.map((grapheme, index) => {
    const normalizedGrapheme = String(grapheme || "")
      .trim()
      .toUpperCase();
    const nextGrapheme = String(safeGraphemes[index + 1] || "")
      .trim()
      .toUpperCase();
    const isPenultimateGrapheme = index === safeGraphemes.length - 2;
    const isFinalGrapheme = index === safeGraphemes.length - 1;
    const mappedPhoneme =
      phonemeCursor < safeBase.length ? safeBase[phonemeCursor] : undefined;

    const normalizeToken = (t) => {
      if (t == null || Array.isArray(t)) return t;
      return String(t)
        .toUpperCase()
        .replace(/\.MP3$/i, "")
        .replace(/[0-9]/g, "");
    };

    const isEPowerSection =
      lessonSection === 6 || lessonSection === 9 || lessonSection === 11;

    const isSilentFinalE =
      isEPowerSection && isFinalGrapheme && normalizedGrapheme === "E";

    // A VCE word's E is silent whenever the phoneme cursor is pointing at a
    // consonant – meaning the consonant phoneme belongs to the following
    // suffix (-FUL, -LY, -LESS, -MENT, -S, -D, …), not the E.
    const normedMappedPhoneme = normalizeToken(mappedPhoneme);
    const isSilentEBeforeConsonantSuffix =
      !isFinalGrapheme &&
      normalizedGrapheme === "E" &&
      nextGrapheme.length > 0 &&
      !"AEIOU".includes(nextGrapheme[0] || "") &&
      typeof normedMappedPhoneme === "string" &&
      normedMappedPhoneme.length > 0 &&
      !VOWEL_PHONEME_TOKENS.has(normedMappedPhoneme);

    const isCodaLBeforeSilentE =
      lessonSection === 6 &&
      isPenultimateGrapheme &&
      normalizedGrapheme === "L" &&
      nextGrapheme === "E";

    const isFinalLE =
      lessonSection === 6 && isFinalGrapheme && normalizedGrapheme === "LE";

    if (isSilentFinalE || isSilentEBeforeConsonantSuffix) {
      return null;
    }

    if (isCodaLBeforeSilentE || isFinalLE) {
      if (phonemeCursor < safeBase.length) {
        phonemeCursor += 1;
      }
      return "LL";
    }

    if (isFinalGrapheme && normalizedGrapheme === "QUE") {
      if (phonemeCursor < safeBase.length) {
        phonemeCursor += 1;
      }
      return "K";
    }

    const coerced = coercePhoneme(
      grapheme,
      mappedPhoneme === undefined ? null : mappedPhoneme,
    );

    const nextMappedPhoneme =
      phonemeCursor + 1 < safeBase.length
        ? safeBase[phonemeCursor + 1]
        : undefined;

    const isUThatCarriesYoo =
      normalizedGrapheme === "U" &&
      normalizeToken(mappedPhoneme) === "Y" &&
      normalizeToken(nextMappedPhoneme) === "UW";

    const isUeThatCarriesYoo =
      normalizedGrapheme === "UE" &&
      normalizeToken(mappedPhoneme) === "Y" &&
      normalizeToken(nextMappedPhoneme) === "UW";

    const isXThatCarriesKs =
      normalizedGrapheme === "X" &&
      normalizeToken(coerced) === "K" &&
      normalizeToken(nextMappedPhoneme) === "S";

    const isXThatCarriesGz =
      normalizedGrapheme === "X" &&
      normalizeToken(coerced) === "G" &&
      normalizeToken(nextMappedPhoneme) === "Z";

    // UR grapheme maps to both Y and ER phonemes (FIGURE, PURE, CURE, SECURITY, …)
    const isURThatCarriesYer =
      normalizedGrapheme === "UR" &&
      normalizeToken(coerced) === "Y" &&
      normalizeToken(nextMappedPhoneme) === "ER";

    if (isUThatCarriesYoo || isUeThatCarriesYoo) {
      phonemeCursor += 2;
      return [mappedPhoneme, nextMappedPhoneme];
    }

    if (isXThatCarriesKs || isXThatCarriesGz) {
      phonemeCursor += 2;
      return [coerced, nextMappedPhoneme];
    }

    if (isURThatCarriesYer) {
      phonemeCursor += 2;
      return [coerced, nextMappedPhoneme];
    }

    if (mappedPhoneme !== undefined) {
      phonemeCursor += 1;
    }

    return coerced;
  });
};

export { WORD_GRAPHEME_PHONEME_OVERRIDES };
