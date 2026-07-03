import { Typography } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import React, {
  useEffect,
  useLayoutEffect,
  useContext,
  useRef,
  useCallback,
  useState,
} from "react";
import { LessonContext } from "../providers/LessonProvider";
import {
  speakWordSlow,
  playStartBells,
  speakPhoneme,
  primeAudioPlayback,
  SPEECH_RATE,
  terminateAudio,
  setPlayAudio,
} from "../util/Audio";
import { COMMON_PHONEMES, LESSON_FLOW_TIMING } from "../util/constants";
import {
  resolveExplicitGraphemePhonemeMap,
  buildFallbackPhonemeSequence,
  normalizeWordGraphemeSequence,
} from "../util/wordAlignment";
import { buildKeyboardCuePressPlan } from "../util/keyboardCue";
import { db } from "../firebase";
import simulateEvent from "simulate-event";

const WORD_DISPLAY_PHASE = {
  WHOLE_WORD: "whole-word",
  SYLLABLES: "syllables",
  SYLLABLE_GRAPHEMES: "syllable-graphemes",
};

const SYLLABLE_GAP_EM = "0.8em";
const GRAPHEME_GAP_EM = "0.55em";

const useStyles = makeStyles({
  outputContainer: {
    alignItems: "center",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    width: "100%",
    overflow: "hidden",
  },
  phoneme: {
    color: "#0d47a1",
    fontWeight: 700,
    minHeight: 40,
    textAlign: "center",
  },
  word: {
    color: "#002ca0",
    alignSelf: "center",
    textAlign: "center",
    width: "100%",
    maxWidth: "100%",
    whiteSpace: "nowrap",
    wordBreak: "keep-all",
    overflowWrap: "normal",
    overflow: "hidden",
    margin: 0,
    lineHeight: 1.1,
  },
  grapheme: {
    display: "inline-block",
    opacity: 0.45,
    transform: "scale(1)",
    transition: "opacity 120ms ease, transform 120ms ease, color 120ms ease",
  },
  graphemeVisible: {
    opacity: 1,
  },
  graphemeActive: {
    color: "#d32f2f",
    transform: "scale(1.08)",
  },
});

export default function OutputWord({
  wordString,
  index,
  wordNumber = 1,
  onReadyForInput,
  onFlowEvent,
  flowRunId,
}) {
  const classes = useStyles();
  const { currentLesson } = useContext(LessonContext);
  const lessonLevel = Number(currentLesson?.level ?? 0);
  const lessonSection = Number(currentLesson?.lesson?.lesson_section ?? 0);
  const isCustomLesson = Boolean(currentLesson?.lesson?.isCustomLesson);
  const lessonId = String(currentLesson?.lesson?.lesson_id ?? "");
  const wordCacheRef = useRef(new Map());
  const activeFlowKeyRef = useRef(null);
  const completedFlowKeyRef = useRef(null);
  const outputContainerRef = useRef(null);
  const wordRef = useRef(null);
  const [displayedGraphemeUnits, setDisplayedGraphemeUnits] = useState([]);
  const [, setActivePhoneme] = useState("");
  const [activeStepIndex, setActiveStepIndex] = useState(-1);
  const [activeSyllableIndex, setActiveSyllableIndex] = useState(-1);
  const [wordDisplayPhase, setWordDisplayPhase] = useState(
    WORD_DISPLAY_PHASE.WHOLE_WORD,
  );
  const [wordFontSize, setWordFontSize] = useState(72);

  const fitWordToContainer = useCallback(() => {
    const containerEl = outputContainerRef.current;
    const wordEl = wordRef.current;
    if (!containerEl || !wordEl) {
      return;
    }

    const MAX_FONT = 72;
    const MIN_FONT = 56;
    const availableWidth = Math.max(0, containerEl.clientWidth - 12);

    let nextFontSize = MAX_FONT;
    wordEl.style.fontSize = `${nextFontSize}px`;
    while (nextFontSize > MIN_FONT && wordEl.scrollWidth > availableWidth) {
      nextFontSize -= 1;
      wordEl.style.fontSize = `${nextFontSize}px`;
    }
    setWordFontSize(nextFontSize);
  }, []);

  useLayoutEffect(() => {
    fitWordToContainer();
  }, [fitWordToContainer, displayedGraphemeUnits, activeStepIndex]);

  useEffect(() => {
    const handleResize = () => {
      fitWordToContainer();
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [fitWordToContainer]);

  const onReadyForInputRef = useRef(onReadyForInput);
  useEffect(() => {
    onReadyForInputRef.current = onReadyForInput;
  });

  const onFlowEventRef = useRef(onFlowEvent);
  useEffect(() => {
    onFlowEventRef.current = onFlowEvent;
  });

  const reportFlowEvent = useCallback(
    (phase, details = {}) => {
      if (typeof onFlowEventRef.current === "function") {
        onFlowEventRef.current({
          phase,
          word: wordString,
          index,
          level: lessonLevel,
          lessonSection,
          details,
        });
      }
    },
    [wordString, index, lessonLevel, lessonSection],
  );

  const signalReadyForInput = useCallback(() => {
    if (typeof onReadyForInputRef.current === "function") {
      onReadyForInputRef.current();
      return;
    }
    simulateEvent.simulate(document.body, "keydown", { key: "esc" });
  }, []);

  const pressKey = useCallback((key) => {
    return new Promise((resolve) => {
      window.dispatchEvent(
        new CustomEvent("soundspeller-key-press", {
          detail: { key },
        }),
      );
      setTimeout(resolve, 400 / SPEECH_RATE);
    });
  }, []);

  const unpressKey = useCallback((key) => {
    return new Promise((resolve) => {
      window.dispatchEvent(
        new CustomEvent("soundspeller-key-release", {
          detail: { key },
        }),
      );
      resolve();
    });
  }, []);

  const renderKeyPress = useCallback(
    async (key) => {
      const letters = Array.from(String(key || ""));
      for (const letter of letters) {
        await pressKey(letter);
        await unpressKey(letter);
      }
    },
    [pressKey, unpressKey],
  );

  const formatDisplayGraphemes = useCallback(
    (graphemes) =>
      (Array.isArray(graphemes) ? graphemes : [])
        .map((grapheme) =>
          String(grapheme || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    [],
  );

  const formatDisplayPhoneme = useCallback((phoneme) => {
    if (Array.isArray(phoneme)) {
      return phoneme
        .map((item) => formatDisplayPhoneme(item))
        .filter(Boolean)
        .join(" + ");
    }
    const normalized = String(phoneme || "").trim();
    if (!normalized) {
      return "";
    }
    return normalized.replace(/\.mp3$/i, "").toUpperCase();
  }, []);

  const normalizePhoneme = useCallback((phoneme) => {
    // Handle Firestore DocumentReference objects by extracting their document ID
    const resolved =
      phoneme && typeof phoneme === "object" && typeof phoneme.id === "string"
        ? phoneme.id
        : phoneme;
    if (typeof resolved !== "string") {
      return null;
    }
    const raw = resolved.trim();
    if (!raw) {
      return null;
    }

    // Some word docs store phonemes as explicit audio file names (e.g. "k.mp3").
    // Preserve that format so resolvePhonemeAudioFile can load the clip directly.
    if (/\.mp3$/i.test(raw)) {
      return raw.toLowerCase();
    }

    const cleaned = raw.toUpperCase().replace(/[0-9]/g, "");
    return cleaned.length > 0 ? cleaned : null;
  }, []);

  const normalizePhonemeToken = useCallback((phoneme) => {
    // Handle Firestore DocumentReference objects by extracting their document ID
    const resolved =
      phoneme && typeof phoneme === "object" && typeof phoneme.id === "string"
        ? phoneme.id
        : phoneme;
    const raw = String(resolved || "").trim();
    if (!raw) {
      return "";
    }
    return raw
      .toUpperCase()
      .replace(/\.MP3$/i, "")
      .replace(/[0-9]/g, "");
  }, []);

  const mergeTerminalNgGrapheme = useCallback(
    (graphemes, phonemes) => {
      const safeGraphemes = Array.isArray(graphemes) ? graphemes : [];
      if (safeGraphemes.length < 2) {
        return safeGraphemes;
      }

      const phonemeTokens = (Array.isArray(phonemes) ? phonemes : [])
        .filter((phoneme) => phoneme !== "-")
        .map((phoneme) => normalizePhonemeToken(phoneme))
        .filter(Boolean);

      if (!phonemeTokens.length) {
        return safeGraphemes;
      }

      // Only count NG phonemes that are NOT immediately followed by a G phoneme.
      // When NG is followed by G (e.g. FINGER, ANGLE, SINGLE), the N grapheme
      // maps to NG and the G grapheme maps to G — those N,G pairs must stay
      // separate.  Only "solo" NG phonemes (SING, SONGS, CHANGING, …) need a
      // merged NG grapheme.
      const ngSoloPhonemeCount = phonemeTokens.filter(
        (token, i) => token === "NG" && phonemeTokens[i + 1] !== "G",
      ).length;

      if (ngSoloPhonemeCount === 0) {
        return safeGraphemes;
      }

      const toUpper = (value) =>
        String(value || "")
          .trim()
          .toUpperCase();
      let merged = [...safeGraphemes];
      let ngGraphemeCount = merged.filter(
        (grapheme) => toUpper(grapheme) === "NG",
      ).length;

      if (ngGraphemeCount >= ngSoloPhonemeCount) {
        return merged;
      }

      // Merge right-to-left so suffix-side NG pairs are handled first
      // (e.g. SONGS, HANGING, CHANGING).
      for (
        let i = merged.length - 2;
        i >= 0 && ngGraphemeCount < ngSoloPhonemeCount;
        i -= 1
      ) {
        const current = toUpper(merged[i]);
        const next = toUpper(merged[i + 1]);
        if (current === "N" && next === "G") {
          merged.splice(i, 2, "NG");
          ngGraphemeCount += 1;
        }
      }

      return merged;
    },
    [normalizePhonemeToken],
  );

  // Merge consecutive G,Z grapheme pairs back into a single X grapheme.
  // Words like EXACT, EXAM, EXIST, etc. are stored in Firestore with the X
  // letter split into separate G and Z graphemes.  This step restores the
  // X so the display, keyboard cue, and phoneme playback all work correctly.
  const mergeGZIntoXGrapheme = useCallback((graphemes) => {
    const safeGraphemes = Array.isArray(graphemes) ? graphemes : [];
    if (safeGraphemes.length < 2) {
      return safeGraphemes;
    }
    const toUpper = (v) =>
      String(v || "")
        .trim()
        .toUpperCase();
    const result = [];
    let i = 0;
    while (i < safeGraphemes.length) {
      const cur = toUpper(safeGraphemes[i]);
      const next =
        i + 1 < safeGraphemes.length ? toUpper(safeGraphemes[i + 1]) : "";
      if (cur === "G" && next === "Z") {
        result.push("X");
        i += 2;
      } else {
        result.push(safeGraphemes[i]);
        i += 1;
      }
    }
    return result;
  }, []);

  const coercePhonemeForGrapheme = useCallback((grapheme, phoneme) => {
    if (Array.isArray(phoneme) || phoneme == null) {
      return phoneme;
    }

    const normalizedGrapheme = String(grapheme || "")
      .trim()
      .toLowerCase();
    const rawPhoneme = String(phoneme || "").trim();

    if (normalizedGrapheme !== "s" || !rawPhoneme) {
      return phoneme;
    }

    const normalizedPhoneme = rawPhoneme.toUpperCase().replace(/[0-9]/g, "");
    if (normalizedPhoneme === "Z" || rawPhoneme.toLowerCase() === "z.mp3") {
      return rawPhoneme.toLowerCase().endsWith(".mp3") ? "s.mp3" : "S";
    }

    return phoneme;
  }, []);

  const getGraphemesInSyllable = useCallback(
    (syllable, graphemes, lastKnownSyllableIndex) => {
      let i = lastKnownSyllableIndex;
      const graphemesInSyllable = [];
      while (
        i < graphemes.length &&
        graphemesInSyllable.join("").toLowerCase() !==
          String(syllable || "").toLowerCase()
      ) {
        graphemesInSyllable.push(graphemes[i]);
        i++;
      }
      return { graphemesInSyllable, index: i };
    },
    [],
  );

  const getWordDataBySyllable = useCallback(
    ({ syllables, graphemes, phonemes }) => {
      const safeSyllables = Array.isArray(syllables) ? syllables : [];
      const safeGraphemes = Array.isArray(graphemes) ? graphemes : [];
      const safePhonemes = Array.isArray(phonemes) ? phonemes : [];

      if (safeSyllables.length <= 1 || safeGraphemes.length === 0) {
        return [
          {
            phonemesInSyllable: safePhonemes.filter(
              (phoneme) => phoneme !== "-",
            ),
            graphemesInSyllable: safeGraphemes,
          },
        ];
      }

      const separatedByDash = safePhonemes.some((phoneme) => phoneme === "-");
      const phonemeGroups = separatedByDash
        ? safePhonemes.reduce(
            (groups, phoneme) => {
              if (phoneme === "-") {
                groups.push([]);
                return groups;
              }
              if (!groups.length) {
                groups.push([]);
              }
              groups[groups.length - 1].push(phoneme);
              return groups;
            },
            [[]],
          )
        : [];

      const wordDataBySyllable = [];
      let lastSyllableIndexGrapheme = 0;
      let consumedPhonemeCount = 0;

      for (let i = 0; i < safeSyllables.length; ++i) {
        const { graphemesInSyllable, index } = getGraphemesInSyllable(
          safeSyllables[i],
          safeGraphemes,
          lastSyllableIndexGrapheme,
        );
        lastSyllableIndexGrapheme = index;

        let phonemesInSyllable = [];
        if (separatedByDash && phonemeGroups[i]) {
          phonemesInSyllable = phonemeGroups[i];
        } else {
          const graphemeCount = graphemesInSyllable.length;
          const remainingPhonemes = Math.max(
            0,
            safePhonemes.length - consumedPhonemeCount,
          );
          const takeCount =
            i === safeSyllables.length - 1
              ? remainingPhonemes
              : Math.min(graphemeCount, remainingPhonemes);
          phonemesInSyllable = safePhonemes.slice(
            consumedPhonemeCount,
            consumedPhonemeCount + takeCount,
          );
          consumedPhonemeCount += takeCount;
        }

        wordDataBySyllable.push({
          phonemesInSyllable,
          graphemesInSyllable,
        });
      }
      return wordDataBySyllable;
    },
    [getGraphemesInSyllable],
  );

  useEffect(() => {
    if (!wordString) {
      reportFlowEvent("flow-skipped", {
        hasWordString: Boolean(wordString),
      });
      return;
    }

    const flowKey = [
      String(flowRunId ?? "none"),
      lessonId,
      String(lessonLevel),
      String(index ?? ""),
      String(wordNumber),
      String(wordString),
    ].join("|");

    if (
      activeFlowKeyRef.current === flowKey ||
      completedFlowKeyRef.current === flowKey
    ) {
      return;
    }
    activeFlowKeyRef.current = flowKey;

    let isCancelled = false;
    let didSignalReady = false;
    let stepWatchdogId = null;
    setDisplayedGraphemeUnits([]);
    setActivePhoneme("");
    setActiveStepIndex(-1);
    setActiveSyllableIndex(-1);
    setWordDisplayPhase(WORD_DISPLAY_PHASE.WHOLE_WORD);

    const wait = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, Number(ms) || 0));
      });

    const scheduleStepWatchdog = () => {
      if (stepWatchdogId) {
        clearTimeout(stepWatchdogId);
      }
      // Recover if flow gets stuck on a step (commonly final grapheme highlight).
      stepWatchdogId = setTimeout(() => {
        signalReadyOnce("flow-step-watchdog-ready");
      }, 5000);
    };

    const signalReadyOnce = (phase = "flow-ready-for-input") => {
      if (didSignalReady) {
        return;
      }
      didSignalReady = true;
      if (stepWatchdogId) {
        clearTimeout(stepWatchdogId);
        stepWatchdogId = null;
      }
      setDisplayedGraphemeUnits([]);
      setActivePhoneme("");
      setActiveStepIndex(-1);
      setActiveSyllableIndex(-1);
      setWordDisplayPhase(WORD_DISPLAY_PHASE.WHOLE_WORD);
      signalReadyForInput();
      reportFlowEvent(phase);
    };

    const flowTimeoutId = setTimeout(() => {
      if (isCancelled) {
        return;
      }
      reportFlowEvent("flow-timeout", { timeoutMs: 22000 });
      signalReadyOnce("flow-timeout-ready");
    }, 22000);

    const safeSpeakPhoneme = async (phoneme) => {
      try {
        const phonemeList = Array.isArray(phoneme)
          ? phoneme.filter(Boolean)
          : [phoneme].filter(Boolean);

        for (const phonemePart of phonemeList) {
          // Await each phoneme so we advance only after playback has a chance to complete.
          await Promise.race([
            speakPhoneme(phonemePart),
            new Promise((resolve) => setTimeout(resolve, 1600)),
          ]);
        }

        // Short pause after each phoneme before the key highlight.
        const postPhonemeGap = Math.max(
          LESSON_FLOW_TIMING.PHONEME_POST_GAP_MIN_MS,
          LESSON_FLOW_TIMING.PHONEME_POST_GAP_BASE_MS /
            Math.max(SPEECH_RATE || 1, 0.1),
        );
        await new Promise((resolve) => setTimeout(resolve, postPhonemeGap));
        reportFlowEvent("flow-phoneme-complete", {
          phoneme,
          played: true,
        });
      } catch (error) {
        reportFlowEvent("flow-phoneme-error", {
          phoneme,
          message: error?.message || "Unknown phoneme error",
        });
        // Continue even on single-phoneme failures.
      }
    };

    const safeRenderKeyPress = async (grapheme, holdUntilPromise = null) => {
      const cuePlan = buildKeyboardCuePressPlan(grapheme);
      if (!cuePlan.length) {
        return;
      }
      const normalizedLevel = Number.isFinite(lessonLevel) ? lessonLevel : 0;
      const difficultyLevel =
        normalizedLevel <= 2 ? normalizedLevel + 1 : normalizedLevel;
      const isBeginnerDifficulty = difficultyLevel <= 2;
      const tapHoldMs = Math.max(
        isBeginnerDifficulty ? 120 : 90,
        (isBeginnerDifficulty ? 230 : 170) / Math.max(SPEECH_RATE || 1, 0.1),
      );
      const interTapGapMs = Math.max(
        isBeginnerDifficulty ? 70 : 50,
        (isBeginnerDifficulty ? 120 : 90) / Math.max(SPEECH_RATE || 1, 0.1),
      );
      const bounceGapMs = Math.max(75, 140 / Math.max(SPEECH_RATE || 1, 0.1));
      const postPhonemeExtraHoldMs = isBeginnerDifficulty ? 70 : 0;
      try {
        for (let stepIndex = 0; stepIndex < cuePlan.length; stepIndex += 1) {
          const step = cuePlan[stepIndex];

          if (step.bounceBeforePress) {
            window.dispatchEvent(
              new CustomEvent("soundspeller-key-release", {
                detail: { key: step.key },
              }),
            );
            await wait(bounceGapMs);
          }

          window.dispatchEvent(
            new CustomEvent("soundspeller-key-press", {
              detail: { key: step.key },
            }),
          );
          await wait(tapHoldMs);

          window.dispatchEvent(
            new CustomEvent("soundspeller-key-release", {
              detail: { key: step.key },
            }),
          );

          if (stepIndex < cuePlan.length - 1) {
            await wait(interTapGapMs);
          }
        }

        if (holdUntilPromise) {
          await holdUntilPromise;
          if (postPhonemeExtraHoldMs > 0) {
            await wait(postPhonemeExtraHoldMs);
          }
        }

        reportFlowEvent("flow-grapheme-complete", {
          grapheme,
        });
      } catch (error) {
        for (const step of cuePlan) {
          window.dispatchEvent(
            new CustomEvent("soundspeller-key-release", {
              detail: { key: step.key },
            }),
          );
        }
        reportFlowEvent("flow-grapheme-error", {
          grapheme,
          message: error?.message || "Unknown grapheme error",
        });
        // Continue even on key-render failures.
      }
    };

    const withTimeout = (promise, timeoutMs, fallbackValue = null) => {
      return Promise.race([
        Promise.resolve(promise),
        new Promise((resolve) =>
          setTimeout(() => resolve(fallbackValue), timeoutMs),
        ),
      ]);
    };

    const speakWholeWordWithRetry = async (word) => {
      const firstAttempt = await withTimeout(speakWordSlow(word), 3500, false);
      if (firstAttempt) {
        return true;
      }

      // Some browsers silently drop the first utterance after audio unlock.
      // Retry once before continuing into the phoneme sequence.
      await wait(120);
      const secondAttempt = await withTimeout(speakWordSlow(word), 3500, false);
      return Boolean(secondAttempt);
    };

    const playWordFlow = async () => {
      try {
        await primeAudioPlayback();
      } catch (error) {
        // Continue even if priming fails; fallback logic still opens input.
      }

      reportFlowEvent("flow-started");

      const normalizedLevel = Number.isFinite(lessonLevel) ? lessonLevel : 0;
      // Be tolerant of both level encodings:
      // - 0-based (0,1,2) from current app state
      // - 1-based (1,2,3) from any persisted or legacy paths
      const difficultyLevel =
        normalizedLevel <= 2 ? normalizedLevel + 1 : normalizedLevel;
      const showGraphemeCue = difficultyLevel <= 1;
      const showKeyboardCue = difficultyLevel <= 2;
      const speakPhonemeCue = difficultyLevel <= 3;
      const shouldLoadWordDoc = lessonSection > 0 || isCustomLesson;

      let wordData = null;
      if (shouldLoadWordDoc) {
        reportFlowEvent("fetch-word-data-started", { shouldLoadWordDoc });
        if (wordCacheRef.current.has(wordString)) {
          wordData = wordCacheRef.current.get(wordString);
          reportFlowEvent("fetch-word-data-cache-hit");
        } else {
          let wordDoc = null;
          try {
            wordDoc = await withTimeout(
              db.collection("words").doc(wordString).get(),
              3000,
              null,
            );

            if (
              wordDoc &&
              !wordDoc.exists &&
              wordString.toLowerCase() !== wordString
            ) {
              wordDoc = await withTimeout(
                db.collection("words").doc(wordString.toLowerCase()).get(),
                2000,
                null,
              );
            }
          } catch (error) {
            reportFlowEvent("fetch-word-data-error", {
              message: error?.message || "Word lookup failed",
            });
          }

          wordData = wordDoc && wordDoc.exists ? wordDoc.data() : null;
          wordCacheRef.current.set(wordString, wordData);
          reportFlowEvent("fetch-word-data-complete", {
            foundWordData: Boolean(wordData),
          });
        }
      }

      if (isCancelled) {
        return;
      }

      const wordFromSource = wordData?.word || wordString;
      const graphemeSequence = Array.isArray(wordData?.graphemes)
        ? normalizeWordGraphemeSequence(wordData.graphemes)
        : Array.from(String(wordFromSource || ""));

      const graphemeSequenceWithTerminalNg = mergeTerminalNgGrapheme(
        graphemeSequence,
        Array.isArray(wordData?.phonemes) ? wordData.phonemes : [],
      );

      const graphemeSequenceWithX = mergeGZIntoXGrapheme(
        graphemeSequenceWithTerminalNg,
      );

      const fallbackWordChars = Array.from(String(wordFromSource || "")).filter(
        Boolean,
      );
      const safeGraphemeSequence = graphemeSequenceWithX.length
        ? graphemeSequenceWithX
        : fallbackWordChars;
      const normalizedGraphemeSequence =
        formatDisplayGraphemes(safeGraphemeSequence);
      const wordDataBySyllable = getWordDataBySyllable({
        syllables: Array.isArray(wordData?.syllables) ? wordData.syllables : [],
        graphemes: safeGraphemeSequence,
        phonemes: Array.isArray(wordData?.phonemes) ? wordData.phonemes : [],
      });
      const syllableBoundaryIndices = [];
      let consumedGraphemeCount = 0;
      const syllableRanges = [];
      wordDataBySyllable.forEach((syllableData, syllableIndex) => {
        const graphemeCount = Array.isArray(syllableData?.graphemesInSyllable)
          ? syllableData.graphemesInSyllable.length
          : 0;
        const startIndex = consumedGraphemeCount;
        consumedGraphemeCount += Array.isArray(
          syllableData?.graphemesInSyllable,
        )
          ? syllableData.graphemesInSyllable.length
          : 0;
        const endIndex = Math.max(startIndex, startIndex + graphemeCount - 1);
        syllableRanges.push({ syllableIndex, startIndex, endIndex });
        if (
          syllableIndex < wordDataBySyllable.length - 1 &&
          consumedGraphemeCount > 0
        ) {
          syllableBoundaryIndices.push(consumedGraphemeCount - 1);
        }
      });
      const syllableBoundaryIndexSet = new Set(syllableBoundaryIndices);
      const getSyllableIndexForGrapheme = (graphemeIndex) => {
        const matchingRange = syllableRanges.find(
          (range) =>
            graphemeIndex >= range.startIndex &&
            graphemeIndex <= range.endIndex,
        );
        return matchingRange ? matchingRange.syllableIndex : 0;
      };
      const graphemeDisplayUnits = normalizedGraphemeSequence.map(
        (grapheme, graphemeIndex) => ({
          grapheme,
          graphemeIndex,
          syllableIndex: getSyllableIndexForGrapheme(graphemeIndex),
          syllableBreakAfter: syllableBoundaryIndexSet.has(graphemeIndex),
        }),
      );

      const explicitGraphemePhonemeMap = resolveExplicitGraphemePhonemeMap({
        word: wordFromSource,
        graphemes: safeGraphemeSequence,
        wordData,
      });

      let basePhonemeSequence = [];
      if (Array.isArray(wordData?.phonemes)) {
        basePhonemeSequence = wordData.phonemes
          .filter((phoneme) => phoneme !== "-")
          .map((phoneme) => normalizePhoneme(phoneme))
          .filter(Boolean);
      } else {
        basePhonemeSequence = safeGraphemeSequence.map(
          (g) => COMMON_PHONEMES[String(g || "").toLowerCase()],
        );
      }

      if (!basePhonemeSequence.length) {
        basePhonemeSequence = safeGraphemeSequence.map(
          (g) => COMMON_PHONEMES[String(g || "").toLowerCase()],
        );
      }

      let phonemeSequence = explicitGraphemePhonemeMap;

      if (!phonemeSequence) {
        phonemeSequence = buildFallbackPhonemeSequence(
          safeGraphemeSequence,
          basePhonemeSequence,
          lessonSection,
          coercePhonemeForGrapheme,
        );
      }

      if (showGraphemeCue) {
        setDisplayedGraphemeUnits(graphemeDisplayUnits);

        // 1) Show the whole word first (no grapheme/syllable spacing).
        setWordDisplayPhase(WORD_DISPLAY_PHASE.WHOLE_WORD);
        setActiveSyllableIndex(-1);
        setActiveStepIndex(-1);
        await wait(LESSON_FLOW_TIMING.WHOLE_WORD_HOLD_MS);

        // 2) Split into syllables (only syllable spacing).
        setWordDisplayPhase(WORD_DISPLAY_PHASE.SYLLABLES);
        await wait(LESSON_FLOW_TIMING.SYLLABLES_HOLD_MS);
      } else {
        setDisplayedGraphemeUnits([]);
        setWordDisplayPhase(WORD_DISPLAY_PHASE.WHOLE_WORD);
        setActiveSyllableIndex(-1);
        setActiveStepIndex(-1);
      }

      if (speakPhonemeCue) {
        // Make the word audible before the cue sequence starts so users hear
        // the target word even if the later closing TTS is delayed or cut off.
        await speakWholeWordWithRetry(wordFromSource);
        if (isCancelled) {
          return;
        }
      }

      const syllableCount = Math.max(1, wordDataBySyllable.length);
      const graphemeIndicesBySyllable = Array.from(
        { length: syllableCount },
        () => [],
      );
      graphemeDisplayUnits.forEach((unit) => {
        const safeSyllableIndex =
          Number.isInteger(unit.syllableIndex) && unit.syllableIndex >= 0
            ? unit.syllableIndex
            : 0;
        if (!graphemeIndicesBySyllable[safeSyllableIndex]) {
          graphemeIndicesBySyllable[safeSyllableIndex] = [];
        }
        graphemeIndicesBySyllable[safeSyllableIndex].push(unit.graphemeIndex);
      });

      // 3/4) Work syllable-by-syllable, then grapheme-by-grapheme inside each syllable.
      for (
        let syllableIndex = 0;
        syllableIndex < syllableCount;
        syllableIndex += 1
      ) {
        if (isCancelled) {
          return;
        }

        if (showGraphemeCue) {
          setWordDisplayPhase(WORD_DISPLAY_PHASE.SYLLABLE_GRAPHEMES);
          setActiveSyllableIndex(syllableIndex);
          await wait(LESSON_FLOW_TIMING.SYLLABLE_START_HOLD_MS);
        }

        const syllableIndices = Array.isArray(
          graphemeIndicesBySyllable[syllableIndex],
        )
          ? graphemeIndicesBySyllable[syllableIndex]
          : [];

        for (const i of syllableIndices) {
          if (isCancelled) {
            return;
          }

          const grapheme = safeGraphemeSequence[i];
          const mappedPhoneme =
            i < phonemeSequence.length ? phonemeSequence[i] : undefined;
          const isSilentFromMissingPhonemeIndex = mappedPhoneme === undefined;
          const phoneme = Array.isArray(mappedPhoneme)
            ? mappedPhoneme
            : coercePhonemeForGrapheme(
                grapheme,
                isSilentFromMissingPhonemeIndex ? null : mappedPhoneme,
              );

          if (isSilentFromMissingPhonemeIndex) {
            reportFlowEvent("flow-silent-grapheme-inferred", {
              stepIndex: i,
              grapheme: grapheme || null,
              syllableIndex,
              reason: "missing-phoneme-index",
            });
          }

          reportFlowEvent("flow-sequence-step", {
            stepIndex: i,
            phoneme: phoneme || null,
            grapheme: grapheme || null,
            syllableIndex,
            cues: {
              showGraphemeCue,
              showKeyboardCue,
              speakPhonemeCue,
            },
          });
          scheduleStepWatchdog();

          setActiveStepIndex(showGraphemeCue ? i : -1);

          if (speakPhonemeCue && phoneme) {
            setActivePhoneme(formatDisplayPhoneme(phoneme));
          } else {
            setActivePhoneme("");
          }

          if (speakPhonemeCue && phoneme && showKeyboardCue && grapheme) {
            const phonemeTask = safeSpeakPhoneme(phoneme);
            await Promise.all([
              phonemeTask,
              safeRenderKeyPress(grapheme, phonemeTask),
            ]);
          } else if (speakPhonemeCue && phoneme) {
            await safeSpeakPhoneme(phoneme);
          } else if (showKeyboardCue && grapheme) {
            await safeRenderKeyPress(grapheme);
          }
        }

        if (syllableIndex < syllableCount - 1) {
          const syllablePauseMs = Math.max(
            LESSON_FLOW_TIMING.SYLLABLE_PAUSE_MIN_MS,
            LESSON_FLOW_TIMING.SYLLABLE_PAUSE_BASE_MS /
              Math.max(SPEECH_RATE || 1, 0.1),
          );
          await wait(syllablePauseMs);
        }
      }

      setActivePhoneme("");
      setActiveStepIndex(-1);

      if (showGraphemeCue) {
        // 5) Collapse grapheme spacing (keep syllable spacing).
        setWordDisplayPhase(WORD_DISPLAY_PHASE.SYLLABLES);
        setActiveSyllableIndex(-1);
        await wait(LESSON_FLOW_TIMING.POST_GRAPHEME_COLLAPSE_HOLD_MS);

        // 6) Collapse syllable spacing back to the whole word.
        setWordDisplayPhase(WORD_DISPLAY_PHASE.WHOLE_WORD);
        await wait(LESSON_FLOW_TIMING.POST_SYLLABLE_COLLAPSE_HOLD_MS);
      }

      // 7) Speak the full word with TTS.
      await speakWholeWordWithRetry(wordFromSource);

      setDisplayedGraphemeUnits([]);
      signalReadyOnce();
      await Promise.race([
        playStartBells(),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
      return;
    };

    playWordFlow()
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        console.error("Failed to play word flow:", error);
        reportFlowEvent("flow-error", {
          message: error?.message || "Unknown error",
        });
        signalReadyForInput();
      })
      .finally(() => {
        // Only signal ready if still mounted — isCancelled means the key changed
        // (next word started) and we must not fire onReadyForInput into the parent.
        if (!isCancelled) {
          signalReadyOnce("flow-ready-for-input-fallback");
        }
        if (stepWatchdogId) {
          clearTimeout(stepWatchdogId);
          stepWatchdogId = null;
        }
        clearTimeout(flowTimeoutId);
        completedFlowKeyRef.current = flowKey;
        if (activeFlowKeyRef.current === flowKey) {
          activeFlowKeyRef.current = null;
        }
      });

    return () => {
      isCancelled = true;
      setActivePhoneme("");
      setActiveStepIndex(-1);
      setActiveSyllableIndex(-1);
      setWordDisplayPhase(WORD_DISPLAY_PHASE.WHOLE_WORD);
      if (stepWatchdogId) {
        clearTimeout(stepWatchdogId);
        stepWatchdogId = null;
      }
      clearTimeout(flowTimeoutId);
      if (activeFlowKeyRef.current === flowKey) {
        activeFlowKeyRef.current = null;
      }
    };
  }, [
    wordString,
    lessonLevel,
    lessonSection,
    lessonId,
    index,
    flowRunId,
    wordNumber,
    reportFlowEvent,
    renderKeyPress,
    formatDisplayGraphemes,
    mergeTerminalNgGrapheme,
    mergeGZIntoXGrapheme,
    formatDisplayPhoneme,
    normalizePhoneme,
    normalizePhonemeToken,
    coercePhonemeForGrapheme,
    getWordDataBySyllable,
    signalReadyForInput,
    isCustomLesson,
  ]);

  // useLayoutEffect runs before any useEffect, guaranteeing PLAY_AUDIO=true
  // before the flow effect kicks off playWordFlow.
  useLayoutEffect(() => {
    setPlayAudio(true);
    return terminateAudio;
  }, []);

  return (
    <div className={classes.outputContainer} ref={outputContainerRef}>
      <Typography
        className={classes.word}
        variant="h1"
        ref={wordRef}
        style={{ fontSize: `${wordFontSize}px` }}
      >
        {displayedGraphemeUnits.map((unit) => {
          const { grapheme, graphemeIndex, syllableBreakAfter } = unit;
          const isInActiveSyllable = unit.syllableIndex === activeSyllableIndex;
          let spacingStyle = { marginLeft: 0, marginRight: 0 };

          if (wordDisplayPhase === WORD_DISPLAY_PHASE.SYLLABLES) {
            spacingStyle = {
              marginLeft: 0,
              marginRight: syllableBreakAfter ? SYLLABLE_GAP_EM : 0,
            };
          } else if (
            wordDisplayPhase === WORD_DISPLAY_PHASE.SYLLABLE_GRAPHEMES
          ) {
            spacingStyle = {
              marginLeft: 0,
              marginRight: syllableBreakAfter
                ? SYLLABLE_GAP_EM
                : isInActiveSyllable
                  ? GRAPHEME_GAP_EM
                  : 0,
            };
          }

          const className = [
            classes.grapheme,
            graphemeIndex <= activeStepIndex ? classes.graphemeVisible : "",
            graphemeIndex === activeStepIndex ? classes.graphemeActive : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <span
              key={`${grapheme}-${graphemeIndex}`}
              className={className}
              style={spacingStyle}
            >
              {grapheme}
            </span>
          );
        })}
      </Typography>
    </div>
  );
}
