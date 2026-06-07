/**
 * CustomLesson.js
 *
 * Custom-lesson player. Uses the same OutputWord/Keyboard machinery as
 * Lesson.js but sources word data from the `customLessons` Firestore
 * collection and saves progress to `customLessonProgress`.
 *
 * Route: /lesson/custom/:lessonId
 */
import React, {
  useState,
  useEffect,
  useContext,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Prompt, useParams, useHistory } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { UserContext } from "../providers/UserProvider";
import {
  getCustomLesson,
  startCustomLessonAttempt,
  updateCustomLessonProgress,
  completeCustomLessonAttempt,
} from "../util/customLessonHelpers";
import firebase from "../firebase";
import {
  primeAudioPlayback,
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

import Keyboard from "../components/Keyboard";
import OutputWord from "../components/OutputWord";

import {
  Container,
  Button,
  Grid,
  Paper,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@material-ui/core";
import ButtonGroup from "@material-ui/core/ButtonGroup";
import LinearProgress from "@material-ui/core/LinearProgress";
import Box from "@material-ui/core/Box";
import CircularProgress from "@material-ui/core/CircularProgress";

import { useSnackbar } from "notistack";
import { useStyles } from "../styles/material";
import sample from "lodash/sample";

const CUE_SPEED_PRESET_STORAGE_KEY = "soundspeller.lessonCueSpeedPreset";
const WORD_INFO_TALK_ENABLED_STORAGE_KEY = "soundspeller.wordInfoTalkEnabled";
const CUE_SPEED_PRESET_OPTIONS = ["slower", "normal", "faster"];
const CUE_SPEED_LABELS = {
  slower: "Slower",
  normal: "Normal",
  faster: "Faster",
};

export default function CustomLesson() {
  const { enqueueSnackbar } = useSnackbar();
  const classes = useStyles();
  const history = useHistory();
  const { lessonId } = useParams();
  const auth = useAuth();
  const { userData } = useContext(UserContext);

  const isEducator = auth.isEducator;
  const userId = auth.user?.uid || "";
  // Progress records are keyed by auth UID to match Firestore rules.
  const studentId = userId;
  const studentName =
    userData?.displayName || userData?.username || userData?.email || studentId;
  const educatorId = isEducator ? userId : userData?.educator || null;

  // ─── Lesson data ─────────────────────────────────────────────────────────
  const [lessonData, setLessonData] = useState(null);
  const [lessonLoading, setLessonLoading] = useState(true);
  const [lessonError, setLessonError] = useState(null);

  // ─── Progress record ──────────────────────────────────────────────────────

  const [progressDocId, setProgressDocId] = useState(null); // doc id after attempt started

  // ─── Lesson play state ────────────────────────────────────────────────────
  const [selectedLevel, setSelectedLevel] = useState(0); // 0-based index into difficultyLevels
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [lessonStarted, setLessonStarted] = useState(false);
  const [inputWord, setInputWord] = useState("");
  const [enableInput, setEnableInput] = useState(false);
  const [isSaved, setIsSaved] = useState(true);
  const [outputWordKey, setOutputWordKey] = useState(0);
  const [showOutputWord, setShowOutputWord] = useState(false);
  const [showWordPeek, setShowWordPeek] = useState(false);
  const [cueSpeedPreset, setCueSpeedPreset] = useState("normal");
  const [wordInfoDialogOpen, setWordInfoDialogOpen] = useState(false);
  const [wordInfoWord, setWordInfoWord] = useState("");
  const [wordInfo, setWordInfo] = useState(null);
  const [wordInfoLoading, setWordInfoLoading] = useState(false);
  const [wordInfoError, setWordInfoError] = useState("");
  const [wordInfoSpeaking, setWordInfoSpeaking] = useState(false);

  const lastStartAtRef = useRef(0);
  const answerInputRef = useRef(null);
  const flowGuardTimeoutRef = useRef(null);
  const wordInfoRequestIdRef = useRef(0);
  const wordInfoTalkRequestIdRef = useRef(0);

  // ─── Load lesson ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!lessonId) return;
    setLessonLoading(true);
    getCustomLesson(lessonId)
      .then((data) => {
        if (!data) {
          setLessonError("Lesson not found.");
        } else {
          setLessonData(data);
        }
      })
      .catch(() => setLessonError("Failed to load lesson."))
      .finally(() => setLessonLoading(false));
  }, [lessonId]);

  // ─── Derived lesson state ─────────────────────────────────────────────────
  const availableLevels = useMemo(() => {
    const rawLevels = Array.isArray(lessonData?.difficultyLevels)
      ? lessonData.difficultyLevels
      : [1, 2, 3];
    const normalizedLevels = rawLevels
      .map((level) => Number(level))
      .filter((level) => Number.isFinite(level));

    // Backward compatibility: older lessons may store 0/1/2 for levels.
    const legacyZeroBasedLevels =
      normalizedLevels.length > 0 &&
      normalizedLevels.every((level) => level <= 2);
    const migratedLevels = legacyZeroBasedLevels
      ? normalizedLevels.map((level) => level + 1)
      : normalizedLevels;

    return (migratedLevels.length > 0 ? migratedLevels : [1, 2, 3]).sort(
      (a, b) => a - b,
    );
  }, [lessonData]);

  const words = useMemo(() => lessonData?.words || [], [lessonData]);
  const currentWord = words[currentWordIndex] || null;

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

  const selectedDifficultyLevel =
    availableLevels[selectedLevel] || availableLevels[0] || 1;
  const isDifficultyLevelOne = selectedDifficultyLevel === 1;

  useEffect(() => {
    if (selectedLevel >= availableLevels.length) {
      setSelectedLevel(0);
    }
  }, [availableLevels, selectedLevel]);

  // ─── Restore cue speed ────────────────────────────────────────────────────
  useEffect(() => {
    const stored = window.localStorage.getItem(CUE_SPEED_PRESET_STORAGE_KEY);
    setCueSpeedPreset(applyLessonFlowTimingPreset(stored || "normal"));
  }, []);

  // ─── Prevent accidental navigation ───────────────────────────────────────
  useEffect(() => {
    window.onbeforeunload = () => true;
    return () => {
      window.onbeforeunload = null;
    };
  }, []);

  // ─── Focus input ─────────────────────────────────────────────────────────
  const focusAnswerInput = useCallback(() => {
    setTimeout(() => {
      if (answerInputRef.current) answerInputRef.current.focus();
    }, 0);
  }, []);

  const clearWordPeek = useCallback(() => setShowWordPeek(false), []);

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

  useEffect(() => {
    if (wordInfoSpeaking && (!lessonStarted || !enableInput)) {
      stopWordInfoSpeech();
    }
  }, [enableInput, lessonStarted, stopWordInfoSpeech, wordInfoSpeaking]);

  useEffect(() => {
    return () => {
      stopWordInfoSpeech();
    };
  }, [stopWordInfoSpeech]);

  // ─── Start lesson (new attempt) ───────────────────────────────────────────
  const handleStartLesson = useCallback(
    async (forceStart = false) => {
      const now = Date.now();
      if (!forceStart && now - lastStartAtRef.current < 300) return;
      lastStartAtRef.current = now;

      if (!lessonData || words.length === 0) {
        enqueueSnackbar("Lesson has no words.", { variant: "warning" });
        return;
      }

      try {
        primeAudioPlayback();
      } catch {}

      stopWordInfoSpeech();

      // Reset word cursor — always restart from word 0
      setCurrentWordIndex(0);
      setInputWord("");
      setEnableInput(false);
      setShowWordPeek(false);
      setIsSaved(true);

      // Create / reset Firestore progress record
      let docId = null;
      try {
        docId = await startCustomLessonAttempt({
          lessonId,
          lessonName: lessonData.name,
          studentId,
          studentName,
          totalWords: words.length,
          educatorId,
        });
      } catch (error) {
        console.error("Failed to start custom lesson attempt:", error);
        enqueueSnackbar("Could not save lesson progress. Please try again.", {
          variant: "error",
        });
        return;
      }
      setProgressDocId(docId);

      setLessonStarted(true);
      setShowOutputWord(true);
      setOutputWordKey((prev) => prev + 1);
      enqueueSnackbar("Lesson started.", { variant: "info" });
    },
    [
      educatorId,
      enqueueSnackbar,
      lessonData,
      lessonId,
      stopWordInfoSpeech,
      studentId,
      studentName,
      words,
    ],
  );

  // ─── Handle word submission ───────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (checkScore = true) => {
      if (!currentWord) return;

      const isCorrect =
        checkScore && inputWord.toLowerCase() === currentWord.toLowerCase();

      const message = isCorrect
        ? `${sample(SUCCESS_MESSAGES)} +${selectedDifficultyLevel * 5} points`
        : sample(FAILURE_MESSAGES);
      enqueueSnackbar(message, { variant: isCorrect ? "success" : "error" });

      const nextIndex = currentWordIndex + 1;
      const isLastWord = nextIndex >= words.length;

      // Update Firestore progress
      if (progressDocId) {
        const isLevel3Mastery =
          isCorrect && selectedDifficultyLevel === 3 && Boolean(currentWord);
        const masteryUpdate = isLevel3Mastery
          ? {
              masteredWordsLevel3:
                firebase.firestore.FieldValue.arrayUnion(currentWord),
            }
          : {};
        const wordsCompleted = isLastWord ? words : words.slice(0, nextIndex);
        try {
          if (isLastWord) {
            await completeCustomLessonAttempt(progressDocId, masteryUpdate);
          } else {
            await updateCustomLessonProgress(progressDocId, {
              wordsCompleted: wordsCompleted.slice(0, currentWordIndex + 1),
              currentIndex: nextIndex,
              ...masteryUpdate,
            });
          }
          setIsSaved(true);
        } catch (error) {
          console.error("Failed to update custom lesson progress:", error);
        }
      }

      if (!isLastWord) {
        setCurrentWordIndex(nextIndex);
        setShowOutputWord(true);
        setOutputWordKey((prev) => prev + 1);
        setIsSaved(false);
      } else {
        // Lesson complete — check if there are more levels
        const nextLevelIndex = selectedLevel + 1;
        if (nextLevelIndex < availableLevels.length) {
          enqueueSnackbar(
            `Level ${selectedDifficultyLevel} complete! Ready for level ${availableLevels[nextLevelIndex]}.`,
            {
              variant: "success",
            },
          );
          setSelectedLevel(nextLevelIndex);
          setLessonStarted(false);
          setCurrentWordIndex(0);
          setShowOutputWord(false);
          setShowWordPeek(false);
          setProgressDocId(null);
        } else {
          enqueueSnackbar("Lesson complete! Great job!", {
            variant: "success",
          });
          history.push("/custom-lessons");
        }
      }

      setInputWord("");
      setEnableInput(false);
    },
    [
      availableLevels,
      currentWord,
      currentWordIndex,
      educatorId,
      enqueueSnackbar,
      history,
      inputWord,
      lessonData,
      lessonId,
      progressDocId,
      selectedLevel,
      selectedDifficultyLevel,
      studentId,
      studentName,
      words,
    ],
  );

  // ─── Flow event handler (identical to Lesson.js) ─────────────────────────
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
      if (
        phase === "flow-started" ||
        phase === "flow-sequence-step" ||
        phase === "flow-phoneme-complete" ||
        phase === "flow-grapheme-complete"
      ) {
        if (flowGuardTimeoutRef.current)
          clearTimeout(flowGuardTimeoutRef.current);
        flowGuardTimeoutRef.current = setTimeout(() => {
          setShowOutputWord(false);
          setEnableInput(true);
        }, 4000);
      }
      const isReadyPhase =
        typeof phase === "string" && phase.toLowerCase().includes("ready");
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

  useEffect(
    () => () => {
      if (flowGuardTimeoutRef.current)
        clearTimeout(flowGuardTimeoutRef.current);
    },
    [],
  );

  // ─── Absolute fallback timeout ────────────────────────────────────────────
  useEffect(() => {
    if (!lessonStarted || !showOutputWord || enableInput) return;
    const id = setTimeout(() => {
      setShowOutputWord(false);
      setEnableInput(true);
      focusAnswerInput();
    }, 15000);
    return () => clearTimeout(id);
  }, [enableInput, focusAnswerInput, lessonStarted, showOutputWord]);

  // ─── Keyboard / input ─────────────────────────────────────────────────────
  const processAnswerKey = useCallback(
    (key) => {
      if (!lessonStarted || typeof key !== "string") return false;
      clearWordPeek();
      if (!enableInput) return false;
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
    if (!lessonStarted) return;
    const handleWindowKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (processAnswerKey(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", handleWindowKeyDown, true);
    return () =>
      document.removeEventListener("keydown", handleWindowKeyDown, true);
  }, [lessonStarted, processAnswerKey]);

  useEffect(() => {
    const handleStartHotkey = (e) => {
      if (lessonStarted || e.repeat) return;
      if (e.key === "s" || e.key === "S") handleStartLesson();
    };
    window.addEventListener("keydown", handleStartHotkey);
    return () => window.removeEventListener("keydown", handleStartHotkey);
  }, [handleStartLesson, lessonStarted]);

  useEffect(() => {
    if (lessonStarted && enableInput) focusAnswerInput();
  }, [enableInput, focusAnswerInput, lessonStarted]);

  useEffect(() => {
    setShowWordPeek(false);
  }, [currentWordIndex, selectedLevel]);

  // ─── Repeat / Skip ────────────────────────────────────────────────────────
  const handleRepeatWord = () => {
    if (!lessonStarted) return;
    stopWordInfoSpeech();
    clearWordPeek();
    setShowOutputWord(true);
    setOutputWordKey((prev) => prev + 1);
    setInputWord("");
    setEnableInput(false);
  };

  const handleSkipWord = () => {
    stopWordInfoSpeech();
    clearWordPeek();
    handleSubmit(false);
  };

  const handleSetCueSpeedPreset = useCallback(
    (nextPreset) => {
      const p = String(nextPreset || "").toLowerCase();
      if (p === cueSpeedPreset || !CUE_SPEED_PRESET_OPTIONS.includes(p)) return;
      const applied = applyLessonFlowTimingPreset(p);
      setCueSpeedPreset(applied);
      window.localStorage.setItem(CUE_SPEED_PRESET_STORAGE_KEY, applied);
      enqueueSnackbar(`Cue speed set to ${CUE_SPEED_LABELS[applied]}.`, {
        variant: "info",
      });
    },
    [cueSpeedPreset, enqueueSnackbar],
  );

  const handleShowWord = useCallback(() => {
    if (!lessonStarted || !enableInput || !isDifficultyLevelOne || !currentWord)
      return;
    setShowWordPeek(true);
  }, [currentWord, enableInput, isDifficultyLevelOne, lessonStarted]);

  // ─── Progress bar ─────────────────────────────────────────────────────────
  const progressPct =
    words.length > 0 ? Math.round((currentWordIndex / words.length) * 100) : 0;

  // ─── Render loading / error ───────────────────────────────────────────────
  if (lessonLoading) {
    return (
      <Container maxWidth="md" style={{ marginTop: 40, textAlign: "center" }}>
        <CircularProgress />
        <Typography style={{ marginTop: 16 }}>Loading lesson…</Typography>
      </Container>
    );
  }

  if (lessonError || !lessonData) {
    return (
      <Container maxWidth="md" style={{ marginTop: 40 }}>
        <Typography color="error">
          {lessonError || "Lesson not found."}
        </Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={() => history.push("/custom-lessons")}
          style={{ marginTop: 16 }}
        >
          Back to Custom Lessons
        </Button>
      </Container>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <Prompt
        message="Are you sure you want to leave? Your progress will be saved automatically."
        when={!isSaved}
      />
      <Container maxWidth="md">
        <Grid container spacing={2} direction="column">
          <Grid item>
            <Typography variant="h6">{lessonData.name}</Typography>
            <Typography variant="caption" color="textSecondary">
              {words.length} words · Levels:{" "}
              {availableLevels.map((l) => `Level ${l}`).join(", ")}
            </Typography>
          </Grid>

          {!lessonStarted && (
            <Grid item>
              <Button
                fullWidth
                variant="contained"
                color="primary"
                onClick={() => handleStartLesson(true)}
                style={{ fontWeight: 700, minHeight: 48 }}
              >
                Start Lesson
              </Button>
              <div style={{ marginTop: 6, fontSize: 12, textAlign: "center" }}>
                Press S to start
              </div>
            </Grid>
          )}

          {/* Level picker */}
          <Grid item>
            <Typography variant="body2">Pick a level:</Typography>
            <ButtonGroup color="primary">
              {availableLevels.map((level, idx) => (
                <Button
                  key={level}
                  variant={selectedLevel === idx ? "contained" : "outlined"}
                  onClick={() => {
                    setSelectedLevel(idx);
                    setCurrentWordIndex(0);
                    setLessonStarted(false);
                    setShowOutputWord(false);
                    setShowWordPeek(false);
                    setInputWord("");
                    setEnableInput(false);
                  }}
                >
                  {level}
                </Button>
              ))}
            </ButtonGroup>
          </Grid>

          {/* Progress bar */}
          <Grid item>
            <Typography variant="body2">Progress:</Typography>
            <Box display="flex" alignItems="center">
              <Box flexGrow={1} mr={1}>
                <LinearProgress variant="determinate" value={progressPct} />
              </Box>
              <Typography variant="body2" color="textSecondary">
                {progressPct}%
              </Typography>
            </Box>
          </Grid>
        </Grid>

        {/* Main word area */}
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
              id="custom-lesson-answer-input"
              name="customLessonAnswer"
              ref={answerInputRef}
              value={inputWord}
              rows={1}
              onMouseEnter={clearWordPeek}
              onMouseOver={clearWordPeek}
              onPointerEnter={clearWordPeek}
              onMouseDown={clearWordPeek}
              onFocus={clearWordPeek}
              onChange={(e) => {
                clearWordPeek();
                if (!enableInput) return;
                setInputWord(String(e.target.value || "").toUpperCase());
              }}
              onKeyDown={(e) => {
                if (processAnswerKey(e.key)) {
                  e.preventDefault();
                  e.stopPropagation();
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
                  id="custom-lesson-word-peek-button"
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
                    : "Available only on level 1"
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
          </div>
        </Grid>

        <Dialog
          open={wordInfoDialogOpen}
          onClose={closeWordInfoDialog}
          fullWidth
          maxWidth="sm"
          aria-labelledby="custom-word-info-dialog-title"
        >
          <DialogTitle id="custom-word-info-dialog-title">
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
      </Container>
    </>
  );
}
