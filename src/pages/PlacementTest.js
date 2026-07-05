import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  ButtonGroup,
  Container,
  Grid,
  Paper,
  MenuItem,
  TextField,
  Typography,
} from "@material-ui/core";
import { useSnackbar } from "notistack";
import { useAuth } from "../hooks/useAuth";
import {
  db,
  upsertPlacementReport,
  submitPublicPlacementReport,
  assignPlacementTest,
  getPlacementReport,
  getPlacementAssignmentStatus,
  getPlacementWordOverrides,
  mgmtListData,
} from "../firebase";
import { useStyles } from "../styles/material";
import PlacementOutputWord from "../components/PlacementOutputWord";
import {
  clearPendingPlacementReport,
  readPendingPlacementReport,
  writePendingPlacementReport,
} from "../util/placementStorage";
import { primeAudioPlayback, playPlacementWordSequence } from "../util/Audio";
import { applyLessonFlowTimingPreset } from "../util/constants";
import { PLACEMENT_TEST_PARTS } from "../data/placementTestParts";

const REPORT_VERSION = 1;
const PLACEMENT_COMPLETED_STORAGE_KEY = "placementTestCompleted";
const CUE_SPEED_PRESET_STORAGE_KEY = "soundspeller.placementCueSpeedPreset";
const CUE_SPEED_PRESET_OPTIONS = ["slower", "normal", "faster"];
const CUE_SPEED_LABELS = {
  slower: "Slower",
  normal: "Normal",
  faster: "Faster",
};
const DIRECTIONS_TEXT =
  "You are about to hear a list of nonsense (not real) words, one at a time, and you will then type (or have someone type it for you) the word the way you think it should be spelled. Pretend that they are real words and you want to spell them properly following your knowledge of spelling rules (patterns). Spell them the way you think they should be spelled if they were real.";
const AUDIO_TEST_PRESETS = [
  { id: "mip", label: "mip (M-IH-P)", word: "mip", phonemes: ["M", "IH", "P"] },
  { id: "lat", label: "lat (L-AE-T)", word: "lat", phonemes: ["L", "AE", "T"] },
  {
    id: "shome",
    label: "shome (SH-OW-M)",
    word: "shome",
    phonemes: ["SH", "OW", "M"],
  },
];

const normalizeSpelling = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

const isValidEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(value || "")
      .trim()
      .toLowerCase(),
  );

const getAcceptedSpellings = (wordDef) => {
  const set = new Set([
    normalizeSpelling(wordDef?.word),
    ...(Array.isArray(wordDef?.alternatives)
      ? wordDef.alternatives.map((alt) => normalizeSpelling(alt))
      : []),
  ]);
  set.delete("");
  return [...set];
};

const getPartOutcome = (wrongCount) => {
  if (wrongCount <= 0) {
    return {
      code: "pass",
      note: "Passed this part.",
      shouldContinue: true,
      recommendStartHere: false,
      partialReview: false,
    };
  }
  if (wrongCount === 1) {
    return {
      code: "pass-review",
      note: "Passed this part. Review is recommended.",
      shouldContinue: true,
      recommendStartHere: false,
      partialReview: true,
    };
  }
  if (wrongCount === 2) {
    return {
      code: "start-here-partial-review",
      note: "Start here. Partial review is recommended.",
      shouldContinue: true,
      recommendStartHere: true,
      partialReview: true,
    };
  }
  return {
    code: "start-here-stop",
    note: "Start here. The placement test stops at this part.",
    shouldContinue: false,
    recommendStartHere: true,
    partialReview: false,
  };
};

const upsertPartWordResult = (partResults, wordResult) => {
  const next = Array.isArray(partResults) ? [...partResults] : [];
  const index = next.findIndex(
    (part) => part.partNumber === wordResult.partNumber,
  );

  if (index < 0) {
    next.push({
      partNumber: wordResult.partNumber,
      partTitle: wordResult.partTitle,
      words: [wordResult],
      wrongCount: wordResult.isCorrect ? 0 : 1,
      outcome: null,
    });
    return next;
  }

  const part = next[index];
  const updatedWords = [
    ...(Array.isArray(part.words) ? part.words : []),
    wordResult,
  ];
  const wrongCount = updatedWords.filter((w) => !w.isCorrect).length;
  next[index] = {
    ...part,
    words: updatedWords,
    wrongCount,
  };
  return next;
};

const finalizePartOutcome = (partResults, targetPartNumber) => {
  const next = Array.isArray(partResults) ? [...partResults] : [];
  const index = next.findIndex((part) => part.partNumber === targetPartNumber);
  if (index < 0) {
    return {
      partResults: next,
      finalPart: null,
    };
  }

  const part = next[index];
  const outcome = getPartOutcome(part.wrongCount);
  const finalPart = {
    ...part,
    outcome,
  };
  next[index] = finalPart;

  return {
    partResults: next,
    finalPart,
  };
};

const buildPlacementReport = ({ partResults, stoppedAtPartNumber = null }) => {
  const firstStartHere = partResults.find(
    (part) => part.outcome?.recommendStartHere,
  );
  const firstReview = partResults.find((part) => part.wrongCount > 0);
  const highestCompletedPart = partResults.reduce(
    (max, part) => Math.max(max, Number(part?.partNumber) || 0),
    0,
  );
  const nextPartIfAllPassed =
    highestCompletedPart > 0
      ? Math.min(highestCompletedPart + 1, PLACEMENT_TEST_PARTS.length)
      : 1;
  const recommendedStartPart =
    firstStartHere?.partNumber ||
    firstReview?.partNumber ||
    nextPartIfAllPassed;

  const focusParts = partResults
    .filter((part) => part.wrongCount > 0)
    .map((part) => ({
      partNumber: part.partNumber,
      partTitle: part.partTitle,
      wrongCount: part.wrongCount,
      note: part.outcome?.note || "",
    }));

  return {
    version: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    stoppedAtPartNumber,
    recommendedStartPart,
    focusParts,
    partResults,
    retakeWarning:
      "Retaking the placement test can make results less valid because the nonsense words may be memorized rather than the underlying spelling patterns learned.",
  };
};

const getWordStatus = (wordResult) =>
  wordResult.isCorrect ? "Correct" : "Incorrect";

const getEventValue = (event) => String(event?.target?.value || "");
const PRIME_AUDIO_TIMEOUT_MS = 1200;

const PLACEMENT_WORD_KEYS = [
  ...new Set(
    PLACEMENT_TEST_PARTS.flatMap((part) =>
      Array.isArray(part?.words)
        ? part.words
            .map((wordDef) =>
              String(wordDef?.word || "")
                .trim()
                .toUpperCase(),
            )
            .filter(Boolean)
        : [],
    ),
  ),
];

const readPlacementInstructions = async (text) => {
  const safeText = String(text || "").trim();
  if (!safeText) {
    return false;
  }

  const utterance = new SpeechSynthesisUtterance(safeText);
  utterance.lang = "en-US";
  utterance.rate = 0.95;

  const voices =
    typeof window !== "undefined" && window.speechSynthesis
      ? window.speechSynthesis.getVoices()
      : [];
  const preferredVoice =
    voices.find((voice) => voice.lang === "en-US" && voice.localService) ||
    voices.find((voice) => voice.lang === "en-US") ||
    voices[0] ||
    null;
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  return new Promise((resolve) => {
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    try {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } else {
        resolve(false);
      }
    } catch (_error) {
      resolve(false);
    }
  });
};

const normalizePlacementWordDef = (wordDef) => {
  const graphemes = Array.isArray(wordDef?.graphemes) ? wordDef.graphemes : [];
  const phonemes = Array.isArray(wordDef?.phonemes)
    ? [...wordDef.phonemes]
    : [];

  if (!graphemes.length || !phonemes.length) {
    return wordDef;
  }

  const lastGrapheme = String(graphemes[graphemes.length - 1] || "")
    .trim()
    .toUpperCase();
  const lastPhoneme = String(phonemes[phonemes.length - 1] || "")
    .trim()
    .toUpperCase();

  if (lastGrapheme === "L" && lastPhoneme === "L") {
    phonemes[phonemes.length - 1] = "LL";
    return {
      ...wordDef,
      phonemes,
    };
  }

  return wordDef;
};

const normalizePlacementParts = (parts) =>
  (Array.isArray(parts) ? parts : []).map((part) => ({
    ...part,
    words: (Array.isArray(part?.words) ? part.words : []).map((wordDef) =>
      normalizePlacementWordDef(wordDef),
    ),
  }));

const applyPlacementWordOverrides = (parts, overridesByWord) => {
  const map =
    overridesByWord instanceof Map ? overridesByWord : new Map(overridesByWord);

  return normalizePlacementParts(
    (Array.isArray(parts) ? parts : []).map((part) => ({
      ...part,
      words: (Array.isArray(part?.words) ? part.words : []).map((wordDef) => {
        const key = String(wordDef?.word || "")
          .trim()
          .toUpperCase();
        const override = key ? map.get(key) : null;
        if (!override) {
          return wordDef;
        }

        return {
          ...wordDef,
          graphemes: Array.isArray(override.graphemes)
            ? override.graphemes
            : wordDef.graphemes,
          phonemes: Array.isArray(override.phonemes)
            ? override.phonemes
            : wordDef.phonemes,
        };
      }),
    })),
  );
};

const buildPlacementOverridesMap = (rawOverrides) => {
  const source =
    rawOverrides && typeof rawOverrides === "object" ? rawOverrides : {};

  return new Map(
    Object.entries(source)
      .map(([wordKey, override]) => [
        String(wordKey || "")
          .trim()
          .toUpperCase(),
        {
          graphemes: Array.isArray(override?.graphemes)
            ? override.graphemes
            : null,
          phonemes: Array.isArray(override?.phonemes)
            ? override.phonemes
            : null,
        },
      ])
      .filter(([wordKey]) => Boolean(wordKey)),
  );
};

export default function PlacementTest() {
  const classes = useStyles();
  const auth = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const role = String(auth.role || "student");
  const isManagerRole =
    role === "admin" ||
    role === "schoolAdmin" ||
    role === "educator" ||
    role === "parent" ||
    role === "tutor";

  const [hasCompletedPlacementBefore, setHasCompletedPlacementBefore] =
    useState(() => {
      try {
        return (
          typeof window !== "undefined" &&
          window.localStorage.getItem(PLACEMENT_COMPLETED_STORAGE_KEY) === "1"
        );
      } catch (_error) {
        return false;
      }
    });
  const [started, setStarted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [placementParts, setPlacementParts] = useState(
    normalizePlacementParts(PLACEMENT_TEST_PARTS),
  );
  const [currentPartIndex, setCurrentPartIndex] = useState(0);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [inputWord, setInputWord] = useState("");
  const [enableInput, setEnableInput] = useState(false);
  const [awaitingPlayClick, setAwaitingPlayClick] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [partResults, setPartResults] = useState([]);
  const [report, setReport] = useState(null);
  const [savingReport, setSavingReport] = useState(false);
  const [publicIntake, setPublicIntake] = useState({
    studentFirstName: "",
    proctorFirstName: "",
    proctorLastName: "",
    proctorEmail: "",
  });
  const [submittingPublicReport, setSubmittingPublicReport] = useState(false);
  const [publicSubmissionMessage, setPublicSubmissionMessage] = useState("");
  const [managedStudents, setManagedStudents] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [loadingManagedStudents, setLoadingManagedStudents] = useState(false);
  const [assigningPlacement, setAssigningPlacement] = useState(false);
  const [loadingManagedReport, setLoadingManagedReport] = useState(false);
  const [managedReport, setManagedReport] = useState(null);
  const [managedReportError, setManagedReportError] = useState("");
  const [activePanel, setActivePanel] = useState("test");
  const [studentAssignmentLoading, setStudentAssignmentLoading] =
    useState(false);
  const [studentHasAssignment, setStudentHasAssignment] = useState(false);
  const [audioTestRunning, setAudioTestRunning] = useState(false);
  const [loadingPlacementWords, setLoadingPlacementWords] = useState(false);
  const [placementWordLoadError, setPlacementWordLoadError] = useState("");
  const [placementWordsReady, setPlacementWordsReady] = useState(false);
  const [audioTestPresetId, setAudioTestPresetId] = useState(
    AUDIO_TEST_PRESETS[0].id,
  );
  const [cueSpeedPreset, setCueSpeedPreset] = useState(() => {
    try {
      if (typeof window !== "undefined") {
        const storedPreset = String(
          window.localStorage.getItem(CUE_SPEED_PRESET_STORAGE_KEY) || "",
        ).toLowerCase();
        if (CUE_SPEED_PRESET_OPTIONS.includes(storedPreset)) {
          return storedPreset;
        }
      }
    } catch (_error) {
      // Ignore storage failures and fall back to normal.
    }
    return "normal";
  });

  const answerInputRef = useRef(null);
  const partResultsRef = useRef([]);

  const currentPart = placementParts[currentPartIndex] || null;
  const isPublicMode = !auth.user;
  const hasValidPublicIntake =
    String(publicIntake.studentFirstName || "").trim().length > 0 &&
    String(publicIntake.proctorFirstName || "").trim().length > 0 &&
    String(publicIntake.proctorLastName || "").trim().length > 0 &&
    isValidEmail(publicIntake.proctorEmail);
  const currentWordDef =
    currentPart && Array.isArray(currentPart.words)
      ? currentPart.words[currentWordIndex] || null
      : null;
  const showRetakeWarning = hasCompletedPlacementBefore;
  const selectedAudioPreset = useMemo(
    () =>
      AUDIO_TEST_PRESETS.find((preset) => preset.id === audioTestPresetId) ||
      AUDIO_TEST_PRESETS[0],
    [audioTestPresetId],
  );

  useEffect(() => {
    applyLessonFlowTimingPreset(cueSpeedPreset);
  }, [cueSpeedPreset]);

  const logPlacementOverrideLoadFailure = useCallback(
    (stage, error, metadata = {}) => {
      console.error("[placement] override load failed", {
        stage,
        message: String(error?.message || ""),
        code: String(error?.code || ""),
        hasAuthUser: Boolean(auth?.user),
        ...metadata,
      });
    },
    [auth?.user],
  );

  const loadPlacementWordOverrides = useCallback(async () => {
    setLoadingPlacementWords(true);
    setPlacementWordLoadError("");
    setPlacementWordsReady(false);

    const applyOrReset = (overrides) => {
      if (!overrides.size) {
        setPlacementParts(normalizePlacementParts(PLACEMENT_TEST_PARTS));
        setPlacementWordLoadError(
          "No placement phoneme overrides were returned from Firebase.",
        );
        return;
      }

      setPlacementParts(
        applyPlacementWordOverrides(PLACEMENT_TEST_PARTS, overrides),
      );
      setPlacementWordsReady(true);
    };

    try {
      // For signed-in flows, Firestore word docs are the source of truth.
      if (auth?.user) {
        const docs = await Promise.all(
          PLACEMENT_WORD_KEYS.map((wordKey) =>
            db.collection("words").doc(wordKey).get(),
          ),
        );

        const rawOverrides = {};
        docs.forEach((doc) => {
          if (!doc.exists) {
            return;
          }
          const data = doc.data() || {};
          if (!Array.isArray(data.graphemes) && !Array.isArray(data.phonemes)) {
            return;
          }
          rawOverrides[
            String(doc.id || "")
              .trim()
              .toUpperCase()
          ] = {
            graphemes: Array.isArray(data.graphemes) ? data.graphemes : null,
            phonemes: Array.isArray(data.phonemes) ? data.phonemes : null,
          };
        });

        applyOrReset(buildPlacementOverridesMap(rawOverrides));
        return;
      }

      // Public flow fallback: use callable because Firestore rules can block.
      const result = await getPlacementWordOverrides({
        words: PLACEMENT_WORD_KEYS,
      });
      const payload = result?.data || {};
      const overrides = buildPlacementOverridesMap(payload?.overrides);
      applyOrReset(overrides);
    } catch (error) {
      if (auth?.user) {
        logPlacementOverrideLoadFailure("firestore-primary", error);
        try {
          const result = await getPlacementWordOverrides({
            words: PLACEMENT_WORD_KEYS,
          });
          const payload = result?.data || {};
          applyOrReset(buildPlacementOverridesMap(payload?.overrides));
          return;
        } catch (fallbackError) {
          logPlacementOverrideLoadFailure("callable-fallback", fallbackError, {
            primaryCode: String(error?.code || ""),
          });
          // Fall through to placement defaults when both fetch paths fail.
        }
      } else {
        logPlacementOverrideLoadFailure("callable-public", error);
      }

      setPlacementParts(normalizePlacementParts(PLACEMENT_TEST_PARTS));
      setPlacementWordLoadError(
        error?.message || "Unable to load placement word overrides.",
      );
    } finally {
      setLoadingPlacementWords(false);
    }
  }, [auth?.user, logPlacementOverrideLoadFailure]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      await loadPlacementWordOverrides();
      if (cancelled) {
        return;
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [loadPlacementWordOverrides]);

  useEffect(() => {
    let isMounted = true;

    if (!isManagerRole) {
      setManagedStudents([]);
      setSelectedStudentId("");
      return () => {
        isMounted = false;
      };
    }

    const loadManagedStudents = async () => {
      setLoadingManagedStudents(true);
      try {
        const result = await mgmtListData({});
        if (!isMounted) return;
        const payload = result?.data || {};
        const users = Array.isArray(payload.users) ? payload.users : [];
        const scopedStudents = users
          .filter(
            (userRow) =>
              String(userRow?.role || "").toLowerCase() === "student",
          )
          .map((userRow) => ({
            id: String(userRow?.id || "").trim(),
            username: String(userRow?.username || "").trim(),
            name: String(
              userRow?.name ||
                userRow?.displayName ||
                userRow?.username ||
                userRow?.id ||
                "",
            ).trim(),
          }))
          .filter((student) => Boolean(student.id));

        setManagedStudents(scopedStudents);
        setSelectedStudentId((prev) => {
          if (prev && scopedStudents.some((student) => student.id === prev)) {
            return prev;
          }
          return scopedStudents[0]?.id || "";
        });
      } catch (_error) {
        if (!isMounted) return;
        setManagedStudents([]);
        setSelectedStudentId("");
      } finally {
        if (isMounted) {
          setLoadingManagedStudents(false);
        }
      }
    };

    loadManagedStudents();

    return () => {
      isMounted = false;
    };
  }, [isManagerRole]);

  useEffect(() => {
    let isMounted = true;

    if (!auth.user || isManagerRole) {
      setStudentHasAssignment(false);
      setStudentAssignmentLoading(false);
      return () => {
        isMounted = false;
      };
    }

    const loadAssignmentStatus = async () => {
      setStudentAssignmentLoading(true);
      try {
        const result = await getPlacementAssignmentStatus({});
        if (!isMounted) return;
        const data = result?.data || {};
        setStudentHasAssignment(Boolean(data.assigned));
      } catch (_error) {
        if (!isMounted) return;
        setStudentHasAssignment(false);
      } finally {
        if (isMounted) {
          setStudentAssignmentLoading(false);
        }
      }
    };

    loadAssignmentStatus();

    return () => {
      isMounted = false;
    };
  }, [auth.user, isManagerRole]);

  const wordPrompt = useMemo(() => {
    const fallbackPart =
      currentPart ||
      placementParts[Math.max(0, Number(currentPartIndex) || 0)] ||
      placementParts[0] ||
      null;
    const fallbackWordDef =
      currentWordDef ||
      (Array.isArray(fallbackPart?.words)
        ? fallbackPart.words[Math.max(0, Number(currentWordIndex) || 0)] ||
          fallbackPart.words[0] ||
          null
        : null);

    if (!fallbackWordDef || !String(fallbackWordDef.word || "").trim()) {
      return null;
    }

    return {
      word: String(fallbackWordDef.word || "").trim(),
      phonemes: Array.isArray(fallbackWordDef.phonemes)
        ? fallbackWordDef.phonemes
        : [],
    };
  }, [
    currentPart,
    currentPartIndex,
    currentWordDef,
    currentWordIndex,
    placementParts,
  ]);

  useEffect(() => {
    partResultsRef.current = Array.isArray(partResults) ? partResults : [];
  }, [partResults]);

  const persistPendingReport = useCallback(
    (nextReport, reason = "", targetStudentId = "") => {
      if (!nextReport) {
        return;
      }
      writePendingPlacementReport({
        attemptId: `placement-${Date.now()}`,
        report: nextReport,
        reason,
        studentId: String(targetStudentId || "").trim(),
      });
    },
    [],
  );

  const submitPublicReport = useCallback(
    async (nextReport) => {
      const payload = {
        studentFirstName: String(publicIntake.studentFirstName || "").trim(),
        proctorFirstName: String(publicIntake.proctorFirstName || "").trim(),
        proctorLastName: String(publicIntake.proctorLastName || "").trim(),
        proctorEmail: String(publicIntake.proctorEmail || "")
          .trim()
          .toLowerCase(),
        report: nextReport,
      };

      setSubmittingPublicReport(true);
      try {
        const result = await submitPublicPlacementReport(payload);
        const data = result?.data || {};
        if (data?.saved) {
          setPublicSubmissionMessage(
            data?.emailQueued
              ? "Report submitted and admin email notification queued."
              : "Report submitted. Admin will see it in Placement Reports inbox.",
          );
          enqueueSnackbar("Placement report submitted.", {
            variant: "success",
          });
        }
      } catch (error) {
        const message =
          error?.message || "Unable to submit placement report right now.";
        setPublicSubmissionMessage(message);
        enqueueSnackbar(message, { variant: "error" });
      } finally {
        setSubmittingPublicReport(false);
      }
    },
    [enqueueSnackbar, publicIntake],
  );

  const finishAssessment = useCallback(
    ({ stoppedAtPartNumber = null, finalizedPartResults = null }) => {
      setEnableInput(false);
      setAwaitingPlayClick(false);
      setStarted(false);
      setCompleted(true);
      setHasCompletedPlacementBefore(true);
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(PLACEMENT_COMPLETED_STORAGE_KEY, "1");
        }
      } catch (_error) {
        // Ignore storage failures; warning will be session-only.
      }

      const baseResults = Array.isArray(finalizedPartResults)
        ? finalizedPartResults
        : partResultsRef.current;
      const finalized = baseResults.map((part) =>
        part.outcome
          ? part
          : {
              ...part,
              outcome: getPartOutcome(part.wrongCount),
            },
      );
      partResultsRef.current = finalized;
      setPartResults(finalized);

      const nextReport = buildPlacementReport({
        partResults: finalized,
        stoppedAtPartNumber,
      });
      setReport(nextReport);
      if (auth.user) {
        const targetStudentId = isManagerRole
          ? String(selectedStudentId || "").trim()
          : "";
        persistPendingReport(nextReport, "authenticated", targetStudentId);
      } else {
        submitPublicReport(nextReport);
      }
    },
    [
      auth.user,
      isManagerRole,
      persistPendingReport,
      selectedStudentId,
      submitPublicReport,
    ],
  );

  const handleReadyForInput = useCallback(() => {
    setEnableInput(true);
    setTimeout(() => {
      if (answerInputRef.current) {
        answerInputRef.current.focus();
      }
    }, 0);
  }, []);

  const handleRepeatWord = useCallback(async () => {
    if (!started || !wordPrompt) {
      return;
    }
    try {
      await Promise.race([
        primeAudioPlayback(),
        new Promise((resolve) => setTimeout(resolve, PRIME_AUDIO_TIMEOUT_MS)),
      ]);
    } catch (_error) {
      // Continue with replay even if priming fails.
    }
    setAwaitingPlayClick(false);
    setEnableInput(false);
    setRunKey((prev) => prev + 1);
  }, [started, wordPrompt]);

  const handlePlayWord = useCallback(async () => {
    if (!started || !wordPrompt || !awaitingPlayClick) {
      return;
    }
    try {
      await Promise.race([
        primeAudioPlayback(),
        new Promise((resolve) => setTimeout(resolve, PRIME_AUDIO_TIMEOUT_MS)),
      ]);
    } catch (_error) {
      // Continue with playback even if priming fails.
    }
    setEnableInput(false);
    setAwaitingPlayClick(false);
    setRunKey((prev) => prev + 1);
  }, [awaitingPlayClick, started, wordPrompt]);

  const handleSubmitAnswer = useCallback(() => {
    if (!started || !currentPart || !currentWordDef || !enableInput) {
      return;
    }

    const normalizedInput = normalizeSpelling(inputWord);
    const acceptedSpellings = getAcceptedSpellings(currentWordDef);
    const isCorrect = acceptedSpellings.includes(normalizedInput);

    const wordResult = {
      partNumber: currentPart.number,
      partTitle: currentPart.title,
      word: currentWordDef.word,
      typed: inputWord,
      normalizedTyped: normalizedInput,
      acceptedSpellings,
      isCorrect,
      correctSpelling: currentWordDef.word,
      alternatives: Array.isArray(currentWordDef.alternatives)
        ? currentWordDef.alternatives
        : [],
    };

    let nextPartResults = upsertPartWordResult(
      partResultsRef.current,
      wordResult,
    );
    setInputWord("");
    setEnableInput(false);
    setAwaitingPlayClick(false);

    const isLastWordInPart =
      currentWordIndex >=
      (Array.isArray(currentPart.words) ? currentPart.words.length - 1 : 0);

    if (!isLastWordInPart) {
      partResultsRef.current = nextPartResults;
      setPartResults(nextPartResults);
      setCurrentWordIndex((prev) => prev + 1);
      setRunKey((prev) => prev + 1);
      return;
    }

    const finalized = finalizePartOutcome(nextPartResults, currentPart.number);
    nextPartResults = finalized.partResults;
    const finalPart = finalized.finalPart;
    partResultsRef.current = nextPartResults;
    setPartResults(nextPartResults);

    if (!finalPart) {
      finishAssessment({
        stoppedAtPartNumber: currentPart.number,
        finalizedPartResults: nextPartResults,
      });
      return;
    }

    if (!finalPart.outcome?.shouldContinue) {
      finishAssessment({
        stoppedAtPartNumber: currentPart.number,
        finalizedPartResults: nextPartResults,
      });
      return;
    }

    if (currentPartIndex >= placementParts.length - 1) {
      finishAssessment({
        stoppedAtPartNumber: null,
        finalizedPartResults: nextPartResults,
      });
      return;
    }

    setCurrentPartIndex((prev) => prev + 1);
    setCurrentWordIndex(0);
    setRunKey((prev) => prev + 1);
  }, [
    currentPart,
    currentPartIndex,
    currentWordDef,
    currentWordIndex,
    enableInput,
    finishAssessment,
    inputWord,
    placementParts.length,
    started,
  ]);

  const handleStart = useCallback(async () => {
    if (loadingPlacementWords) {
      enqueueSnackbar("Placement words are still loading. Please wait.", {
        variant: "info",
      });
      return;
    }

    if (!placementWordsReady || placementWordLoadError) {
      enqueueSnackbar(
        "Could not load placement phonemes from Firebase. Please refresh and retry.",
        {
          variant: "warning",
        },
      );
      return;
    }

    if (isPublicMode && !hasValidPublicIntake) {
      enqueueSnackbar(
        "Enter student/proctor names and a valid proctor email before starting.",
        {
          variant: "warning",
        },
      );
      return;
    }

    if (auth.user && !isManagerRole && !studentHasAssignment) {
      enqueueSnackbar(
        "Placement Test is available after your manager assigns it to you.",
        {
          variant: "warning",
        },
      );
      return;
    }

    if (isManagerRole && !String(selectedStudentId || "").trim()) {
      enqueueSnackbar("Select a managed student before starting.", {
        variant: "warning",
      });
      return;
    }

    try {
      await Promise.race([
        primeAudioPlayback(),
        new Promise((resolve) => setTimeout(resolve, PRIME_AUDIO_TIMEOUT_MS)),
      ]);
    } catch (_error) {
      // Continue starting even if priming fails.
    }

    await loadPlacementWordOverrides();

    setCompleted(false);
    setStarted(true);
    setCurrentPartIndex(0);
    setCurrentWordIndex(0);
    setAwaitingPlayClick(true);
    setPartResults([]);
    partResultsRef.current = [];
    setReport(null);
    setInputWord("");
    setEnableInput(false);
    setRunKey(0);
    setPublicSubmissionMessage("");
    setManagedReport(null);
    setManagedReportError("");
    enqueueSnackbar("Placement test started.", { variant: "info" });
  }, [
    auth.user,
    enqueueSnackbar,
    isManagerRole,
    isPublicMode,
    hasValidPublicIntake,
    loadingPlacementWords,
    loadPlacementWordOverrides,
    placementWordLoadError,
    placementWordsReady,
    selectedStudentId,
    studentHasAssignment,
  ]);

  const handleReadInstructions = useCallback(async () => {
    try {
      const startedSpeaking = await readPlacementInstructions(DIRECTIONS_TEXT);
      if (!startedSpeaking) {
        enqueueSnackbar("Could not read instructions on this device.", {
          variant: "warning",
        });
      }
    } catch (_error) {
      enqueueSnackbar("Could not read instructions on this device.", {
        variant: "warning",
      });
    }
  }, [enqueueSnackbar]);

  const handleSaveAndEmailIfPossible = useCallback(
    async (pending) => {
      if (!pending || !auth.user) {
        return;
      }

      setSavingReport(true);
      try {
        const result = await upsertPlacementReport({
          attemptId: pending.attemptId,
          report: pending.report,
          studentId: String(pending.studentId || "").trim() || undefined,
        });
        const data = result?.data || {};
        if (data?.emailed) {
          clearPendingPlacementReport();
          enqueueSnackbar("Placement report saved and emailed.", {
            variant: "success",
          });
        } else if (data?.needsVerification) {
          enqueueSnackbar(
            "Verify your email, then sign in again to receive the placement report.",
            { variant: "warning" },
          );
        } else {
          enqueueSnackbar("Placement report saved.", { variant: "success" });
        }
      } catch (error) {
        enqueueSnackbar(
          error?.message || "Unable to save placement report right now.",
          {
            variant: "error",
          },
        );
      } finally {
        setSavingReport(false);
      }
    },
    [auth.user, enqueueSnackbar],
  );

  useEffect(() => {
    if (!auth.authLoaded || !report) {
      return;
    }
    const pending = readPendingPlacementReport();
    if (!pending || !pending.report) {
      return;
    }
    if (auth.user && auth.user.emailVerified) {
      handleSaveAndEmailIfPossible(pending);
    }
  }, [auth.authLoaded, auth.user, handleSaveAndEmailIfPossible, report]);

  useEffect(() => {
    if (!auth.authLoaded || !auth.user || !auth.user.emailVerified) {
      return;
    }
    const pending = readPendingPlacementReport();
    if (!pending || !pending.report) {
      return;
    }
    handleSaveAndEmailIfPossible(pending);
  }, [auth.authLoaded, auth.user, handleSaveAndEmailIfPossible]);

  const selectedStudent = useMemo(
    () =>
      managedStudents.find(
        (student) => student.id === String(selectedStudentId || "").trim(),
      ) || null,
    [managedStudents, selectedStudentId],
  );

  const handleAssignPlacement = useCallback(async () => {
    const studentId = String(selectedStudentId || "").trim();
    if (!studentId) {
      enqueueSnackbar("Select a managed student first.", {
        variant: "warning",
      });
      return;
    }

    setAssigningPlacement(true);
    try {
      await assignPlacementTest({ studentId });
      enqueueSnackbar("Placement Test assigned.", { variant: "success" });
    } catch (error) {
      enqueueSnackbar(error?.message || "Unable to assign placement test.", {
        variant: "error",
      });
    } finally {
      setAssigningPlacement(false);
    }
  }, [enqueueSnackbar, selectedStudentId]);

  const handleLoadManagedReport = useCallback(async () => {
    const studentId = String(selectedStudentId || "").trim();
    if (!studentId) {
      enqueueSnackbar("Select a managed student first.", {
        variant: "warning",
      });
      return;
    }

    setLoadingManagedReport(true);
    setManagedReportError("");
    setManagedReport(null);
    try {
      const result = await getPlacementReport({ studentId });
      const data = result?.data || {};
      if (!data?.found || !data?.report) {
        setManagedReportError(
          "No placement report found for this student yet.",
        );
        return;
      }
      setManagedReport(data.report);
      setActivePanel("reports");
    } catch (error) {
      setManagedReportError(
        error?.message || "Unable to load student placement report.",
      );
    } finally {
      setLoadingManagedReport(false);
    }
  }, [enqueueSnackbar, selectedStudentId]);

  const handleAudioTest = useCallback(async () => {
    if (audioTestRunning) {
      return;
    }

    setAudioTestRunning(true);
    try {
      await primeAudioPlayback();
      await playPlacementWordSequence(
        selectedAudioPreset.word,
        selectedAudioPreset.phonemes,
        {
          speakWordStages: true,
          replayWordAfterPhonemes: true,
        },
      );
      enqueueSnackbar(`Audio test played: ${selectedAudioPreset.word}.`, {
        variant: "info",
      });
    } catch (_error) {
      enqueueSnackbar("Audio test could not play on this device/browser.", {
        variant: "warning",
      });
    } finally {
      setAudioTestRunning(false);
    }
  }, [audioTestRunning, enqueueSnackbar, selectedAudioPreset]);

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
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            CUE_SPEED_PRESET_STORAGE_KEY,
            appliedPreset,
          );
        }
      } catch (_error) {
        // Ignore storage failures.
      }
      enqueueSnackbar(`Cue speed set to ${CUE_SPEED_LABELS[appliedPreset]}.`, {
        variant: "info",
      });
    },
    [cueSpeedPreset, enqueueSnackbar],
  );

  return (
    <Container maxWidth="md">
      <Grid container spacing={2} direction="column">
        <Grid item>
          <Typography variant="h4" style={{ textAlign: "center" }}>
            Placement Test
          </Typography>
          {started && (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <ButtonGroup color="primary" size="small">
                {CUE_SPEED_PRESET_OPTIONS.map((preset) => (
                  <Button
                    key={preset}
                    variant={
                      cueSpeedPreset === preset ? "contained" : "outlined"
                    }
                    color="primary"
                    onClick={() => handleSetCueSpeedPreset(preset)}
                    style={{ fontSize: 11, minWidth: 52, padding: "2px 8px" }}
                  >
                    {CUE_SPEED_LABELS[preset]}
                  </Button>
                ))}
              </ButtonGroup>
            </div>
          )}
          <div
            style={{ marginTop: 12, display: "flex", justifyContent: "center" }}
          >
            {started && !completed && (
              <Button
                variant="outlined"
                color="primary"
                onClick={handleReadInstructions}
                style={{ fontWeight: 700, minHeight: 44 }}
              >
                Read Instructions
              </Button>
            )}
          </div>
          {started && !completed && (
            <Typography
              variant="body2"
              style={{ textAlign: "center", marginTop: 8 }}
            >
              {DIRECTIONS_TEXT}
            </Typography>
          )}
        </Grid>

        {isManagerRole && (
          <Grid item>
            <Paper style={{ padding: 16 }}>
              <Typography variant="h6">Managed Student Controls</Typography>
              <Typography style={{ marginTop: 6 }}>
                Assign Placement Test and review reports for managed students.
              </Typography>

              <Grid container spacing={2} style={{ marginTop: 4 }}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    select
                    variant="outlined"
                    label="Managed Student"
                    value={selectedStudentId}
                    onChange={(event) => {
                      const nextValue = getEventValue(event);
                      setSelectedStudentId(nextValue);
                      setManagedReport(null);
                      setManagedReportError("");
                    }}
                    disabled={loadingManagedStudents || started}
                    helperText={
                      loadingManagedStudents
                        ? "Loading managed students..."
                        : managedStudents.length === 0
                          ? "No managed students found."
                          : ""
                    }
                  >
                    {managedStudents.map((student) => (
                      <MenuItem key={student.id} value={student.id}>
                        {student.name || student.username || student.id}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>

                <Grid item xs={12} md={6}>
                  <ButtonGroup color="primary" variant="contained">
                    <Button
                      onClick={handleAssignPlacement}
                      disabled={
                        assigningPlacement ||
                        loadingManagedStudents ||
                        !selectedStudentId
                      }
                    >
                      {assigningPlacement
                        ? "Assigning..."
                        : "Assign Placement Test"}
                    </Button>
                    <Button
                      onClick={handleLoadManagedReport}
                      disabled={
                        loadingManagedReport ||
                        loadingManagedStudents ||
                        !selectedStudentId
                      }
                    >
                      {loadingManagedReport ? "Loading..." : "View Report"}
                    </Button>
                  </ButtonGroup>
                </Grid>
              </Grid>

              <Typography style={{ marginTop: 10, fontSize: 13 }}>
                Selected student: {selectedStudent?.name || "None selected"}
              </Typography>
            </Paper>
          </Grid>
        )}

        {isPublicMode && !started && (
          <Grid item>
            <Paper style={{ padding: 16 }}>
              <Typography variant="h6">Test Information</Typography>
              <Typography style={{ marginTop: 6 }}>
                Enter this information before starting the Placement Test.
              </Typography>
              <Grid container spacing={2} style={{ marginTop: 4 }}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="Student First Name"
                    value={publicIntake.studentFirstName}
                    onChange={(event) => {
                      const nextValue = getEventValue(event);
                      setPublicIntake((prev) => ({
                        ...prev,
                        studentFirstName: nextValue,
                      }));
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="Proctor First Name"
                    value={publicIntake.proctorFirstName}
                    onChange={(event) => {
                      const nextValue = getEventValue(event);
                      setPublicIntake((prev) => ({
                        ...prev,
                        proctorFirstName: nextValue,
                      }));
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="Proctor Last Name"
                    value={publicIntake.proctorLastName}
                    onChange={(event) => {
                      const nextValue = getEventValue(event);
                      setPublicIntake((prev) => ({
                        ...prev,
                        proctorLastName: nextValue,
                      }));
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="Proctor Email"
                    value={publicIntake.proctorEmail}
                    onChange={(event) => {
                      const nextValue = getEventValue(event);
                      setPublicIntake((prev) => ({
                        ...prev,
                        proctorEmail: nextValue,
                      }));
                    }}
                    error={
                      publicIntake.proctorEmail.length > 0 &&
                      !isValidEmail(publicIntake.proctorEmail)
                    }
                    helperText={
                      publicIntake.proctorEmail.length > 0 &&
                      !isValidEmail(publicIntake.proctorEmail)
                        ? "Enter a valid email address."
                        : ""
                    }
                  />
                </Grid>
              </Grid>
            </Paper>
          </Grid>
        )}

        <Grid item>
          {!started && !completed && (
            <Button
              variant="contained"
              color="primary"
              onClick={handleStart}
              disabled={
                loadingPlacementWords ||
                !placementWordsReady ||
                (isManagerRole &&
                  (!selectedStudentId || managedStudents.length === 0)) ||
                (Boolean(auth.user) &&
                  !isManagerRole &&
                  (studentAssignmentLoading || !studentHasAssignment))
              }
              style={{ fontWeight: 700, minHeight: 48, width: "100%" }}
            >
              {loadingPlacementWords ? "Loading Words..." : "Start"}
            </Button>
          )}
          {!started && !completed && loadingPlacementWords && (
            <Typography style={{ marginTop: 8, textAlign: "center" }}>
              Loading placement phonemes from Firebase...
            </Typography>
          )}
          {!started && !completed && auth.user && placementWordLoadError && (
            <Typography style={{ marginTop: 8, textAlign: "center" }}>
              Could not load latest word phonemes. Refresh to retry.
            </Typography>
          )}
          {!started &&
            !completed &&
            !loadingPlacementWords &&
            !placementWordsReady && (
              <Typography style={{ marginTop: 8, textAlign: "center" }}>
                Placement cannot start until Firebase phonemes are loaded.
              </Typography>
            )}
          {!started &&
            !completed &&
            auth.user &&
            !isManagerRole &&
            !studentAssignmentLoading &&
            !studentHasAssignment && (
              <Typography style={{ marginTop: 8, textAlign: "center" }}>
                Your manager needs to assign the Placement Test before you can
                start.
              </Typography>
            )}
        </Grid>

        <Grid item>
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
              {started && wordPrompt && !enableInput && !awaitingPlayClick && (
                <PlacementOutputWord
                  word={wordPrompt.word}
                  phonemes={wordPrompt.phonemes}
                  runKey={runKey}
                  onReadyForInput={handleReadyForInput}
                />
              )}

              {started && (
                <>
                  <textarea
                    id="placement-answer-input"
                    name="placementAnswer"
                    ref={answerInputRef}
                    value={inputWord}
                    rows={1}
                    onChange={(event) => {
                      if (!enableInput) {
                        return;
                      }
                      setInputWord(String(event.target.value || ""));
                    }}
                    onKeyDown={(event) => {
                      if (!enableInput) {
                        event.preventDefault();
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleSubmitAnswer();
                      }
                    }}
                    readOnly={!enableInput}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    style={{
                      width: "100%",
                      maxWidth: 640,
                      fontSize: 30,
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
                      opacity: enableInput ? 1 : 0.8,
                    }}
                    placeholder={
                      enableInput
                        ? "Type your spelling"
                        : "Listen to the word..."
                    }
                  />

                  {!enableInput && (
                    <Typography
                      variant="body2"
                      style={{ color: "#0d47a1", textAlign: "center" }}
                    >
                      {awaitingPlayClick
                        ? "Click Play Word to hear the prompt."
                        : "Input will unlock after the audio finishes."}
                    </Typography>
                  )}

                  <ButtonGroup color="primary" variant="contained">
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={handlePlayWord}
                      disabled={!started || !awaitingPlayClick}
                    >
                      Play Word
                    </Button>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={handleRepeatWord}
                      disabled={!started || awaitingPlayClick}
                    >
                      Repeat
                    </Button>
                  </ButtonGroup>
                </>
              )}
            </div>
          </Paper>
        </Grid>

        {completed && report && (
          <Grid item>
            <Paper style={{ padding: 16 }}>
              <Typography variant="h6">Placement Report</Typography>
              {isPublicMode && (
                <Typography style={{ marginTop: 8 }}>
                  Student first name: {publicIntake.studentFirstName || "—"}
                  {" | "}
                  Proctor: {publicIntake.proctorFirstName || "—"}{" "}
                  {publicIntake.proctorLastName || ""}
                  {" | "}
                  Email: {publicIntake.proctorEmail || "—"}
                </Typography>
              )}
              <Typography style={{ marginTop: 8 }}>
                Recommended starting part: Part {report.recommendedStartPart}
              </Typography>
              {report.stoppedAtPartNumber && (
                <Typography>
                  Assessment stopped at Part {report.stoppedAtPartNumber}.
                </Typography>
              )}
              <Typography style={{ marginTop: 8 }}>
                {report.retakeWarning}
              </Typography>

              <div style={{ marginTop: 12 }}>
                {Array.isArray(report.partResults) &&
                  report.partResults.map((part) => (
                    <Paper
                      key={`part-${part.partNumber}`}
                      style={{
                        padding: 12,
                        marginBottom: 10,
                        border: "1px solid #ddd",
                      }}
                      variant="outlined"
                    >
                      <Typography style={{ fontWeight: 700 }}>
                        Part {part.partNumber}: {part.partTitle}
                      </Typography>
                      <Typography>
                        Wrong answers: {part.wrongCount} -{" "}
                        {part.outcome?.note || ""}
                      </Typography>
                      <div style={{ marginTop: 6 }}>
                        {Array.isArray(part.words) &&
                          part.words.map((wordResult) => (
                            <Typography
                              key={`word-${part.partNumber}-${wordResult.word}`}
                              style={{ fontSize: 14 }}
                            >
                              {wordResult.word}: {getWordStatus(wordResult)}
                              {!wordResult.isCorrect
                                ? ` (typed: ${wordResult.typed || "(blank)"}; correct: ${wordResult.correctSpelling})`
                                : ""}
                            </Typography>
                          ))}
                      </div>
                    </Paper>
                  ))}
              </div>

              {savingReport && (
                <Typography style={{ marginTop: 8 }}>
                  Saving report...
                </Typography>
              )}
              {submittingPublicReport && (
                <Typography style={{ marginTop: 8 }}>
                  Submitting report...
                </Typography>
              )}
              {publicSubmissionMessage && (
                <Typography style={{ marginTop: 8 }}>
                  {publicSubmissionMessage}
                </Typography>
              )}
            </Paper>
          </Grid>
        )}

        {showRetakeWarning && (
          <Grid item>
            <Typography
              variant="body2"
              style={{ textAlign: "center", marginTop: 8 }}
            >
              Retake warning: results from retaking this test are less valid
              because nonsense words can be memorized rather than spelling
              patterns learned.
            </Typography>
          </Grid>
        )}

        {isManagerRole && (managedReport || managedReportError) && (
          <Grid item>
            <Paper style={{ padding: 16 }}>
              <Typography variant="h6">
                {activePanel === "reports"
                  ? "Managed Student Placement Report"
                  : "Managed Student Report"}
              </Typography>
              {managedReportError && (
                <Typography style={{ marginTop: 8 }}>
                  {managedReportError}
                </Typography>
              )}
              {managedReport && (
                <>
                  <Typography style={{ marginTop: 8 }}>
                    Recommended starting part: Part{" "}
                    {managedReport.recommendedStartPart}
                  </Typography>
                  {managedReport.stoppedAtPartNumber && (
                    <Typography>
                      Assessment stopped at Part{" "}
                      {managedReport.stoppedAtPartNumber}.
                    </Typography>
                  )}
                  <Typography style={{ marginTop: 8 }}>
                    {managedReport.retakeWarning}
                  </Typography>

                  <div style={{ marginTop: 12 }}>
                    {Array.isArray(managedReport.partResults) &&
                      managedReport.partResults.map((part) => (
                        <Paper
                          key={`managed-part-${part.partNumber}`}
                          style={{
                            padding: 12,
                            marginBottom: 10,
                            border: "1px solid #ddd",
                          }}
                          variant="outlined"
                        >
                          <Typography style={{ fontWeight: 700 }}>
                            Part {part.partNumber}: {part.partTitle}
                          </Typography>
                          <Typography>
                            Wrong answers: {part.wrongCount} -{" "}
                            {part.outcome?.note || ""}
                          </Typography>
                          <div style={{ marginTop: 6 }}>
                            {Array.isArray(part.words) &&
                              part.words.map((wordResult) => (
                                <Typography
                                  key={`managed-word-${part.partNumber}-${wordResult.word}`}
                                  style={{ fontSize: 14 }}
                                >
                                  {wordResult.word}: {getWordStatus(wordResult)}
                                  {!wordResult.isCorrect
                                    ? ` (typed: ${wordResult.typed || "(blank)"}; correct: ${wordResult.correctSpelling})`
                                    : ""}
                                </Typography>
                              ))}
                          </div>
                        </Paper>
                      ))}
                  </div>
                </>
              )}
            </Paper>
          </Grid>
        )}
      </Grid>
    </Container>
  );
}
