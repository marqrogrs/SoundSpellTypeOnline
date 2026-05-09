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
import { Container, Button, Grid, Paper } from "@material-ui/core";
import ButtonGroup from "@material-ui/core/ButtonGroup";

import { useParams, useHistory } from "react-router-dom";
import { LessonContext } from "../providers/LessonProvider";
import { primeAudioPlayback } from "../util/Audio";
import {
  SUCCESS_MESSAGES,
  FAILURE_MESSAGES,
  applyLessonFlowTimingPreset,
} from "../util/constants";
import { useStyles } from "../styles/material";

import { useSnackbar } from "notistack";
import sample from "lodash/sample";

const CUE_SPEED_PRESET_STORAGE_KEY = "soundspeller.lessonCueSpeedPreset";
const CUE_SPEED_PRESET_OPTIONS = ["slower", "normal", "faster"];
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
    markFirstLessonAttempted,
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

      const wordsLength = resolvedWords.length;
      const completedWordsRaw = Number(
        currentLesson.progress?.[currentLessonLevel]?.completed_words,
      );
      const completedWords = Number.isFinite(completedWordsRaw)
        ? completedWordsRaw
        : 0;
      const startWord =
        wordsLength === 0
          ? 0
          : completedWords >= wordsLength
            ? 0
            : Math.max(0, completedWords);

      setCurrentWordIndex(startWord);

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
    resolvedWords,
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
    },
    [setLevel],
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
      }

      const nextProgress = setProgress(currentWordIndex + 1, {
        isCorrect,
        word: currentWord,
      });

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
      renderScoreSnackbar,
      resolvedWords.length,
      saveProgress,
      setLevel,
      setProgress,
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

      if (pendingManualLevelStartRef.current) {
        setCurrentWordIndex(0);
        pendingManualLevelStartRef.current = false;
      }

      markFirstLessonAttempted().catch((error) => {
        console.error("Failed to record first lesson attempt:", error);
      });

      const levelKey = String((Number(currentLessonLevel) || 0) + 1);
      masteredWordsByLevelRef.current[levelKey] = new Set();

      setStartQueued(false);
      setStartStatusMessage("Starting lesson...");
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
      currentLessonLevel,
      enqueueSnackbar,
      lessonReady,
      markFirstLessonAttempted,
      resolvedWords.length,
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
    };
  }, []);

  const processAnswerKey = useCallback(
    (key) => {
      if (!lessonStarted || typeof key !== "string") {
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
    [clearWordPeek, enableInput, handleSubmit, lessonStarted],
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
    clearWordPeek();
    setShowOutputWord(true);
    setOutputWordKey((prev) => prev + 1);
    setInputWord("");
    setEnableInput(false);
    setIsSaved(false);
  };

  const handleSkipWord = () => {
    clearWordPeek();
    handleSubmit(false);
  };

  const handleJumpToLastWord = useCallback(() => {
    if (!lessonStarted || resolvedWords.length === 0) {
      return;
    }

    const targetIndex = Math.max(0, resolvedWords.length - 1);
    const targetCompletedWords = targetIndex;

    clearWordPeek();
    setProgress(targetCompletedWords, { isCorrect: false });
    setCurrentWordIndex(targetIndex);
    setShowOutputWord(true);
    setOutputWordKey((prev) => prev + 1);
    setInputWord("");
    setEnableInput(false);
    setIsSaved(false);
    enqueueSnackbar("Jumped to the last word.", { variant: "info" });
  }, [
    enqueueSnackbar,
    lessonStarted,
    resolvedWords.length,
    setProgress,
    clearWordPeek,
  ]);

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

  return (
    <>
      <Prompt
        message="You have unsaved changes, are you sure you want to leave?"
        when={!isSaved}
      />
      <Container maxWidth="md">
        <Grid container spacing={2} direction="column">
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
                fontSize: 36,
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
                    ? "Type word"
                    : ""
                  : "Start lesson to type"
              }
            />

            {showWordPeek && lessonStarted && enableInput && currentWord && (
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  color: "#0d47a1",
                }}
              >
                {currentWord.toUpperCase()}
              </div>
            )}

            <Button
              variant="contained"
              color="secondary"
              onClick={handleShowWord}
              disabled={!lessonStarted || !enableInput || !isDifficultyLevelOne}
              style={{
                minWidth: 180,
                display:
                  !lessonStarted || !enableInput || !isDifficultyLevelOne
                    ? "none"
                    : undefined,
              }}
              title={
                isDifficultyLevelOne
                  ? "Show a peek of the current word"
                  : "Available only on difficulty level 1"
              }
            >
              Show Word
            </Button>
          </div>
        </Paper>

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
                onClick={handleJumpToLastWord}
                disabled={!lessonStarted}
                style={{ display: !lessonStarted ? "none" : undefined }}
              >
                Jump To Last Word
              </Button>
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
