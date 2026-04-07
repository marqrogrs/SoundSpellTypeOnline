import React, {
  useState,
  useEffect,
  useContext,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Prompt } from "react-router-dom";

import SpeechRateFab from "../components/SpeechRateFab";
import Keyboard from "../components/Keyboard";
import OutputWord from "../components/OutputWord";
import LessonProgress from "../components/LessonProgress";
import LevelPicker from "../components/LevelPicker";
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
var _ = require("lodash");

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
    setLesson,
    currentLesson,
    lessonsLoading,
    currentLessonLoading,
    setProgress,
    currentLessonLevel,
    currentLessonProgress,
    setLevel,
  } = useContext(LessonContext);

  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [lessonStarted, setLessonStarted] = useState(false);
  const [startQueued, setStartQueued] = useState(false);
  const [inputWord, setInputWord] = useState("");
  const [enableInput, setEnableInput] = useState(false);
  const [isSaved, setIsSaved] = useState(true);
  const [outputWordKey, setOutputWordKey] = useState(0);
  const [showOutputWord, setShowOutputWord] = useState(false);
  const [startStatusMessage, setStartStatusMessage] = useState("");
  const [cueSpeedPreset, setCueSpeedPreset] = useState("normal");

  const params = useParams();
  const history = useHistory();

  const previousLevelRef = useRef();
  const previousLessonIdRef = useRef();
  const pendingManualLevelStartRef = useRef(false);
  const lastStartAtRef = useRef(0);
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
      setLesson({ lesson_id: params.lesson });
    }
  }, [params.lesson, lessonsLoading, setLesson]);

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
        ? `${_.sample(SUCCESS_MESSAGES)} +${(currentLessonLevel + 1) * 5} points`
        : _.sample(FAILURE_MESSAGES);
      const variant = success ? "success" : "error";
      enqueueSnackbar(message, { variant });
    },
    [currentLessonLevel, enqueueSnackbar],
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

      const scoreIncrement = isCorrect ? (currentLessonLevel + 1) * 5 : 0;
      const nextProgress = setProgress(currentWordIndex + 1, scoreIncrement);

      if (currentWordIndex < resolvedWords.length - 1) {
        setCurrentWordIndex((prev) => prev + 1);
        setShowOutputWord(true);
        setOutputWordKey((prev) => prev + 1);
        setIsSaved(false);
      } else {
        saveProgress(nextProgress).then(() => {
          setIsSaved(true);
          const maxLevel = Object.keys(currentLesson.progress || {}).length - 1;
          if (currentLessonLevel + 1 <= maxLevel) {
            setLevel(currentLessonLevel + 1);
            // Auto-start the new level: reset word index and begin the first word cue.
            setCurrentWordIndex(0);
            setShowOutputWord(true);
            setOutputWordKey((prev) => prev + 1);
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

      setStartQueued(false);
      setStartStatusMessage("Starting lesson...");
      try {
        primeAudioPlayback();
      } catch (error) {
        // Continue starting even if audio priming fails in this browser.
      }
      setLessonStarted(true);
      setShowOutputWord(true);
      setInputWord("");
      setEnableInput(false);
      setOutputWordKey((prev) => prev + 1);
      setStartStatusMessage("Lesson started.");
      enqueueSnackbar("Lesson started.", { variant: "info" });
    },
    [enqueueSnackbar, lessonReady, resolvedWords.length],
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

  useEffect(() => {
    const handleStartHotkey = (event) => {
      if (lessonStarted || event.repeat) {
        return;
      }
      if (event.key === "s" || event.key === "S") {
        handleStartLesson();
      }
    };

    window.addEventListener("keydown", handleStartHotkey);
    return () => {
      window.removeEventListener("keydown", handleStartHotkey);
    };
  }, [handleStartLesson, lessonStarted]);

  const processAnswerKey = useCallback(
    (key) => {
      if (!lessonStarted || typeof key !== "string") {
        return false;
      }

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
    [enableInput, handleSubmit, lessonStarted],
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
    saveProgress().then(() => {
      setIsSaved(true);
    });
  };

  const handleRepeatWord = () => {
    if (!lessonStarted) {
      return;
    }
    setShowOutputWord(true);
    setOutputWordKey((prev) => prev + 1);
    setInputWord("");
    setEnableInput(false);
    setIsSaved(false);
  };

  const handleSkipWord = () => {
    handleSubmit(false);
  };

  const handleJumpToLastWord = useCallback(() => {
    if (!lessonStarted || resolvedWords.length === 0) {
      return;
    }

    const targetIndex = Math.max(0, resolvedWords.length - 1);
    const pointsPerWord = (currentLessonLevel + 1) * 5;
    const targetCompletedWords = targetIndex;
    const targetScore = targetCompletedWords * pointsPerWord;
    const currentScore = Number(
      currentLessonProgress?.[currentLessonLevel]?.score || 0,
    );
    const scoreIncrement = Math.max(0, targetScore - currentScore);

    setProgress(targetCompletedWords, scoreIncrement);
    setCurrentWordIndex(targetIndex);
    setShowOutputWord(true);
    setOutputWordKey((prev) => prev + 1);
    setInputWord("");
    setEnableInput(false);
    setIsSaved(false);
    enqueueSnackbar("Jumped to the last word.", { variant: "info" });
  }, [
    currentLessonLevel,
    currentLessonProgress,
    enqueueSnackbar,
    lessonStarted,
    resolvedWords.length,
    setProgress,
  ]);

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
          {!lessonStarted && (
            <Grid item>
              <Button
                fullWidth
                variant="contained"
                color="primary"
                onClick={() => handleStartLesson(true)}
                style={{ fontWeight: 700, minHeight: 48 }}
              >
                {lessonsLoading
                  ? "Loading Lesson..."
                  : startQueued
                    ? "Starting..."
                    : "Start Lesson"}
              </Button>
              <div style={{ marginTop: 6, fontSize: 12, textAlign: "center" }}>
                {canStartLesson
                  ? "Press S to start"
                  : lessonsLoading || currentLessonLoading
                    ? "Preparing lesson data..."
                    : "Lesson is not ready yet. Click Start for details."}
              </div>
              {startStatusMessage && (
                <div
                  style={{ marginTop: 4, fontSize: 12, textAlign: "center" }}
                >
                  {startStatusMessage}
                </div>
              )}
            </Grid>
          )}
          <Grid item>
            <LevelPicker onSelectLevel={handleSelectLevel} />
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
                    : "Listen..."
                  : "Start lesson to type"
              }
            />
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
            <div style={{ fontSize: 12, fontWeight: 600 }}>Cue Speed</div>
            <ButtonGroup color="primary" size="small">
              {CUE_SPEED_PRESET_OPTIONS.map((preset) => (
                <Button
                  key={preset}
                  variant={cueSpeedPreset === preset ? "contained" : "outlined"}
                  color="primary"
                  onClick={() => handleSetCueSpeedPreset(preset)}
                >
                  {CUE_SPEED_LABELS[preset]}
                </Button>
              ))}
            </ButtonGroup>
            <ButtonGroup
              orientation="vertical"
              color="primary"
              variant="contained"
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
              <Button
                variant="contained"
                color="primary"
                onClick={handleJumpToLastWord}
                disabled={!lessonStarted}
              >
                Jump To Last Word
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={save}
                disabled={isSaved}
              >
                Save Progress
              </Button>
            </ButtonGroup>
          </div>
        </Grid>

        {currentLessonProgress && currentLessonProgress[currentLessonLevel] && (
          <Grid item>
            Lesson Score: {currentLessonProgress[currentLessonLevel].score}
          </Grid>
        )}
        <SpeechRateFab />
      </Container>
    </>
  );
}
