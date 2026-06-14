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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Paper,
  MenuItem,
  TextField,
  Typography,
} from "@material-ui/core";
import { useSnackbar } from "notistack";
import { useAuth } from "../hooks/useAuth";
import {
  upsertPlacementReport,
  submitPublicPlacementReport,
  assignPlacementTest,
  getPlacementReport,
  getPlacementAssignmentStatus,
  mgmtListData,
} from "../firebase";
import { useStyles } from "../styles/material";
import PlacementOutputWord from "../components/PlacementOutputWord";
import {
  clearPendingPlacementReport,
  readPendingPlacementReport,
  writePendingPlacementReport,
} from "../util/placementStorage";

const placementDataModule = require("../data/placementTestData.cjs");
const PLACEMENT_TEST_PARTS = Array.isArray(placementDataModule)
  ? placementDataModule
  : Array.isArray(placementDataModule?.PLACEMENT_TEST_PARTS)
    ? placementDataModule.PLACEMENT_TEST_PARTS
    : Array.isArray(placementDataModule?.default)
      ? placementDataModule.default
      : Array.isArray(placementDataModule?.default?.PLACEMENT_TEST_PARTS)
        ? placementDataModule.default.PLACEMENT_TEST_PARTS
        : [];

const REPORT_VERSION = 1;

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

const buildPlacementReport = ({ partResults, stoppedAtPartNumber = null }) => {
  const firstStartHere = partResults.find(
    (part) => part.outcome?.recommendStartHere,
  );
  const firstReview = partResults.find((part) => part.wrongCount > 0);
  const recommendedStartPart =
    firstStartHere?.partNumber || firstReview?.partNumber || 1;

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

  const [directionsOpen, setDirectionsOpen] = useState(true);
  const [started, setStarted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [currentPartIndex, setCurrentPartIndex] = useState(0);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [inputWord, setInputWord] = useState("");
  const [enableInput, setEnableInput] = useState(false);
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

  const answerInputRef = useRef(null);

  const currentPart = PLACEMENT_TEST_PARTS[currentPartIndex] || null;
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
    if (!currentWordDef) {
      return null;
    }
    return {
      word: currentWordDef.word,
      phonemes: Array.isArray(currentWordDef.phonemes)
        ? currentWordDef.phonemes
        : [],
    };
  }, [currentWordDef]);

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

  const pushWordResult = useCallback((wordResult) => {
    setPartResults((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (!last || last.partNumber !== wordResult.partNumber) {
        next.push({
          partNumber: wordResult.partNumber,
          partTitle: wordResult.partTitle,
          words: [wordResult],
          wrongCount: wordResult.isCorrect ? 0 : 1,
          outcome: null,
        });
        return next;
      }

      const updatedWords = [...last.words, wordResult];
      const wrongCount = updatedWords.filter((w) => !w.isCorrect).length;
      next[next.length - 1] = {
        ...last,
        words: updatedWords,
        wrongCount,
      };
      return next;
    });
  }, []);

  const finalizeCurrentPart = useCallback(({ targetPartNumber }) => {
    let finalPart = null;
    setPartResults((prev) => {
      const next = [...prev];
      const index = next.findIndex(
        (part) => part.partNumber === targetPartNumber,
      );
      if (index < 0) {
        return prev;
      }
      const part = next[index];
      const outcome = getPartOutcome(part.wrongCount);
      finalPart = {
        ...part,
        outcome,
      };
      next[index] = finalPart;
      return next;
    });
    return finalPart;
  }, []);

  const finishAssessment = useCallback(
    ({ stoppedAtPartNumber = null }) => {
      setEnableInput(false);
      setStarted(false);
      setCompleted(true);

      setPartResults((prev) => {
        const finalized = prev.map((part) =>
          part.outcome
            ? part
            : {
                ...part,
                outcome: getPartOutcome(part.wrongCount),
              },
        );
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
        return finalized;
      });
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

  const handleRepeatWord = useCallback(() => {
    if (!started || !wordPrompt) {
      return;
    }
    setEnableInput(false);
    setRunKey((prev) => prev + 1);
  }, [started, wordPrompt]);

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

    pushWordResult(wordResult);
    setInputWord("");
    setEnableInput(false);

    const isLastWordInPart =
      currentWordIndex >=
      (Array.isArray(currentPart.words) ? currentPart.words.length - 1 : 0);

    if (!isLastWordInPart) {
      setCurrentWordIndex((prev) => prev + 1);
      setRunKey((prev) => prev + 1);
      return;
    }

    const finalPart = finalizeCurrentPart({
      targetPartNumber: currentPart.number,
    });

    if (!finalPart) {
      finishAssessment({ stoppedAtPartNumber: currentPart.number });
      return;
    }

    if (!finalPart.outcome?.shouldContinue) {
      finishAssessment({ stoppedAtPartNumber: currentPart.number });
      return;
    }

    if (currentPartIndex >= PLACEMENT_TEST_PARTS.length - 1) {
      finishAssessment({ stoppedAtPartNumber: null });
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
    finalizeCurrentPart,
    finishAssessment,
    inputWord,
    pushWordResult,
    started,
  ]);

  const handleStart = useCallback(() => {
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

    setCompleted(false);
    setStarted(true);
    setCurrentPartIndex(0);
    setCurrentWordIndex(0);
    setPartResults([]);
    setReport(null);
    setInputWord("");
    setEnableInput(false);
    setRunKey((prev) => prev + 1);
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
    selectedStudentId,
    studentHasAssignment,
  ]);

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

  return (
    <Container maxWidth="md">
      <Grid container spacing={2} direction="column">
        <Grid item>
          <Typography variant="h4" style={{ textAlign: "center" }}>
            Placement Test
          </Typography>
          <Typography
            variant="body2"
            style={{ textAlign: "center", marginTop: 8 }}
          >
            Retake warning: results from retaking this test are less valid
            because nonsense words can be memorized rather than spelling
            patterns learned.
          </Typography>
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
                      setSelectedStudentId(String(event.target.value || ""));
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
                    onChange={(event) =>
                      setPublicIntake((prev) => ({
                        ...prev,
                        studentFirstName: event.target.value,
                      }))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="Proctor First Name"
                    value={publicIntake.proctorFirstName}
                    onChange={(event) =>
                      setPublicIntake((prev) => ({
                        ...prev,
                        proctorFirstName: event.target.value,
                      }))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="Proctor Last Name"
                    value={publicIntake.proctorLastName}
                    onChange={(event) =>
                      setPublicIntake((prev) => ({
                        ...prev,
                        proctorLastName: event.target.value,
                      }))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    label="Proctor Email"
                    value={publicIntake.proctorEmail}
                    onChange={(event) =>
                      setPublicIntake((prev) => ({
                        ...prev,
                        proctorEmail: event.target.value,
                      }))
                    }
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
                (isManagerRole &&
                  (!selectedStudentId || managedStudents.length === 0)) ||
                (Boolean(auth.user) &&
                  !isManagerRole &&
                  (studentAssignmentLoading || !studentHasAssignment))
              }
              style={{ fontWeight: 700, minHeight: 48, width: "100%" }}
            >
              Start
            </Button>
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
              {started && wordPrompt && !enableInput && (
                <PlacementOutputWord
                  word={wordPrompt.word}
                  phonemes={wordPrompt.phonemes}
                  runKey={runKey}
                  onReadyForInput={handleReadyForInput}
                />
              )}

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
                  display: started && !enableInput ? "none" : undefined,
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
                }}
                placeholder=""
              />

              {started && (
                <ButtonGroup color="primary" variant="contained">
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleRepeatWord}
                    disabled={!started}
                  >
                    Repeat
                  </Button>
                </ButtonGroup>
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

      <Dialog
        open={directionsOpen}
        onClose={() => setDirectionsOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Placement Test Directions</DialogTitle>
        <DialogContent dividers>
          <Typography>
            You are about to hear a list of nonsense (not real) words, one at a
            time, and you will then type (or have someone type it for you) the
            word the way you think it should be spelled. Pretend that they are
            real words and you want to spell them properly following your
            knowledge of spelling rules (patterns). Spell them the way you think
            they should be spelled if they were real.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDirectionsOpen(false)}
            color="primary"
            variant="contained"
          >
            I Understand
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
