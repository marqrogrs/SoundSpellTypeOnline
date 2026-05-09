export const DEFAULT_BUTTONS_THEME = [
  {
    class: "green dark",
    buttons: "A ; a",
  },
  {
    class: "green light",
    buttons: "Q P Z q p z",
  },
  {
    class: "blue light",
    buttons: "W O X w o x",
  },
  {
    class: "blue dark",
    buttons: "S L s l",
  },
  {
    class: "navy light",
    buttons: "E I C e i c ,",
  },
  {
    class: "navy dark",
    buttons: "D K d k",
  },
  {
    class: "gold light",
    buttons: "R U V M r u v m",
  },
  {
    class: "gold dark",
    buttons: "F J f j",
  },
  {
    class: "grey light",
    buttons: "N B H G Y T n b h y g t",
  },
];

export const LEVELS = Array.apply(null, Array(3));
export const LESSON_ACTIVE_WORD_TARGET = 25;
export const LESSON_FLOW_TIMING = {
  // Base inter-syllable pause in ms before speech-rate scaling.
  SYLLABLE_PAUSE_BASE_MS: 320,
  // Floor to keep a short pause even at high speech rates.
  SYLLABLE_PAUSE_MIN_MS: 140,
  // Base pause after each phoneme before advancing cues.
  PHONEME_POST_GAP_BASE_MS: 200,
  // Floor to keep transitions legible at high speech rates.
  PHONEME_POST_GAP_MIN_MS: 80,
  // Hold when first showing a whole word (no spacing).
  WHOLE_WORD_HOLD_MS: 280,
  // Hold after splitting into syllables (before per-syllable grapheme steps).
  SYLLABLES_HOLD_MS: 220,
  // Brief hold before each syllable starts grapheme-by-grapheme playback.
  SYLLABLE_START_HOLD_MS: 100,
  // Hold after collapsing grapheme spacing (while syllable spacing remains).
  POST_GRAPHEME_COLLAPSE_HOLD_MS: 180,
  // Hold after collapsing syllable spacing back to whole-word form.
  POST_SYLLABLE_COLLAPSE_HOLD_MS: 140,
};

export const LESSON_FLOW_TIMING_PRESETS = {
  slower: {
    SYLLABLE_PAUSE_BASE_MS: 420,
    SYLLABLE_PAUSE_MIN_MS: 190,
    PHONEME_POST_GAP_BASE_MS: 260,
    PHONEME_POST_GAP_MIN_MS: 120,
    WHOLE_WORD_HOLD_MS: 360,
    SYLLABLES_HOLD_MS: 300,
    SYLLABLE_START_HOLD_MS: 150,
    POST_GRAPHEME_COLLAPSE_HOLD_MS: 240,
    POST_SYLLABLE_COLLAPSE_HOLD_MS: 200,
  },
  normal: {
    SYLLABLE_PAUSE_BASE_MS: 320,
    SYLLABLE_PAUSE_MIN_MS: 140,
    PHONEME_POST_GAP_BASE_MS: 200,
    PHONEME_POST_GAP_MIN_MS: 80,
    WHOLE_WORD_HOLD_MS: 280,
    SYLLABLES_HOLD_MS: 220,
    SYLLABLE_START_HOLD_MS: 100,
    POST_GRAPHEME_COLLAPSE_HOLD_MS: 180,
    POST_SYLLABLE_COLLAPSE_HOLD_MS: 140,
  },
  faster: {
    SYLLABLE_PAUSE_BASE_MS: 240,
    SYLLABLE_PAUSE_MIN_MS: 100,
    PHONEME_POST_GAP_BASE_MS: 140,
    PHONEME_POST_GAP_MIN_MS: 60,
    WHOLE_WORD_HOLD_MS: 200,
    SYLLABLES_HOLD_MS: 150,
    SYLLABLE_START_HOLD_MS: 80,
    POST_GRAPHEME_COLLAPSE_HOLD_MS: 120,
    POST_SYLLABLE_COLLAPSE_HOLD_MS: 100,
  },
};

export const LESSON_FLOW_TIMING_PRESET_ORDER = ["slower", "normal", "faster"];

export const applyLessonFlowTimingPreset = (presetKey = "normal") => {
  const normalizedKey = String(presetKey || "normal").toLowerCase();
  const selectedKey = LESSON_FLOW_TIMING_PRESETS[normalizedKey]
    ? normalizedKey
    : "normal";

  Object.assign(LESSON_FLOW_TIMING, LESSON_FLOW_TIMING_PRESETS[selectedKey]);
  return selectedKey;
};
export const PHONEMES = {
  AE: "a.mp3",
  AIR: "air.mp3",
  EY: "aa.mp3",
  B: "b.mp3",
  CH: "ch.mp3",
  D: "d.mp3",
  EH: "e.mp3",
  IY: "ee.mp3",
  F: "f.mp3",
  G: "g.mp3",
  HH: "h.mp3",
  IH: "i.mp3",
  AY: "ii.mp3",
  JH: "j.mp3",
  K: "k.mp3",
  L: "l-onset.mp3",
  LL: "l-coda.mp3",
  M: "m.mp3",
  N: "n.mp3",
  NG: "ng.mp3",
  AA: "o.mp3",
  OW: "oo.mp3",
  AO: "au.mp3",
  UH: "oo-foot.mp3",
  AW: "ou.mp3",
  OY: "oy.mp3",
  P: "p.mp3",
  R: "r.mp3",
  AR: "ar.mp3",
  ER: "er.mp3",
  OR: "or.mp3",
  S: "s.mp3",
  SH: "sh.mp3",
  T: "t.mp3",
  TH: "th.mp3",
  DH: "thv.mp3",
  AH: "u.mp3",
  UW: "ew.mp3",
  V: "v.mp3",
  W: "w.mp3",
  Y: "y.mp3",
  Z: "z.mp3",
  ZH: "zh.mp3",
};

//Don't use this unless you want to create a custom clone or json parse/stringify - it WILL get mutated
//https://stackoverflow.com/questions/43074256/changes-to-object-made-with-object-assign-mutates-source-object
export const INIT_PROGRESS_OBJ = {
  0: {
    score: 0,
    completed_words: 0,
    high_score: 0,
    correct_words: [],
    completed: false,
  },
  1: {
    score: 0,
    completed_words: 0,
    high_score: 0,
    correct_words: [],
    completed: false,
  },
  2: {
    score: 0,
    completed_words: 0,
    high_score: 0,
    correct_words: [],
    completed: false,
  },
};

export const LESSON_SECTION_OVERRIDES = {
  1: {
    title: "Short Vowels",
    description:
      "Short Vowels starts with the Home Row keys within real words; phoneme by phoneme. The first digraph (ck) is introduced, as well as, two syllable words with the suffixes s, es, ed, en and ic.",
  },
  2: {
    title: "Blends",
    description:
      "Blends introduces words with consonant blends such as st-, tr-, sm-, dr-, -nd, etc.",
  },
  3: {
    title: "Consonant Teams",
    description:
      "Consonant Teams introduces consonant teams such as sh, th. wh, ch, tch, dge, qu, x ng, as well as introducing the prefix mis-, in-, un- and Double Consonants before suffixes -ed and -ing (top /topped / topping).",
  },
  4: {
    title: "Vowel Teams",
    description:
      "Vowel Teams introduces short vowel teams such as au, aw. oi, oy, ou, ow, oo, as well as introducing the prefixes: con-, dis-, ex-, ad-, an-, en-, em-, and the suffixes: -ful, -less, -ness, -ess, -let, -ive.",
  },
  5: {
    title: "Mixed Teams",
    description:
      "Mixed Teams introduces vowel/consonant teams such as R-Controlled vowels (er, ir, ur, ar, or), W-Controlled (wa-, wor- war-), and Sort C and G, as well as introducing the prefixes: non- and the suffixes: -er, -est, -ine.",
  },
  6: {
    title: "E Power",
    description:
      "E Power introduces the powers of the letter E to influence the sounds of other letters. Silent E to make a short vowel long (mat -mate), make C and G soft (dance, change), make L and V ?legal? (able and love).",
  },
  7: {
    title: "Long Vowels",
    description:
      "Long Vowels focuses on long vowel sounds mostly in multisyllabic words and including long a, e, i, o, u and y (with long i or e sounds).",
  },
  8: {
    title: "Long Vowel Teams",
    description:
      "Long Vowel Teams introduces long vowel teams such as ai, ay, ee, ea, igh, ie, oe, ow, oa, ew, ue.",
  },
  9: {
    title: "Expert Vowels",
    description:
      "Expert Vowels focuses on the less common vowel sound graphemes such as -a in Mama, -i- in radio, and -y in happy, -i-ne in examine and ai-n in certain.",
  },
  10: {
    title: "Expert Teams 1",
    description:
      "Expert Teams 1 focusing on both consonant and consonant-vowel teams found mostly in multisyllabic words such as -ti-, -si-, ci with the sh sound.",
  },
  11: {
    title: "Expert Teams 2",
    description:
      "Expert Teams 2 focusing on both consonant and consonant-vowel teams found mostly in multisyllabic words such as -ti-, -si-, ci with the sh sound, tu- and -ti- with the ch sound, ph with the f sound and ch with the sh and k sounds.",
  },
  12: {
    title: "Silent Letter Teams",
    description:
      "Silent Letter Teams focuses on silent letter teams such as gh in ghost, gu in guard, bt in debt, and ps in psychology.",
  },
};

export const COMMON_PHONEMES = {
  a: "a.mp3",
  b: "b.mp3",
  c: "k.mp3",
  d: "d.mp3",
  e: "e.mp3",
  f: "f.mp3",
  g: "g.mp3",
  h: "h.mp3",
  i: "i.mp3",
  j: "j.mp3",
  k: "k.mp3",
  l: "l-onset.mp3",
  m: "m.mp3",
  n: "n.mp3",
  o: "o.mp3",
  p: "p.mp3",
  q: "k.mp3",
  r: "r.mp3",
  s: "s.mp3",
  t: "t.mp3",
  u: "u.mp3",
  v: "v.mp3",
  w: "w.mp3",
  x: ["k.mp3", "s.mp3"],
  y: "y.mp3",
  z: "z.mp3",
};

export const SUCCESS_MESSAGES = [
  "Yippee!",
  "Woohoo!",
  "Nice!",
  "Way to go!",
  "Good job!",
  "Hip hip hooray!",
  "Awesome work!",
  "Nice one!",
  "Sweet!",
  "Keep it up!",
  "Wow!",
  "You're doing great!",
];

export const FAILURE_MESSAGES = [
  "Uh oh!",
  "Not quite...",
  "Almost",
  "Oops!",
  "Maybe next time.",
  "Hmm... not quite.",
  "Maybe next time...",
  "Almost got it.",
  "Oh no!",
];

export const FUN_FACTS = [
  "There are over 7,000 languages worldwide -- Wow!",
  "At least half of the world's population is bilingual. Cool!",
  "In the country of Papua New Guinea, 840 different languages are spoken.",
  "The English language contains the most words - over 250,000!",
  "The Cambodian language has the longest alphabet with 74 characters! What do you think their keyboards look like?",
  "The Bible is the most translated book in the world. Can you guess the second most translated? Pinocchio!",
  "The first printed book was written in German.",
  "January 8th is Typing Day!",
  "The average person only uses a few hundred words a day in conversation.",
  "The United States has no official language - most people just assume it's English!",
  "About 30% of English words come from French. For example, ballet and RSVP. Can you think of some?",
  "Hawaiians have over 200 different words for rain. Interesting!",
  "The first language spoken in outer space was Russian.",
  "The longest word that can be made using the letter on one row of the keyboard is Typewriter.",
  "The shortest spacebar can be found on a Japanese keyboard. Neat!",
  "The keyboard layout was designed to increase the amount of time it takes to type a word so that the typewriter wouldn't jam!",
  "Most keyboards have a tiny bump on the F and J keys so your fingers can find them easily without looking. Do you have the F and J bumps?",
  "There is a monument to the keyboard in Yekaterinbug, Russia whenere people make wishes by jumping from letter to letter. What would you wish for?",
  "Before the invention of the mouse, keyboards were the only way to interact with the computer. Sounds tough!",
  "The longest English word you can type using only your left hand is stewardess. Try it!",
  "The three most used keys on the keyboard are the spacebar, E and backspace. Neat!",
  "These days, most people call the # symbol a hashtag or pound. The real word for it is octothorpe. Cool!",
  "The world record for typing the English alphabet from A to Z is 1.36 seconds. Wow!",
  "Typing on a manual typewriter was such a big workout that when typists switched from manual to electric, they'd gain about ten pounds a year!",
  "Every time you hit the space bar, another 6 million space bars get hit at the same time. Woah!",
  "The first email ever set contained qwertyuiop - all the letters from the top row of the keyboard. Cool!",
  "One of the most commonly used passwords on Earth is qwerty. So don't use it!",
  "Every 1/10th of a second, 600,000 people will hit the space bar. Wow!",
  "The QWERTY keyboard layout was invented in 1872 for the typewriter.",
  "18 percent of all keyboard strokes are the Spacebar.",
  "The only country whose name can be typed on one row of a keyboard is Peru. The only US state is Alaska.",
];

export const PAYPAL_URL =
  "https://www.paypal.com/donate/?cmd=_donations&business=donate%40soundspeller.com&currency_code=USD";

export const APP_URL = "https://soundspeller-c5e53.web.app/about";
