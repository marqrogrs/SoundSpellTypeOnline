import React, {
  useState,
  useEffect,
  useContext,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Prompt } from "react-router-dom";

import Keyboard from "../components/Keyboard";
import OutputWord from "../components/OutputWord";
import LessonProgress from "../components/LessonProgress";
import LevelPicker from "../components/LevelPicker";
import PatternButton from "../components/PatternButton";
import {
  Container,
  Button,
  Grid,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from "@material-ui/core";
import ButtonGroup from "@material-ui/core/ButtonGroup";

import { useParams, useHistory } from "react-router-dom";
import { LessonContext } from "../providers/LessonProvider";
import {
  primeAudioPlayback,
  playCelebrationFanfare,
  playRewardChime,
  setPlayAudio,
  speakText,
  stopSpeaking,
} from "../util/Audio";
import { lookupWordDefinition } from "../util/wordDefinitionLookup";
import {
  SUCCESS_MESSAGES,
  FAILURE_MESSAGES,
  applyLessonFlowTimingPreset,
} from "../util/constants";
import { useStyles } from "../styles/material";

import { useSnackbar } from "notistack";
import sample from "lodash/sample";

const CUE_SPEED_PRESET_STORAGE_KEY = "soundspeller.lessonCueSpeedPreset";
const WORD_INFO_TALK_ENABLED_STORAGE_KEY = "soundspeller.wordInfoTalkEnabled";
const REWARD_AUDIO_ENABLED_STORAGE_KEY = "soundspeller.rewardAudioEnabled";
const CELEBRATION_MOTION_ENABLED_STORAGE_KEY =
  "soundspeller.celebrationMotionEnabled";
const CUE_SPEED_PRESET_OPTIONS = ["slower", "normal", "faster"];
const FIRST_SESSION_QUICK_WIN_TARGET = 3;
const CUE_SPEED_LABELS = {
  slower: "Slower",
  normal: "Normal",
  faster: "Faster",
};

export default function Lesson() {
  const { enqueueSnackbar } = useSnackbar();
  const classes = useStyles();
  const {
    saveProgress,
    markFirstLessonAttempted = async () => {},
    setLesson,
    currentLesson,
    lessonsLoading,
    currentLessonLoading,
    setProgress,
    currentLessonLevel,
    currentLessonProgress,
    setLevel,
    rules = [],
  } = useContext(LessonContext);

  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [lessonStarted, setLessonStarted] = useState(false);
  const [startQueued, setStartQueued] = useState(false);
  const [inputWord, setInputWord] = useState("");
  const [enableInput, setEnableInput] = useState(false);
  const [isSaved, setIsSaved] = useState(true);
  const [outputWordKey, setOutputWordKey] = useState(0);
  const [showOutputWord, setShowOutputWord] = useState(false);
  const [showWordPeek, setShowWordPeek] = useState(false);
  const [startStatusMessage, setStartStatusMessage] = useState("");
  const [cueSpeedPreset, setCueSpeedPreset] = useState("normal");
  const [wordInfoDialogOpen, setWordInfoDialogOpen] = useState(false);
  const [wordInfoWord, setWordInfoWord] = useState("");
  const [wordInfo, setWordInfo] = useState(null);
  const [wordInfoLoading, setWordInfoLoading] = useState(false);
  const [wordInfoError, setWordInfoError] = useState("");
  const [wordInfoSpeaking, setWordInfoSpeaking] = useState(false);
  const [sessionCorrectCount, setSessionCorrectCount] = useState(0);
  const [quickWinEnabledForRun, setQuickWinEnabledForRun] = useState(false);
  const [rewardAudioEnabled, setRewardAudioEnabled] = useState(true);
  const [celebrationMotionEnabled, setCelebrationMotionEnabled] =
    useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [celebrationMessage, setCelebrationMessage] = useState("");
  const [celebrationActive, setCelebrationActive] = useState(false);

  const params = useParams();
  const history = useHistory();
  const requestedLessonId = useMemo(() => {
    if (params.lessonId) {
      return `custom:${params.lessonId}`;
    }
    return params.lesson;
  }, [params.lesson, params.lessonId]);

  const previousLevelRef = useRef();
  const previousLessonIdRef = useRef();
  const pendingManualLevelStartRef = useRef(false);
  const lastStartAtRef = useRef(0);
  const masteredWordsByLevelRef = useRef({
    1: new Set(),
    2: new Set(),
    3: new Set(),
  });
  const answerInputRef = useRef(null);
  const flowGuardTimeoutRef = useRef(null);
  const wordInfoRequestIdRef = useRef(0);
  const wordInfoTalkRequestIdRef = useRef(0);
  const firstCorrectCelebratedRef = useRef(false);
  const quickWinCompletedRef = useRef(false);

  const wordInfoTalkEnabled = useMemo(() => {
    try {
      return (
        String(
          window.localStorage.getItem(WORD_INFO_TALK_ENABLED_STORAGE_KEY) ||
            "true",
        ).toLowerCase() !== "false"
      );
    } catch (error) {
      return true;
    }
  }, []);

  useEffect(() => {
    try {
      setRewardAudioEnabled(
        String(
          window.localStorage.getItem(REWARD_AUDIO_ENABLED_STORAGE_KEY) ||
            "true",
        ).toLowerCase() !== "false",
      );
      setCelebrationMotionEnabled(
        String(
          window.localStorage.getItem(CELEBRATION_MOTION_ENABLED_STORAGE_KEY) ||
            "true",
        ).toLowerCase() !== "false",
      );
    } catch (_error) {
      setRewardAudioEnabled(true);
      setCelebrationMotionEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setPrefersReducedMotion(Boolean(query.matches));
    };

    update();

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  const resolvedWords = useMemo(() => {
    if (!Array.isArray(currentLesson?.lesson?.words)) {
      return [];
    }
    return currentLesson.lesson.words
      .map((word) => (typeof word === "string" ? word.trim() : ""))
      .filter((word) => word.length > 0);
  }, [currentLesson?.lesson?.words]);
  const currentWord = resolvedWords[currentWordIndex] || null;
  const lessonReady =
    !lessonsLoading && !currentLessonLoading && Boolean(currentLesson);
  const canStartLesson = lessonReady && resolvedWords.length > 0;
  const completedWordsForCurrentLevel = useMemo(() => {
    const completedWordsRaw = Number(
      currentLesson?.progress?.[currentLessonLevel]?.completed_words,
    );
    return Number.isFinite(completedWordsRaw) ? completedWordsRaw : 0;
  }, [currentLesson?.progress, currentLessonLevel]);
  const resumeWordIndex = useMemo(() => {
    if (resolvedWords.length === 0) {
      return 0;
    }
    if (completedWordsForCurrentLevel >= resolvedWords.length) {
      return 0;
    }
    return Math.max(0, completedWordsForCurrentLevel);
  }, [completedWordsForCurrentLevel, resolvedWords.length]);
  const hasSavedProgressToResume = resumeWordIndex > 0;
  const usesZeroBasedLevels = useMemo(() => {
    const progress = currentLesson?.progress;
    if (!progress || typeof progress !== "object") {
      return true;
    }
    return (
      Object.prototype.hasOwnProperty.call(progress, 0) ||
      Object.prototype.hasOwnProperty.call(progress, "0")
    );
  }, [currentLesson?.progress]);
  const isDifficultyLevelOne =
    Number(currentLessonLevel) === (usesZeroBasedLevels ? 0 : 1);

  const lessonPatternRules = useMemo(() => {
    const lessonId = String(currentLesson?.lesson?.lesson_id || "").trim();
    const rawSectionKey = String(
      currentLesson?.lesson?.lesson_section || "",
    ).trim();
    const lessonIdSectionKey = lessonId.split(".")[0] || "";
    const sectionKey = rawSectionKey.includes(".")
      ? lessonIdSectionKey
      : rawSectionKey || lessonIdSectionKey;
    const sectionRuleLesNum = lessonIdSectionKey
      ? `${lessonIdSectionKey}.0`
      : "";
    const lessonIdSubsection = lessonId.split(".")[1] || "0";
    const getRuleParts = (value) => {
      const raw = String(value || "").trim();
      if (!raw) {
        return { section: "", subsection: "" };
      }
      const parts = raw.split(".");
      return {
        section: parts[0] || "",
        subsection: parts[1] || "0",
      };
    };
    if (!lessonId) {
      return [];
    }
    return (Array.isArray(rules) ? rules : [])
      .filter((rule) => {
        const rawRuleLesNum = String(rule?.rule_les_num || "").trim();
        const { section, subsection } = getRuleParts(rule?.rule_les_num);
        const matchesLessonRule = rawRuleLesNum === lessonId;
        const matchesSectionRule =
          section === lessonIdSectionKey && subsection === "0";
        const matchesLessonSubsectionRule =
          section === lessonIdSectionKey && subsection === lessonIdSubsection;
        return (
          matchesLessonRule || matchesSectionRule || matchesLessonSubsectionRule
        );
      })
      .sort((a, b) => {
        const aParts = getRuleParts(a?.rule_les_num);
        const bParts = getRuleParts(b?.rule_les_num);
        const aIsSectionRule = aParts.subsection === "0";
        const bIsSectionRule = bParts.subsection === "0";
        if (aIsSectionRule && !bIsSectionRule) {
          return -1;
        }
        if (bIsSectionRule && !aIsSectionRule) {
          return 1;
        }
        return String(aParts.subsection).localeCompare(
          String(bParts.subsection),
          undefined,
          {
            numeric: true,
          },
        );
      });
  }, [
    currentLesson?.lesson?.lesson_id,
    currentLesson?.lesson?.lesson_section,
    rules,
  ]);

  const clearWordPeek = useCallback(() => {
    setShowWordPeek(false);
  }, []);

  const stopWordInfoSpeech = useCallback(() => {
    wordInfoTalkRequestIdRef.current += 1;
    setWordInfoSpeaking(false);
    stopSpeaking();
  }, []);

  const closeWordInfoDialog = useCallback(() => {
    setWordInfoDialogOpen(false);
    setWordInfoLoading(false);
    stopWordInfoSpeech();
  }, [stopWordInfoSpeech]);

  const loadWordInfoForWord = useCallback(async (rawWord) => {
    const safeWord = String(rawWord || "").trim();
    if (!safeWord) {
      return;
    }

    const requestId = wordInfoRequestIdRef.current + 1;
    wordInfoRequestIdRef.current = requestId;

    setWordInfoWord(safeWord);
    setWordInfoDialogOpen(true);
    setWordInfoLoading(true);
    setWordInfoError("");
    setWordInfo(null);

    try {
      const lookupResult = await lookupWordDefinition(safeWord);
      if (wordInfoRequestIdRef.current !== requestId) {
        return;
      }

      if (!lookupResult) {
        setWordInfoError(
          "No local Wiktionary definition found for this word yet.",
        );
        return;
      }

      setWordInfo(lookupResult);
    } catch (error) {
      if (wordInfoRequestIdRef.current !== requestId) {
        return;
      }
      setWordInfoError(
        error?.message || "Failed to load local Wiktionary definition.",
      );
    } finally {
      if (wordInfoRequestIdRef.current === requestId) {
        setWordInfoLoading(false);
      }
    }
  }, []);

  const openWordInfoDialog = useCallback(() => {
    if (!showWordPeek || !lessonStarted || !enableInput || !currentWord) {
      return;
    }
    loadWordInfoForWord(currentWord);
  }, [
    currentWord,
    enableInput,
    lessonStarted,
    loadWordInfoForWord,
    showWordPeek,
  ]);

  const handleTalkWordInfo = useCallback(async () => {
    if (
      !wordInfoTalkEnabled ||
      !wordInfoDialogOpen ||
      !lessonStarted ||
      !enableInput ||
      wordInfoLoading ||
      !wordInfo ||
      wordInfoSpeaking
    ) {
      return;
    }

    const spokenWord = String(wordInfoWord || currentWord || "").trim();
    const definition = String(wordInfo.definition || "").trim();
    const exampleSentence = String(wordInfo.exampleSentence || "").trim();
    if (!spokenWord || !definition) {
      return;
    }

    const spokenParts = [`Word: ${spokenWord}.`, `Definition: ${definition}`];
    if (exampleSentence) {
      const maxExampleLength = 180;
      const safeExample =
        exampleSentence.length > maxExampleLength
          ? `${exampleSentence.slice(0, maxExampleLength)}...`
          : exampleSentence;
      spokenParts.push(`Example: ${safeExample}`);
    }

    const requestId = wordInfoTalkRequestIdRef.current + 1;
    wordInfoTalkRequestIdRef.current = requestId;
    setWordInfoSpeaking(true);
    setPlayAudio(true);
    stopSpeaking();

    try {
      const didSpeak = await speakText(spokenParts.join(" "));
      if (wordInfoTalkRequestIdRef.current !== requestId) {
        return;
      }
      if (!didSpeak) {
        enqueueSnackbar("Speech synthesis is unavailable on this browser.", {
          variant: "warning",
        });
      }
    } finally {
      if (wordInfoTalkRequestIdRef.current === requestId) {
        setWordInfoSpeaking(false);
      }
    }
  }, [
    currentWord,
    enableInput,
    enqueueSnackbar,
    lessonStarted,
    wordInfo,
    wordInfoDialogOpen,
    wordInfoLoading,
    wordInfoSpeaking,
    wordInfoTalkEnabled,
    wordInfoWord,
  ]);

  const focusAnswerInput = useCallback(() => {
    setTimeout(() => {
      if (answerInputRef.current) {
        answerInputRef.current.focus();
      }
    }, 0);
  }, []);

  useEffect(() => {
    window.onbeforeunload = () => true;
    return () => {
      window.onbeforeunload = null;
    };
  }, []);

  useEffect(() => {
    const storedPreset = window.localStorage.getItem(
      CUE_SPEED_PRESET_STORAGE_KEY,
    );
    const selectedPreset = applyLessonFlowTimingPreset(
      storedPreset || "normal",
    );
    setCueSpeedPreset(selectedPreset);
  }, []);

  useEffect(() => {
    if (!lessonsLoading) {
      setLesson({ lesson_id: requestedLessonId });
    }
  }, [lessonsLoading, requestedLessonId, setLesson]);

  useEffect(() => {
    const previousLevel = previousLevelRef.current;
    previousLevelRef.current = currentLessonLevel;
    const previousLevelKnown =
      previousLevel !== undefined && previousLevel !== null;
    const newLevel = previousLevelKnown && previousLevel !== currentLessonLevel;

    const lessonId = String(currentLesson?.lesson?.lesson_id ?? "");
    const previousLessonId = previousLessonIdRef.current;
    const lessonChanged =
      lessonId.length > 0 &&
      previousLessonId !== undefined &&
      previousLessonId !== null &&
      previousLessonId !== "" &&
      previousLessonId !== lessonId;
    previousLessonIdRef.current = lessonId;

    // During an active run, handleSubmit controls currentWordIndex unless the
    // user explicitly changes level.
    if (lessonStarted && !newLevel && !lessonChanged) {
      return;
    }

    if (!lessonsLoading && currentLesson) {
      if (lessonChanged) {
        setLessonStarted(false);
        setStartQueued(false);
        setShowOutputWord(false);
        setShowWordPeek(false);
        setInputWord("");
        setEnableInput(false);
        pendingManualLevelStartRef.current = false;
      }

      setCurrentWordIndex(resumeWordIndex);

      if (newLevel && lessonStarted) {
        // Hot-switch difficulty while the lesson is running.
        setShowOutputWord(true);
        setEnableInput(false);
        setInputWord("");
        setOutputWordKey((prev) => prev + 1);
      }
    }
  }, [
    currentLesson,
    currentLessonLevel,
    lessonStarted,
    lessonsLoading,
    resumeWordIndex,
  ]);

  const handleSelectLevel = useCallback(
    (levelIndex) => {
      const parsedLevelIndex = Number(levelIndex);
      if (!Number.isInteger(parsedLevelIndex) || parsedLevelIndex < 0) {
        return;
      }

      pendingManualLevelStartRef.current = true;
      setLevel(parsedLevelIndex);
      setLessonStarted(false);
      setStartQueued(false);
      setShowOutputWord(false);
      setShowWordPeek(false);
      setCurrentWordIndex(0);
      setInputWord("");
      setEnableInput(false);
      setStartStatusMessage("");
      setSessionCorrectCount(0);
      setQuickWinEnabledForRun(false);
      setCelebrationMessage("");
      setCelebrationActive(false);
      firstCorrectCelebratedRef.current = false;
      quickWinCompletedRef.current = false;
    },
    [setLevel],
  );

  const triggerCelebration = useCallback(
    (message) => {
      const safeMessage = String(message || "").trim();
      if (!safeMessage) {
        return;
      }

      setCelebrationMessage(safeMessage);

      if (!celebrationMotionEnabled || prefersReducedMotion) {
        setCelebrationActive(false);
        window.setTimeout(() => {
          setCelebrationMessage("");
        }, 2200);
        return;
      }

      setCelebrationActive(false);
      window.requestAnimationFrame(() => {
        setCelebrationActive(true);
      });

      window.setTimeout(() => {
        setCelebrationActive(false);
        window.setTimeout(() => {
          setCelebrationMessage("");
        }, 240);
      }, 2200);
    },
    [celebrationMotionEnabled, prefersReducedMotion],
  );

  useEffect(() => {
    if (!lessonStarted || resolvedWords.length === 0) {
      return;
    }

    if (currentWordIndex < 0 || currentWordIndex >= resolvedWords.length) {
      setCurrentWordIndex(0);
    }
  }, [currentWordIndex, lessonStarted, resolvedWords]);

  const renderScoreSnackbar = useCallback(
    (success) => {
      const message = success
        ? `${sample(SUCCESS_MESSAGES)} Correct`
        : sample(FAILURE_MESSAGES);
      const variant = success ? "success" : "error";
      enqueueSnackbar(message, { variant });
    },
    [enqueueSnackbar],
  );

  const handleSubmit = useCallback(
    (checkScore = true) => {
      if (!currentLesson || !currentWord) {
        return;
      }

      stopWordInfoSpeech();

      const isCorrect =
        checkScore && inputWord.toLowerCase() === currentWord.toLowerCase();

      if (checkScore) {
        renderScoreSnackbar(isCorrect);
      }

      if (isCorrect) {
        const levelKey = String((Number(currentLessonLevel) || 0) + 1);
        if (!masteredWordsByLevelRef.current[levelKey]) {
          masteredWordsByLevelRef.current[levelKey] = new Set();
        }
        masteredWordsByLevelRef.current[levelKey].add(
          String(currentWord || "")
            .trim()
            .toUpperCase(),
        );

        setSessionCorrectCount((prev) => {
          const next = prev + 1;

          if (quickWinEnabledForRun && !firstCorrectCelebratedRef.current) {
            firstCorrectCelebratedRef.current = true;
            if (rewardAudioEnabled) {
              playRewardChime().catch(() => {});
            }
            enqueueSnackbar(
              "Great start. You got your first word right. Keep going for 3 correct words.",
              {
                variant: "success",
              },
            );
          }

          if (
            quickWinEnabledForRun &&
            next >= FIRST_SESSION_QUICK_WIN_TARGET &&
            !quickWinCompletedRef.current
          ) {
            quickWinCompletedRef.current = true;
            if (rewardAudioEnabled) {
              playCelebrationFanfare().catch(() => {});
            }
            triggerCelebration(
              "Quick win unlocked. You reached your first 3 correct words.",
            );
            enqueueSnackbar(
              "Quick win complete. Next action: keep this lesson going while momentum is high.",
              {
                variant: "success",
              },
            );
          }

          return next;
        });
      }

      const nextProgress =
        setProgress(currentWordIndex + 1, {
          isCorrect,
          word: currentWord,
        }) ||
        currentLessonProgress ||
        {};

      if (currentWordIndex < resolvedWords.length - 1) {
        setCurrentWordIndex((prev) => prev + 1);
        setShowOutputWord(true);
        setOutputWordKey((prev) => prev + 1);
        setIsSaved(false);
      } else {
        const levelKey = String((Number(currentLessonLevel) || 0) + 1);
        // Combine current-session words (masteredWordsByLevelRef) with any
        // words that were answered correctly in previous partial sessions
        // (stored in correct_words). This ensures words whose individual
        // real-time writes may have failed are still captured at completion.
        const prevCorrectWords = Array.isArray(
          currentLesson?.progress?.[currentLessonLevel]?.correct_words,
        )
          ? currentLesson.progress[currentLessonLevel].correct_words
          : [];
        const currentSessionWords = masteredWordsByLevelRef.current[levelKey]
          ? [...masteredWordsByLevelRef.current[levelKey]]
          : [];
        const allMasteredSet = new Set([
          ...prevCorrectWords.map((w) =>
            String(w || "")
              .trim()
              .toUpperCase(),
          ),
          ...currentSessionWords,
        ]);
        const levelMasteredWords = [...allMasteredSet].filter(Boolean);

        // Explicitly merge correct_words into nextProgress so the saved value
        // is guaranteed to contain all unique words from this and prior sessions.
        const progressWithMergedWords = {
          ...nextProgress,
          [currentLessonLevel]: {
            ...(nextProgress[currentLessonLevel] || {}),
            correct_words: levelMasteredWords,
          },
        };

        saveProgress(progressWithMergedWords, {
          masteredWordsByLevel: {
            [levelKey]: levelMasteredWords,
          },
        }).then(() => {
          masteredWordsByLevelRef.current[levelKey] = new Set();
          setIsSaved(true);
          const maxLevel = Object.keys(currentLesson.progress || {}).length - 1;
          const completionMessage =
            currentLessonLevel + 1 <= maxLevel
              ? `Level complete. You mastered ${levelMasteredWords.length} words and unlocked the next level.`
              : `Part complete. You mastered ${levelMasteredWords.length} words in this part.`;
          if (rewardAudioEnabled) {
            playCelebrationFanfare().catch(() => {});
          }
          triggerCelebration(completionMessage);
          enqueueSnackbar(completionMessage, { variant: "success" });
          if (currentLessonLevel + 1 <= maxLevel) {
            setLevel(currentLessonLevel + 1);
            // Advance to the next difficulty, but require an explicit manual start.
            setLessonStarted(false);
            setStartQueued(false);
            setCurrentWordIndex(0);
            setShowOutputWord(false);
            setShowWordPeek(false);
            setStartStatusMessage("");
          } else {
            history.push("/progress");
          }
        });
      }

      setInputWord("");
      setEnableInput(false);
    },
    [
      currentLesson,
      currentLessonLevel,
      currentWord,
      currentWordIndex,
      history,
      inputWord,
      triggerCelebration,
      renderScoreSnackbar,
      rewardAudioEnabled,
      resolvedWords.length,
      saveProgress,
      setLevel,
      setProgress,
      stopWordInfoSpeech,
    ],
  );

  const handleStartLesson = useCallback(
    (forceStart = false) => {
      const now = Date.now();
      if (!forceStart && now - lastStartAtRef.current < 300) {
        return;
      }
      lastStartAtRef.current = now;

      if (!lessonReady) {
        setStartQueued(true);
        setStartStatusMessage("Lesson data is still loading.");
        enqueueSnackbar("Lesson data is still loading.", {
          variant: "warning",
        });
        return;
      }

      if (resolvedWords.length === 0) {
        setStartStatusMessage("This lesson has no words available.");
        enqueueSnackbar("This lesson has no words available.", {
          variant: "warning",
        });
        return;
      }

      // Always start from saved progress for the selected level. If the UI is
      // already showing a later index, keep that index to avoid regressions.
      const safeResumeIndex =
        resolvedWords.length > 0
          ? Math.max(
              0,
              Math.min(
                resolvedWords.length - 1,
                Math.max(currentWordIndex, resumeWordIndex),
              ),
            )
          : 0;
      setCurrentWordIndex(safeResumeIndex);
      pendingManualLevelStartRef.current = false;

      markFirstLessonAttempted().catch((error) => {
        console.error("Failed to record first lesson attempt:", error);
      });

      const levelKey = String((Number(currentLessonLevel) || 0) + 1);
      masteredWordsByLevelRef.current[levelKey] = new Set();
      setSessionCorrectCount(0);
      firstCorrectCelebratedRef.current = false;
      quickWinCompletedRef.current = false;
      setQuickWinEnabledForRun(
        !hasSavedProgressToResume &&
          resumeWordIndex === 0 &&
          isDifficultyLevelOne,
      );

      setStartQueued(false);
      setStartStatusMessage("Starting lesson...");
      stopWordInfoSpeech();
      try {
        primeAudioPlayback();
      } catch (error) {
        // Continue starting even if audio priming fails in this browser.
      }
      setLessonStarted(true);
      setShowOutputWord(true);
      setShowWordPeek(false);
      setInputWord("");
      setEnableInput(false);
      setOutputWordKey((prev) => prev + 1);
      setStartStatusMessage("Lesson started.");
      enqueueSnackbar("Lesson started.", { variant: "info" });
    },
    [
      currentWordIndex,
      currentLessonLevel,
      enqueueSnackbar,
      hasSavedProgressToResume,
      isDifficultyLevelOne,
      lessonReady,
      markFirstLessonAttempted,
      resumeWordIndex,
      resolvedWords.length,
      stopWordInfoSpeech,
    ],
  );

  useEffect(() => {
    if (!startQueued || lessonStarted) {
      return;
    }
    if (resolvedWords.length > 0) {
      handleStartLesson(true);
    }
  }, [handleStartLesson, lessonStarted, resolvedWords.length, startQueued]);

  useEffect(() => {
    // Peek state applies to the active word only.
    setShowWordPeek(false);
    setWordInfoDialogOpen(false);
    setWordInfoLoading(false);
    setWordInfoError("");
    setWordInfo(null);
    setWordInfoWord("");
    setWordInfoSpeaking(false);
    // Do NOT call stopSpeaking() here. It would cancel the Chrome TTS unlock
    // utterance that primeAudioPlayback() fires inside the Start Lesson gesture,
    // breaking all subsequent TTS for that word. Dialog TTS is stopped by
    // closeWordInfoDialog, and lesson TTS is stopped on unmount.
  }, [currentWordIndex, currentLessonLevel]);

  useEffect(() => {
    if (currentLesson) {
      setStartStatusMessage("");
      return;
    }

    if (!lessonsLoading && !currentLessonLoading) {
      setStartStatusMessage("Lesson not found. Go back and pick a lesson.");
    }
  }, [currentLesson, currentLessonLoading, lessonsLoading]);

  const handleWordReadyForInput = useCallback(() => {
    if (flowGuardTimeoutRef.current) {
      clearTimeout(flowGuardTimeoutRef.current);
      flowGuardTimeoutRef.current = null;
    }
    setShowOutputWord(false);
    setEnableInput(true);
    focusAnswerInput();
  }, [focusAnswerInput]);

  const handleFlowEvent = useCallback(
    (event) => {
      const phase = event?.phase;
      const isReadyPhase =
        typeof phase === "string" && phase.toLowerCase().includes("ready");
      if (
        phase === "flow-started" ||
        phase === "flow-sequence-step" ||
        phase === "flow-phoneme-complete" ||
        phase === "flow-grapheme-complete"
      ) {
        if (flowGuardTimeoutRef.current) {
          clearTimeout(flowGuardTimeoutRef.current);
        }
        // If flow goes silent after the last cue step, open typing anyway.
        flowGuardTimeoutRef.current = setTimeout(() => {
          setShowOutputWord(false);
          setEnableInput(true);
        }, 4000);
      }

      if (isReadyPhase || phase === "flow-timeout" || phase === "flow-error") {
        if (flowGuardTimeoutRef.current) {
          clearTimeout(flowGuardTimeoutRef.current);
          flowGuardTimeoutRef.current = null;
        }
        setShowOutputWord(false);
        setEnableInput(true);
        focusAnswerInput();
      }
    },
    [focusAnswerInput],
  );

  useEffect(() => {
    return () => {
      if (flowGuardTimeoutRef.current) {
        clearTimeout(flowGuardTimeoutRef.current);
      }
      stopWordInfoSpeech();
    };
  }, [stopWordInfoSpeech]);

  const processAnswerKey = useCallback(
    (key) => {
      if (!lessonStarted || typeof key !== "string" || wordInfoDialogOpen) {
        return false;
      }

      if (document?.activeElement?.id === "lesson-word-peek-button") {
        return false;
      }

      clearWordPeek();

      // Block all input until the cue sequence has finished.
      if (!enableInput) {
        return false;
      }

      switch (key) {
        case "Enter":
        case "NumpadEnter":
        case "Return":
          if (enableInput) {
            handleSubmit();
            return true;
          }
          return false;
        case "Backspace":
          setInputWord((prev) => prev.slice(0, -1));
          return true;
        case "Escape":
        case "Esc":
          setInputWord("");
          return true;
        default:
          if (key.length === 1 && !/^[\r\n]$/.test(key)) {
            setInputWord((prev) => `${prev}${key.toUpperCase()}`);
            return true;
          }
          return false;
      }
    },
    [
      clearWordPeek,
      enableInput,
      handleSubmit,
      lessonStarted,
      wordInfoDialogOpen,
    ],
  );

  useEffect(() => {
    if (!lessonStarted) {
      return;
    }

    const handleWindowKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const consumed = processAnswerKey(event.key);
      if (consumed) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, [lessonStarted, processAnswerKey]);

  useEffect(() => {
    if (lessonStarted && enableInput) {
      focusAnswerInput();
    }
  }, [enableInput, focusAnswerInput, lessonStarted]);

  useEffect(() => {
    if (!lessonStarted || !showOutputWord || enableInput) {
      return;
    }

    // Absolute fallback: never remain stuck in cue mode indefinitely.
    const id = setTimeout(() => {
      setShowOutputWord(false);
      setEnableInput(true);
      focusAnswerInput();
    }, 15000);

    return () => clearTimeout(id);
  }, [enableInput, focusAnswerInput, lessonStarted, showOutputWord]);

  const save = () => {
    clearWordPeek();
    const levelKey = String((Number(currentLessonLevel) || 0) + 1);
    const prevCorrectWords = Array.isArray(
      currentLesson?.progress?.[currentLessonLevel]?.correct_words,
    )
      ? currentLesson.progress[currentLessonLevel].correct_words
      : [];
    const currentSessionWords = masteredWordsByLevelRef.current[levelKey]
      ? [...masteredWordsByLevelRef.current[levelKey]]
      : [];
    const allMasteredSet = new Set([
      ...prevCorrectWords.map((w) =>
        String(w || "")
          .trim()
          .toUpperCase(),
      ),
      ...currentSessionWords,
    ]);
    const levelMasteredWords = [...allMasteredSet].filter(Boolean);

    // Build an explicit progress override so correct_words is guaranteed to
    // include the merged set from both the current session and any prior
    // sessions — regardless of any closure-timing differences.
    const progressOverride = currentLesson?.progress
      ? {
          ...currentLesson.progress,
          [currentLessonLevel]: {
            ...(currentLesson.progress[currentLessonLevel] || {}),
            correct_words: levelMasteredWords,
          },
        }
      : undefined;

    saveProgress(progressOverride, {
      masteredWordsByLevel: {
        [levelKey]: levelMasteredWords,
      },
    }).then(() => {
      masteredWordsByLevelRef.current[levelKey] = new Set();
      setIsSaved(true);
    });
  };

  const handleRepeatWord = () => {
    if (!lessonStarted) {
      return;
    }
    stopWordInfoSpeech();
    clearWordPeek();
    setShowOutputWord(true);
    setOutputWordKey((prev) => prev + 1);
    setInputWord("");
    setEnableInput(false);
    setIsSaved(false);
  };

  const handleSkipWord = () => {
    stopWordInfoSpeech();
    clearWordPeek();
    handleSubmit(false);
  };

  const handleShowWord = useCallback(() => {
    if (
      !lessonStarted ||
      !enableInput ||
      !isDifficultyLevelOne ||
      !currentWord
    ) {
      return;
    }
    setShowWordPeek(true);
  }, [currentWord, enableInput, isDifficultyLevelOne, lessonStarted]);

  const handleSetCueSpeedPreset = useCallback(
    (nextPreset) => {
      const normalizedPreset = String(nextPreset || "").toLowerCase();
      if (
        normalizedPreset === cueSpeedPreset ||
        !CUE_SPEED_PRESET_OPTIONS.includes(normalizedPreset)
      ) {
        return;
      }

      const appliedPreset = applyLessonFlowTimingPreset(normalizedPreset);
      setCueSpeedPreset(appliedPreset);
      window.localStorage.setItem(CUE_SPEED_PRESET_STORAGE_KEY, appliedPreset);
      enqueueSnackbar(`Cue speed set to ${CUE_SPEED_LABELS[appliedPreset]}.`, {
        variant: "info",
      });
    },
    [cueSpeedPreset, enqueueSnackbar],
  );

  const handleSetRewardAudioEnabled = useCallback(
    (nextValue) => {
      const enabled = Boolean(nextValue);
      setRewardAudioEnabled(enabled);
      try {
        window.localStorage.setItem(
          REWARD_AUDIO_ENABLED_STORAGE_KEY,
          enabled ? "true" : "false",
        );
      } catch (_error) {
        // Ignore storage failures.
      }
      enqueueSnackbar(enabled ? "Reward sounds on." : "Reward sounds off.", {
        variant: "info",
      });
    },
    [enqueueSnackbar],
  );

  const handleSetCelebrationMotionEnabled = useCallback(
    (nextValue) => {
      const enabled = Boolean(nextValue);
      setCelebrationMotionEnabled(enabled);
      try {
        window.localStorage.setItem(
          CELEBRATION_MOTION_ENABLED_STORAGE_KEY,
          enabled ? "true" : "false",
        );
      } catch (_error) {
        // Ignore storage failures.
      }
      enqueueSnackbar(
        enabled ? "Celebration motion on." : "Celebration motion off.",
        { variant: "info" },
      );
    },
    [enqueueSnackbar],
  );

  return (
    <>
      <Prompt
        message="You have unsaved changes, are you sure you want to leave?"
        when={!isSaved}
      />
      <Container maxWidth="md">
        <Grid container spacing={2} direction="column">
          <Grid item>
            <Paper
              style={{
                padding: 12,
                borderRadius: 12,
                backgroundColor: "#f9fbfd",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                Reward Settings
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>
                    Reward sounds
                  </div>
                  <ButtonGroup color="primary" size="small">
                    <Button
                      variant={rewardAudioEnabled ? "contained" : "outlined"}
                      onClick={() => handleSetRewardAudioEnabled(true)}
                    >
                      On
                    </Button>
                    <Button
                      variant={!rewardAudioEnabled ? "contained" : "outlined"}
                      onClick={() => handleSetRewardAudioEnabled(false)}
                    >
                      Off
                    </Button>
                  </ButtonGroup>
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>
                    Celebration motion
                  </div>
                  <ButtonGroup color="primary" size="small">
                    <Button
                      variant={
                        celebrationMotionEnabled ? "contained" : "outlined"
                      }
                      onClick={() => handleSetCelebrationMotionEnabled(true)}
                      disabled={prefersReducedMotion}
                    >
                      On
                    </Button>
                    <Button
                      variant={
                        !celebrationMotionEnabled ? "contained" : "outlined"
                      }
                      onClick={() => handleSetCelebrationMotionEnabled(false)}
                    >
                      Off
                    </Button>
                  </ButtonGroup>
                </div>
                <div style={{ fontSize: 12, color: "#5f6b76" }}>
                  Background music stays off by default to protect focus.
                  {prefersReducedMotion
                    ? " Reduced-motion preference detected."
                    : ""}
                </div>
              </div>
            </Paper>
          </Grid>

          {celebrationMessage && (
            <Grid item>
              <Paper
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background:
                    "linear-gradient(180deg, #eef9f1 0%, #e5f5ea 100%)",
                  border: "1px solid #cce8d6",
                  opacity: celebrationActive || prefersReducedMotion ? 1 : 0.8,
                  transform:
                    celebrationActive && !prefersReducedMotion
                      ? "translateY(0) scale(1.01)"
                      : "translateY(0) scale(1)",
                  boxShadow:
                    celebrationActive && !prefersReducedMotion
                      ? "0 10px 24px rgba(56, 117, 78, 0.16)"
                      : "none",
                  transition: prefersReducedMotion
                    ? "none"
                    : "transform 180ms ease-out, opacity 180ms ease-out, box-shadow 220ms ease-out",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  Milestone Reached
                </div>
                <div style={{ fontSize: 14 }}>{celebrationMessage}</div>
              </Paper>
            </Grid>
          )}

          {lessonStarted && quickWinEnabledForRun && (
            <Grid item>
              <Paper
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background:
                    "linear-gradient(180deg, #fffdf4 0%, #fff7ea 100%)",
                  border: "1px solid #f1e3cc",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  Quick Win
                </div>
                <div style={{ fontSize: 14 }}>
                  {Math.min(
                    sessionCorrectCount,
                    FIRST_SESSION_QUICK_WIN_TARGET,
                  )}
                  /{FIRST_SESSION_QUICK_WIN_TARGET} correct words this session.
                </div>
                <div style={{ fontSize: 13, marginTop: 2, color: "#4d4d4d" }}>
                  {sessionCorrectCount >= FIRST_SESSION_QUICK_WIN_TARGET
                    ? "Next action: keep this lesson going while momentum is high."
                    : "Next action: type the next word to reach your first quick win."}
                </div>
              </Paper>
            </Grid>
          )}

          <Grid item>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                margin: "0 auto",
                width: "fit-content",
              }}
            >
              <LevelPicker
                onSelectLevel={handleSelectLevel}
                disabled={lessonStarted}
              />
              {!lessonStarted && (
                <>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={() => handleStartLesson(true)}
                    style={{
                      fontWeight: 700,
                      minHeight: 48,
                      width: "100%",
                      marginTop: 8,
                    }}
                  >
                    {lessonsLoading
                      ? "Loading Lesson..."
                      : startQueued
                        ? "Starting..."
                        : hasSavedProgressToResume
                          ? "Continue Lesson"
                          : "Start Lesson"}
                  </Button>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      textAlign: "center",
                    }}
                  >
                    {lessonsLoading || currentLessonLoading
                      ? "Preparing lesson data..."
                      : canStartLesson
                        ? ""
                        : "Lesson is not ready yet. Click Start for details."}
                  </div>
                  {startStatusMessage && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 12,
                        textAlign: "center",
                      }}
                    >
                      {startStatusMessage}
                    </div>
                  )}
                </>
              )}
              {lessonPatternRules.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <PatternButton
                    rules={lessonPatternRules}
                    buttonLabel="Spelling Patterns"
                    dialogTitle="Spelling Patterns"
                  />
                </div>
              )}
            </div>
          </Grid>
          <Grid item>
            <LessonProgress
              variant="determinate"
              currentWordIndex={currentWordIndex}
            />
          </Grid>
        </Grid>

        <Paper
          className={classes.textbox}
          style={{
            minHeight: 260,
            height: "auto",
            padding: "20px 30px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "inherit",
          }}
        >
          <div
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ width: "100%", pointerEvents: "none" }}>
              {showOutputWord && lessonStarted && currentWord && (
                <OutputWord
                  wordString={currentWord}
                  index={currentWordIndex}
                  wordNumber={currentWordIndex + 1}
                  onReadyForInput={handleWordReadyForInput}
                  onFlowEvent={handleFlowEvent}
                  key={outputWordKey}
                />
              )}
            </div>

            <textarea
              id="lesson-answer-input"
              name="lessonAnswer"
              ref={answerInputRef}
              value={inputWord}
              rows={1}
              onMouseEnter={clearWordPeek}
              onMouseOver={clearWordPeek}
              onPointerEnter={clearWordPeek}
              onMouseDown={clearWordPeek}
              onFocus={clearWordPeek}
              onChange={(event) => {
                clearWordPeek();
                if (!enableInput) {
                  return;
                }
                setInputWord(String(event.target.value || "").toUpperCase());
              }}
              onKeyDown={(event) => {
                if (processAnswerKey(event.key)) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              readOnly={!enableInput}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              style={{
                display: lessonStarted && !enableInput ? "none" : undefined,
                width: "100%",
                maxWidth: 640,
                fontSize: enableInput && !inputWord ? 18 : 36,
                fontFamily: "inherit",
                textAlign: "center",
                border: "2px solid #90caf9",
                borderRadius: 8,
                padding: "10px 12px",
                outline: "none",
                background: enableInput ? "#fff" : "#f5f5f5",
                color: "#111",
                caretColor: "#111",
                boxSizing: "border-box",
                resize: "none",
                overflow: "hidden",
              }}
              placeholder={
                lessonStarted
                  ? enableInput
                    ? "Type the word here and then press the Return key."
                    : ""
                  : "Start lesson to type"
              }
            />
          </div>
        </Paper>

        <Dialog
          open={wordInfoDialogOpen}
          onClose={closeWordInfoDialog}
          fullWidth
          maxWidth="sm"
          aria-labelledby="word-info-dialog-title"
        >
          <DialogTitle id="word-info-dialog-title">
            {`Word Info: ${String(wordInfoWord || "").toUpperCase()}`}
          </DialogTitle>
          <DialogContent dividers>
            {wordInfoLoading && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <CircularProgress size={18} />
                <span>Loading local Wiktionary definition...</span>
              </div>
            )}
            {!wordInfoLoading && wordInfoError && (
              <div style={{ color: "#b00020" }}>{wordInfoError}</div>
            )}
            {!wordInfoLoading && !wordInfoError && wordInfo && (
              <div style={{ display: "grid", gap: 10 }}>
                {wordInfo.partOfSpeech && (
                  <div>
                    <strong>Part of speech:</strong> {wordInfo.partOfSpeech}
                  </div>
                )}
                <div>
                  <strong>Definition:</strong> {wordInfo.definition}
                </div>
                <div>
                  <strong>Example sentence:</strong>{" "}
                  {wordInfo.exampleSentence || "No example sentence available."}
                </div>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            {wordInfoTalkEnabled && (
              <Button
                onClick={handleTalkWordInfo}
                disabled={
                  wordInfoLoading ||
                  wordInfoSpeaking ||
                  !lessonStarted ||
                  !enableInput ||
                  !wordInfo ||
                  Boolean(wordInfoError)
                }
              >
                {wordInfoSpeaking ? "Talking..." : "Talk"}
              </Button>
            )}
            <Button
              onClick={() => loadWordInfoForWord(wordInfoWord || currentWord)}
              disabled={
                wordInfoLoading ||
                !String(wordInfoWord || currentWord || "").trim()
              }
            >
              Retry
            </Button>
            <Button onClick={closeWordInfoDialog}>Close</Button>
          </DialogActions>
        </Dialog>

        {lessonStarted && <Keyboard interactive={false} />}

        <Grid item align="center">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                minHeight: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {showWordPeek && lessonStarted && enableInput && currentWord && (
                <button
                  type="button"
                  id="lesson-word-peek-button"
                  onClick={openWordInfoDialog}
                  aria-label="Show definition and sentence"
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    color: "#0d47a1",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {currentWord.toUpperCase()}
                </button>
              )}
            </div>
            <ButtonGroup color="primary" size="small">
              {CUE_SPEED_PRESET_OPTIONS.map((preset) => (
                <Button
                  key={preset}
                  variant={cueSpeedPreset === preset ? "contained" : "outlined"}
                  color="primary"
                  onClick={() => handleSetCueSpeedPreset(preset)}
                  style={{ fontSize: 11, minWidth: 52, padding: "2px 8px" }}
                >
                  {CUE_SPEED_LABELS[preset]}
                </Button>
              ))}
            </ButtonGroup>
            <ButtonGroup
              color="primary"
              variant="contained"
              style={{
                display: !lessonStarted || !enableInput ? "none" : undefined,
              }}
            >
              <Button
                variant="contained"
                color="primary"
                onClick={handleRepeatWord}
                disabled={!lessonStarted || !enableInput}
              >
                Repeat
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={handleShowWord}
                disabled={
                  !lessonStarted || !enableInput || !isDifficultyLevelOne
                }
                title={
                  isDifficultyLevelOne
                    ? "Show a peek of the current word"
                    : "Available only on difficulty level 1"
                }
              >
                Show
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={handleSkipWord}
                disabled={!lessonStarted || !enableInput}
              >
                Skip
              </Button>
            </ButtonGroup>
            <ButtonGroup
              orientation="vertical"
              color="primary"
              variant="contained"
            >
              <Button
                variant="contained"
                color="primary"
                onClick={save}
                disabled={isSaved}
                style={{ display: isSaved ? "none" : undefined }}
              >
                Save Progress
              </Button>
            </ButtonGroup>
          </div>
        </Grid>

        {currentLessonProgress && currentLessonProgress[currentLessonLevel] && (
          <Grid item>
            Lesson Words Correct:{" "}
            {Array.isArray(
              currentLessonProgress[currentLessonLevel].correct_words,
            )
              ? currentLessonProgress[currentLessonLevel].correct_words.length
              : 0}
          </Grid>
        )}
      </Container>
    </>
  );
}
