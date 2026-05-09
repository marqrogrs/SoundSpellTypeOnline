import {
  resolveExplicitGraphemePhonemeMap,
  WORD_GRAPHEME_PHONEME_OVERRIDES,
  buildFallbackPhonemeSequence,
  normalizeWordGraphemeSequence,
} from "./wordAlignment";

describe("normalizeWordGraphemeSequence", () => {
  test("merges trailing U,E into UE for legacy lesson words", () => {
    expect(normalizeWordGraphemeSequence(["I", "M", "B", "U", "E"])).toEqual([
      "I",
      "M",
      "B",
      "UE",
    ]);
    expect(
      normalizeWordGraphemeSequence(["D", "E", "V", "A", "L", "U", "E"]),
    ).toEqual(["D", "E", "V", "A", "L", "UE"]);
  });

  test("merges U,E before trailing suffix graphemes like S and D", () => {
    expect(
      normalizeWordGraphemeSequence(["I", "M", "B", "U", "E", "S"]),
    ).toEqual(["I", "M", "B", "UE", "S"]);
    expect(normalizeWordGraphemeSequence(["G", "L", "U", "E", "D"])).toEqual([
      "G",
      "L",
      "UE",
      "D",
    ]);
  });

  test("still preserves trailing QUE as a single grapheme", () => {
    expect(normalizeWordGraphemeSequence(["Q", "U", "E"])).toEqual(["QUE"]);
  });
});

describe("resolveExplicitGraphemePhonemeMap", () => {
  test("provides the built-in FUTURE override", () => {
    expect(
      resolveExplicitGraphemePhonemeMap({
        word: "future",
        graphemes: ["F", "U", "T", "UR", "E"],
        wordData: {},
      }),
    ).toEqual(WORD_GRAPHEME_PHONEME_OVERRIDES.FUTURE);
  });

  test("normalizes an explicit wordData alignment field", () => {
    expect(
      resolveExplicitGraphemePhonemeMap({
        word: "future",
        graphemes: ["F", "U", "T", "UR", "E"],
        wordData: {
          graphemePhonemeMap: ["f", ["y", "uw"], "ch", "er", "silent"],
        },
      }),
    ).toEqual(["F", ["Y", "UW"], "CH", "ER", null]);
  });

  test("falls back to the built-in override when explicit map length is invalid", () => {
    expect(
      resolveExplicitGraphemePhonemeMap({
        word: "future",
        graphemes: ["F", "U", "T", "UR", "E"],
        wordData: {
          graphemePhonemeMap: ["F", ["Y", "UW"], "CH"],
        },
      }),
    ).toEqual(WORD_GRAPHEME_PHONEME_OVERRIDES.FUTURE);
  });

  test("returns null when no explicit map exists", () => {
    expect(
      resolveExplicitGraphemePhonemeMap({
        word: "capture",
        graphemes: ["C", "A", "P", "T", "UR", "E"],
        wordData: {},
      }),
    ).toBeNull();
  });

  test("provides built-in SCHEDULE override with D+JH on the D grapheme", () => {
    expect(
      resolveExplicitGraphemePhonemeMap({
        word: "schedule",
        graphemes: ["S", "CH", "E", "D", "U", "L", "E"],
        wordData: {},
      }),
    ).toEqual(WORD_GRAPHEME_PHONEME_OVERRIDES.SCHEDULE);
  });

  test("provides built-in MODULE override with D+JH on the D grapheme", () => {
    expect(
      resolveExplicitGraphemePhonemeMap({
        word: "module",
        graphemes: ["M", "O", "D", "U", "L", "E"],
        wordData: {},
      }),
    ).toEqual(WORD_GRAPHEME_PHONEME_OVERRIDES.MODULE);
  });

  test("provides EW family override for NEWSCAST with EW grapheme", () => {
    expect(
      resolveExplicitGraphemePhonemeMap({
        word: "newscast",
        graphemes: ["N", "EW", "S", "C", "A", "S", "T"],
        wordData: {},
      }),
    ).toEqual(WORD_GRAPHEME_PHONEME_OVERRIDES.NEWSCAST);
  });

  test("provides EW family override for STEW with EW grapheme", () => {
    expect(
      resolveExplicitGraphemePhonemeMap({
        word: "stew",
        graphemes: ["S", "T", "EW"],
        wordData: {},
      }),
    ).toEqual(WORD_GRAPHEME_PHONEME_OVERRIDES.STEW);
  });
});

describe("buildFallbackPhonemeSequence", () => {
  // ── silent-final-E (base case) ─────────────────────────────────────────────
  test("STRIPE: final E is silent in an E-Power lesson section", () => {
    // S-T-R-I-P-E  phonemes: S T R AY P
    const result = buildFallbackPhonemeSequence(
      ["S", "T", "R", "I", "P", "E"],
      ["S", "T", "R", "AY", "P"],
      6,
    );
    expect(result).toEqual(["S", "T", "R", "AY", "P", null]);
  });

  // ── silent-E before final D (STRIPED) ──────────────────────────────────────
  // ── consonant-suffix rule: -D and -S (existing coverage) ──────────────────
  test("STRIPED (-D): E before consonant suffix D is silent", () => {
    // S-T-R-I-P-E-D  phonemes: S T R AY P T  (unvoiced -ed after /p/)
    const result = buildFallbackPhonemeSequence(
      ["S", "T", "R", "I", "P", "E", "D"],
      ["S", "T", "R", "AY", "P", "T"],
      6,
    );
    expect(result).toEqual(["S", "T", "R", "AY", "P", null, "T"]);
  });

  test("WAVED (-D voiced): E before consonant suffix D is silent", () => {
    // W-A-V-E-D  phonemes: W EY V D
    const result = buildFallbackPhonemeSequence(
      ["W", "A", "V", "E", "D"],
      ["W", "EY", "V", "D"],
      6,
    );
    expect(result).toEqual(["W", "EY", "V", null, "D"]);
  });

  test("BAKED (-D unvoiced): E before consonant suffix D is silent when phoneme is T", () => {
    // B-A-K-E-D  phonemes: B EY K T  (some pronunciations have unvoiced T)
    const result = buildFallbackPhonemeSequence(
      ["B", "A", "K", "E", "D"],
      ["B", "EY", "K", "T"],
      6,
    );
    expect(result).toEqual(["B", "EY", "K", null, "T"]);
  });

  test("general consonant-suffix rule fires in sections 9 and 11 too", () => {
    const graphemes = ["S", "T", "R", "I", "P", "E", "D"];
    const base = ["S", "T", "R", "AY", "P", "T"];
    expect(buildFallbackPhonemeSequence(graphemes, base, 9)[5]).toBeNull();
    expect(buildFallbackPhonemeSequence(graphemes, base, 11)[5]).toBeNull();
  });

  test("CARVES-like words also keep silent E outside E-Power sections", () => {
    const carves = buildFallbackPhonemeSequence(
      ["C", "AR", "V", "E", "S"],
      ["K", "AR", "V", "Z"],
      3,
    );
    const serves = buildFallbackPhonemeSequence(
      ["S", "ER", "V", "E", "S"],
      ["S", "ER", "V", "Z"],
      3,
    );

    expect(carves).toEqual(["K", "AR", "V", null, "Z"]);
    expect(serves).toEqual(["S", "ER", "V", null, "Z"]);
  });

  // ── silent-E before final S sanity check ──────────────────────────────────
  test("STOVES (-S): E before consonant suffix S is silent via the general rule", () => {
    // S-T-O-V-E-S  phonemes: S T OW V Z
    const result = buildFallbackPhonemeSequence(
      ["S", "T", "O", "V", "E", "S"],
      ["S", "T", "OW", "V", "Z"],
      6,
    );
    expect(result).toEqual(["S", "T", "OW", "V", null, "Z"]);
  });

  test("CURVES (-S): E after r-controlled vowel remains silent before final S", () => {
    // C-UR-V-E-S  phonemes: K ER V Z
    const result = buildFallbackPhonemeSequence(
      ["C", "UR", "V", "E", "S"],
      ["K", "ER", "V", "Z"],
      6,
    );
    expect(result).toEqual(["K", "ER", "V", null, "Z"]);
  });

  test("SERVES and NERVES (-S): E before final S is silent when suffix owns consonant phoneme", () => {
    const serves = buildFallbackPhonemeSequence(
      ["S", "ER", "V", "E", "S"],
      ["S", "ER", "V", "Z"],
      6,
    );
    const nerves = buildFallbackPhonemeSequence(
      ["N", "ER", "V", "E", "S"],
      ["N", "ER", "V", "Z"],
      6,
    );

    expect(serves).toEqual(["S", "ER", "V", null, "Z"]);
    expect(nerves).toEqual(["N", "ER", "V", null, "Z"]);
  });

  test("WAVES, HOPES, CUBES (-S plurals): silent E before final S", () => {
    // W-A-V-E-S  phonemes: W EY V Z
    const waves = buildFallbackPhonemeSequence(
      ["W", "A", "V", "E", "S"],
      ["W", "EY", "V", "Z"],
      6,
    );

    // H-O-P-E-S  phonemes: HH OW P Z
    const hopes = buildFallbackPhonemeSequence(
      ["H", "O", "P", "E", "S"],
      ["HH", "OW", "P", "Z"],
      6,
    );

    // C-U-B-E-S  phonemes: K Y UW B Z
    const cubes = buildFallbackPhonemeSequence(
      ["C", "U", "B", "E", "S"],
      ["K", "Y", "UW", "B", "Z"],
      6,
    );

    expect(waves).toEqual(["W", "EY", "V", null, "Z"]);
    expect(hopes).toEqual(["HH", "OW", "P", null, "Z"]);
    expect(cubes).toEqual(["K", ["Y", "UW"], "B", null, "Z"]);
  });

  test("IMBUE/DEVALUE: final UE grapheme can carry Y+UW together", () => {
    const imbue = buildFallbackPhonemeSequence(
      ["I", "M", "B", "UE"],
      ["IH", "M", "B", "Y", "UW"],
      8,
    );

    const devalue = buildFallbackPhonemeSequence(
      ["D", "E", "V", "A", "L", "UE"],
      ["D", "IY", "V", "AE", "LL", "Y", "UW"],
      8,
    );

    expect(imbue).toEqual(["IH", "M", "B", ["Y", "UW"]]);
    expect(devalue).toEqual(["D", "IY", "V", "AE", "LL", ["Y", "UW"]]);
  });

  test("IMBUES/GLUED: UE stays merged before suffix consonants", () => {
    const imbues = buildFallbackPhonemeSequence(
      ["I", "M", "B", "UE", "S"],
      ["IH", "M", "B", "Y", "UW", "Z"],
      8,
    );

    const glued = buildFallbackPhonemeSequence(
      ["G", "L", "UE", "D"],
      ["G", "L", "UW", "D"],
      8,
    );

    expect(imbues).toEqual(["IH", "M", "B", ["Y", "UW"], "Z"]);
    expect(glued).toEqual(["G", "L", "UW", "D"]);
  });
});

describe("buildFallbackPhonemeSequence – VCE + suffix (new suffixes)", () => {
  // -FUL suffix: HOPEFUL  H-O-P-E-F-UL  phonemes: HH OW P F AH L
  test("HOPEFUL (-FUL): E before F is silent", () => {
    const result = buildFallbackPhonemeSequence(
      ["H", "O", "P", "E", "F", "UL"],
      ["HH", "OW", "P", "F", "AH", "L"],
      6,
    );
    expect(result[3]).toBeNull(); // E is silent
    expect(result[4]).toBe("F"); // F gets its phoneme
  });

  // -LY suffix: TIMELY  T-I-M-E-L-Y  phonemes: T AY M L IY
  test("TIMELY (-LY): E before L is silent", () => {
    const result = buildFallbackPhonemeSequence(
      ["T", "I", "M", "E", "L", "Y"],
      ["T", "AY", "M", "L", "IY"],
      6,
    );
    expect(result).toEqual(["T", "AY", "M", null, "L", "IY"]);
  });

  // -LY suffix: CLOSELY  C-L-O-S-E-L-Y  phonemes: K L OW S L IY
  test("CLOSELY (-LY): E before L is silent", () => {
    const result = buildFallbackPhonemeSequence(
      ["C", "L", "O", "S", "E", "L", "Y"],
      ["K", "L", "OW", "S", "L", "IY"],
      6,
    );
    expect(result[4]).toBeNull(); // E is silent
    expect(result[5]).toBe("L"); // L gets its phoneme
  });

  // -LESS suffix: HOPELESS  H-O-P-E-L-E-SS  phonemes: HH OW P L EH S
  // First E (before -less) is silent; second E (in -ess) has a vowel phoneme and is NOT silent.
  test("HOPELESS (-LESS): first E is silent, second E in -ess is voiced", () => {
    const result = buildFallbackPhonemeSequence(
      ["H", "O", "P", "E", "L", "E", "SS"],
      ["HH", "OW", "P", "L", "EH", "S"],
      6,
    );
    expect(result[3]).toBeNull(); // first E: silent
    expect(result[4]).toBe("L"); // L gets its phoneme
    expect(result[5]).toBe("EH"); // second E in -ess: voiced
    expect(result[6]).toBe("S"); // SS
  });

  // -MENT suffix: MOVEMENT  M-O-V-E-M-E-N-T  phonemes: M UW V M AH N T
  // First E (before -ment) is silent; second E (in -ent) has a vowel phoneme and is NOT silent.
  test("MOVEMENT (-MENT): VCE E is silent, schwa E in -ent is voiced", () => {
    const result = buildFallbackPhonemeSequence(
      ["M", "O", "V", "E", "M", "E", "N", "T"],
      ["M", "UW", "V", "M", "AH", "N", "T"],
      6,
    );
    expect(result[3]).toBeNull(); // VCE E: silent
    expect(result[4]).toBe("M"); // M gets its phoneme
    expect(result[5]).toBe("AH"); // schwa E in -ent: voiced
  });

  // Rule fires in all three E-Power sections
  test("-FUL rule fires in sections 6, 9, and 11", () => {
    const g = ["H", "O", "P", "E", "F", "UL"];
    const p = ["HH", "OW", "P", "F", "AH", "L"];
    expect(buildFallbackPhonemeSequence(g, p, 6)[3]).toBeNull();
    expect(buildFallbackPhonemeSequence(g, p, 9)[3]).toBeNull();
    expect(buildFallbackPhonemeSequence(g, p, 11)[3]).toBeNull();
  });

  // Rule must NOT fire when the mapped phoneme is a vowel (non-VCE E)
  test("E with a vowel phoneme is NOT silenced (not a VCE pattern)", () => {
    // Hypothetical word where E has a vowel phoneme EH at cursor
    const result = buildFallbackPhonemeSequence(
      ["S", "E", "V", "E", "N"],
      ["S", "EH", "V", "AH", "N"],
      6,
    );
    expect(result[1]).toBe("EH"); // first E is voiced
  });
});
