import React, { useState } from "react";
import {
  Button,
  Chip,
  Container,
  Divider,
  Grid,
  Paper,
  TextField,
  Typography,
} from "@material-ui/core";
import swal from "sweetalert";

import { db, applyWordFix } from "../firebase";
import { speakPhoneme } from "../util/Audio";

const toCsv = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");

const toWordArray = (value) =>
  String(value || "")
    .split(/[\s,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const toSyllableArray = (value) =>
  String(value || "")
    .split(/[.\s,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const parseCallableError = (error) => {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").trim();
  const details = error?.details;

  const genericMessages = new Set([
    "internal",
    "INTERNAL",
    "Internal",
    "An internal error has occurred.",
    "UNKNOWN",
    "unknown",
  ]);

  // details may be an object like { errorMessage, errorCode } from the function's catch block
  const serverErrorMessage =
    details && typeof details === "object" && details.errorMessage
      ? String(details.errorMessage)
      : null;
  const detailsText = serverErrorMessage
    ? serverErrorMessage
    : typeof details === "string"
      ? details
      : details
        ? JSON.stringify(details)
        : "";

  const safeMessage = message && !genericMessages.has(message) ? message : "";
  const combined = [safeMessage, detailsText].filter(Boolean).join(" - ");

  if (combined) {
    return code ? `${combined} (${code})` : combined;
  }

  if (code) {
    return `Server rejected this request (${code}).`;
  }

  return "Server error. Please check function logs for details.";
};

const extractCallableDebug = (error, contextLabel) => ({
  context: contextLabel,
  code: String(error?.code || ""),
  message: String(error?.message || ""),
  parsedMessage: parseCallableError(error),
  details:
    error?.details && typeof error.details === "object"
      ? JSON.stringify(error.details, null, 2)
      : String(error?.details || ""),
  at: new Date().toISOString(),
});

export default function WordFixAdmin() {
  const [word, setWord] = useState("");
  const [graphemes, setGraphemes] = useState("");
  const [phonemes, setPhonemes] = useState("");
  const [syllables, setSyllables] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [lastBatchSummary, setLastBatchSummary] = useState(null);
  const [lastDryRunSummary, setLastDryRunSummary] = useState(null);
  const [lastCallableError, setLastCallableError] = useState(null);

  // Word Check state
  const [checkWord, setCheckWord] = useState("");
  const [checkedWordData, setCheckedWordData] = useState(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [playingCheck, setPlayingCheck] = useState(false);

  const normalizedCheckWord = String(checkWord || "")
    .trim()
    .toUpperCase();

  const handleCheckWord = async () => {
    if (!normalizedCheckWord) {
      swal("Word Required", "Enter a word to check.", "warning");
      return;
    }
    setCheckedWordData(null);
    setCheckBusy(true);
    try {
      const doc = await db.collection("words").doc(normalizedCheckWord).get();
      if (!doc.exists) {
        swal(
          "Not Found",
          `No Firestore record found for ${normalizedCheckWord}.`,
          "warning",
        );
        return;
      }
      const data = doc.data() || {};
      setCheckedWordData({
        word: normalizedCheckWord,
        graphemes: Array.isArray(data.graphemes) ? data.graphemes : [],
        phonemes: Array.isArray(data.phonemes) ? data.phonemes : [],
        syllables: Array.isArray(data.syllables) ? data.syllables : [],
      });
    } catch (error) {
      swal("Check Failed", error?.message || "Unable to fetch word.", "error");
    } finally {
      setCheckBusy(false);
    }
  };

  const handlePlayPhonemes = async () => {
    if (!checkedWordData || !checkedWordData.phonemes.length) return;
    setPlayingCheck(true);
    try {
      for (const phoneme of checkedWordData.phonemes) {
        await speakPhoneme(phoneme);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    } finally {
      setPlayingCheck(false);
    }
  };

  const normalizedWord = String(word || "")
    .trim()
    .toUpperCase();

  const handleLoadWord = async () => {
    if (!normalizedWord) {
      swal("Word Required", "Enter a word to load.", "warning");
      return;
    }

    setBusy(true);
    try {
      const doc = await db.collection("words").doc(normalizedWord).get();
      if (!doc.exists) {
        swal(
          "Not Found",
          `No Firestore word doc found for ${normalizedWord}.`,
          "warning",
        );
        return;
      }

      const data = doc.data() || {};
      setGraphemes(toCsv(data.graphemes));
      setPhonemes(toCsv(data.phonemes));
      setSyllables(toCsv(data.syllables));
      setLastResult(null);
    } catch (error) {
      swal("Load Failed", error?.message || "Unable to load word.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleApplyFix = async () => {
    if (!normalizedWord) {
      swal("Word Required", "Enter a word before applying a fix.", "warning");
      return;
    }

    const graphemeArray = toWordArray(graphemes).map((g) => g.toUpperCase());
    const phonemeArray = toWordArray(phonemes).map((p) => p.toUpperCase());
    const syllableArray = toSyllableArray(syllables).map((s) =>
      s.toLowerCase(),
    );

    if (!graphemeArray.length || !phonemeArray.length) {
      swal(
        "Missing Data",
        "Graphemes and phonemes must each have at least one value.",
        "warning",
      );
      return;
    }

    setBusy(true);
    setLastCallableError(null);
    try {
      const res = await applyWordFix({
        word: normalizedWord,
        graphemes: graphemeArray,
        phonemes: phonemeArray,
        syllables: syllableArray,
      });
      const payload = (res && res.data) || {};
      setLastResult(payload);

      if (payload.status !== "success") {
        throw new Error(payload?.error || "Unknown patch failure.");
      }

      const jsonStatus = payload.lexiconUpdated
        ? "JSON lexicon updated"
        : payload.lexiconError
          ? `JSON lexicon unavailable (${payload.lexiconError})`
          : payload.lexiconFound
            ? "JSON lexicon row found but not saved"
            : "JSON lexicon row not found";

      swal(
        "Word Updated",
        `${normalizedWord} saved. Firestore updated and ${jsonStatus}.`,
        "success",
      );
    } catch (error) {
      console.error("WordFixAdmin apply failed", {
        code: error?.code,
        message: error?.message,
        details: error?.details,
      });
      setLastCallableError(extractCallableDebug(error, "single-apply"));
      const displayMsg = parseCallableError(error);
      swal("Patch Failed", displayMsg, "error");
    } finally {
      setBusy(false);
    }
  };

  const parseBatchLine = (line, index) => {
    const cleaned = String(line || "").trim();
    if (!cleaned || cleaned.startsWith("#")) {
      return null;
    }

    const parts = cleaned.split("|").map((part) => part.trim());
    const [
      rawWord = "",
      rawGraphemes = "",
      rawPhonemes = "",
      rawSyllables = "",
    ] = parts;

    const parsedWord = rawWord.toUpperCase();
    const parsedGraphemes = toWordArray(rawGraphemes).map((g) =>
      g.toUpperCase(),
    );
    const parsedPhonemes = toWordArray(rawPhonemes).map((p) => p.toUpperCase());
    const parsedSyllables = toSyllableArray(rawSyllables).map((s) =>
      s.toLowerCase(),
    );

    if (!parsedWord || !parsedGraphemes.length || !parsedPhonemes.length) {
      throw new Error(
        `Line ${index + 1} is invalid. Use: WORD | G1,G2 | P1 P2 | syl.la.bles`,
      );
    }

    return {
      lineNumber: index + 1,
      word: parsedWord,
      graphemes: parsedGraphemes,
      phonemes: parsedPhonemes,
      syllables: parsedSyllables,
    };
  };

  const parseBatchInput = (rawInput) => {
    const lines = String(rawInput || "").split(/\n/);
    const validRows = [];
    const errors = [];

    lines.forEach((line, index) => {
      try {
        const parsed = parseBatchLine(line, index);
        if (parsed) {
          validRows.push(parsed);
        }
      } catch (error) {
        errors.push({
          lineNumber: index + 1,
          message: error?.message || "Invalid row",
        });
      }
    });

    const wordCounts = validRows.reduce((acc, row) => {
      const key = row.word;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const duplicateWords = Object.keys(wordCounts).filter(
      (wordKey) => wordCounts[wordKey] > 1,
    );

    return { validRows, errors, duplicateWords };
  };

  const handleDryRunValidate = () => {
    if (!String(batchInput || "").trim()) {
      swal("Batch Required", "Enter one or more batch lines.", "warning");
      return;
    }

    const { validRows, errors, duplicateWords } = parseBatchInput(batchInput);
    const summary = {
      totalValidRows: validRows.length,
      totalErrors: errors.length,
      duplicateWords,
      sampleWords: validRows.slice(0, 10).map((row) => row.word),
      errors,
    };

    setLastDryRunSummary(summary);

    if (!validRows.length) {
      swal(
        "Dry Run Failed",
        "No valid rows found. Fix the batch format and try again.",
        "error",
      );
      return;
    }

    if (errors.length || duplicateWords.length) {
      const duplicateText = duplicateWords.length
        ? ` Duplicates: ${duplicateWords.join(", ")}.`
        : "";
      swal(
        "Dry Run Found Issues",
        `Valid rows: ${validRows.length}. Errors: ${errors.length}.${duplicateText}`,
        "warning",
      );
      return;
    }

    swal(
      "Dry Run Passed",
      `Ready to apply ${validRows.length} updates. No parse errors or duplicates found.`,
      "success",
    );
  };

  const handleDownloadErrorReport = () => {
    if (!lastDryRunSummary) return;

    const rows = ["Issue Type,Line Number,Detail"];

    (lastDryRunSummary.errors || []).forEach((err) => {
      const safeDetail = String(err.message || "").replace(/"/g, '""');
      rows.push(`Parse Error,${err.lineNumber},"${safeDetail}"`);
    });

    (lastDryRunSummary.duplicateWords || []).forEach((dup) => {
      rows.push(`Duplicate Word,,${dup}`);
    });

    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "word-fix-error-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleApplyBatchFixes = async () => {
    if (!String(batchInput || "").trim()) {
      swal("Batch Required", "Enter one or more batch lines.", "warning");
      return;
    }

    const {
      validRows: batchRows,
      errors,
      duplicateWords,
    } = parseBatchInput(batchInput);

    if (!batchRows.length) {
      swal(
        "Batch Required",
        "No valid batch rows found. Add rows or remove comments-only input.",
        "warning",
      );
      return;
    }

    if (errors.length || duplicateWords.length) {
      const duplicateText = duplicateWords.length
        ? ` Duplicates: ${duplicateWords.join(", ")}.`
        : "";
      swal(
        "Batch Parse Error",
        `Fix issues before apply. Errors: ${errors.length}.${duplicateText}`,
        "error",
      );
      setLastDryRunSummary({
        totalValidRows: batchRows.length,
        totalErrors: errors.length,
        duplicateWords,
        sampleWords: batchRows.slice(0, 10).map((row) => row.word),
        errors,
      });
      return;
    }

    setBusy(true);
    setLastBatchSummary(null);
    setLastCallableError(null);
    try {
      const summary = {
        total: batchRows.length,
        successCount: 0,
        failed: [],
      };

      for (const row of batchRows) {
        try {
          const res = await applyWordFix(row);
          const payload = (res && res.data) || {};
          if (payload.status !== "success") {
            throw new Error(payload?.error || "Unknown patch failure.");
          }
          summary.successCount += 1;
          setLastResult(payload);
        } catch (error) {
          console.error("WordFixAdmin batch row failed", {
            word: row.word,
            code: error?.code,
            message: error?.message,
            details: error?.details,
          });
          if (!summary.failed.length) {
            setLastCallableError(
              extractCallableDebug(error, `batch-apply:${row.word}`),
            );
          }
          summary.failed.push({
            word: row.word,
            message: parseCallableError(error),
          });
        }
      }

      setLastBatchSummary(summary);

      if (!summary.failed.length) {
        swal(
          "Batch Complete",
          `Updated ${summary.successCount}/${summary.total} words.`,
          "success",
        );
        return;
      }

      const failedWords = summary.failed.map((item) => item.word).join(", ");
      swal(
        "Batch Completed With Errors",
        `Updated ${summary.successCount}/${summary.total}. Failed: ${failedWords}`,
        "warning",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="md">
      <Paper style={{ padding: 24, marginTop: 24 }}>
        <Typography variant="h5" gutterBottom>
          Word Check
        </Typography>
        <Typography variant="body2" color="textSecondary" paragraph>
          Look up a word in Firestore to see its current graphemes, phonemes,
          and syllables, then play back the phoneme sounds.
        </Typography>

        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={8}>
            <TextField
              label="Word"
              fullWidth
              variant="outlined"
              value={checkWord}
              onChange={(e) => {
                setCheckWord(e.target.value.toUpperCase());
                setCheckedWordData(null);
              }}
              disabled={checkBusy || playingCheck}
              onKeyPress={(e) => {
                if (e.key === "Enter") handleCheckWord();
              }}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <Button
              variant="contained"
              color="primary"
              onClick={handleCheckWord}
              disabled={checkBusy || playingCheck}
              fullWidth
              style={{ height: "100%" }}
            >
              {checkBusy ? "Checking..." : "Check Word"}
            </Button>
          </Grid>
        </Grid>

        {checkedWordData && (
          <Grid container spacing={1} style={{ marginTop: 16 }}>
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="textSecondary">
                Graphemes
              </Typography>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 4,
                }}
              >
                {checkedWordData.graphemes.map((g, i) => (
                  <Chip key={i} label={g} size="small" variant="outlined" />
                ))}
                {!checkedWordData.graphemes.length && (
                  <Typography variant="body2" color="textSecondary">
                    none
                  </Typography>
                )}
              </div>
            </Grid>
            <Grid item xs={12}>
              <Typography
                variant="subtitle2"
                color="textSecondary"
                style={{ marginTop: 8 }}
              >
                Phonemes
              </Typography>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 4,
                }}
              >
                {checkedWordData.phonemes.map((p, i) => (
                  <Chip key={i} label={p} size="small" color="primary" />
                ))}
                {!checkedWordData.phonemes.length && (
                  <Typography variant="body2" color="textSecondary">
                    none
                  </Typography>
                )}
              </div>
            </Grid>
            <Grid item xs={12}>
              <Typography
                variant="subtitle2"
                color="textSecondary"
                style={{ marginTop: 8 }}
              >
                Syllables
              </Typography>
              <Typography variant="body1" style={{ marginTop: 4 }}>
                {checkedWordData.syllables.length ? (
                  checkedWordData.syllables.join(" · ")
                ) : (
                  <span style={{ color: "#999" }}>none</span>
                )}
              </Typography>
            </Grid>
            <Grid item xs={12} style={{ marginTop: 12 }}>
              <Button
                variant="contained"
                color="secondary"
                onClick={handlePlayPhonemes}
                disabled={playingCheck || !checkedWordData.phonemes.length}
              >
                {playingCheck ? "Playing..." : "Play Phonemes"}
              </Button>
            </Grid>
          </Grid>
        )}

        <Divider style={{ margin: "32px 0 24px" }} />

        <Typography variant="h4" gutterBottom>
          Word Fix Admin
        </Typography>
        <Typography variant="body1" color="textSecondary" paragraph>
          Update a single word in Firestore and patch
          data/SoundSpellerDatabase.json in one submit. Use comma or space
          separators for graphemes and phonemes.
        </Typography>

        <Grid container spacing={2}>
          <Grid item xs={12} sm={8}>
            <TextField
              label="Word"
              fullWidth
              variant="outlined"
              value={word}
              onChange={(e) => setWord(e.target.value.toUpperCase())}
              disabled={busy}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <Button
              variant="outlined"
              color="primary"
              onClick={handleLoadWord}
              disabled={busy}
              fullWidth
              style={{ height: "100%" }}
            >
              Load Current Word
            </Button>
          </Grid>

          <Grid item xs={12}>
            <TextField
              label="Graphemes"
              helperText="Example: J, I, V, E"
              fullWidth
              variant="outlined"
              value={graphemes}
              onChange={(e) => setGraphemes(e.target.value)}
              disabled={busy}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              label="Phonemes"
              helperText="Example: JH AY V"
              fullWidth
              variant="outlined"
              value={phonemes}
              onChange={(e) => setPhonemes(e.target.value)}
              disabled={busy}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              label="Syllables"
              helperText="Optional. Example: ji.ve"
              fullWidth
              variant="outlined"
              value={syllables}
              onChange={(e) => setSyllables(e.target.value)}
              disabled={busy}
            />
          </Grid>

          <Grid item xs={12}>
            <Button
              variant="contained"
              color="secondary"
              onClick={handleApplyFix}
              disabled={busy}
            >
              {busy ? "Saving..." : "Apply Fix"}
            </Button>
          </Grid>
        </Grid>

        {lastResult && (
          <Typography style={{ marginTop: 16 }} color="textSecondary">
            Last save: Firestore={String(Boolean(lastResult.firestoreUpdated))},
            JSON Found=
            {String(Boolean(lastResult.lexiconFound))}, JSON Updated=
            {String(Boolean(lastResult.lexiconUpdated))}
            {lastResult.lexiconError
              ? `, JSON Error=${lastResult.lexiconError}`
              : ""}
          </Typography>
        )}

        {lastCallableError && (
          <Paper
            variant="outlined"
            style={{ marginTop: 16, padding: 12, background: "#fff7f7" }}
          >
            <Typography variant="subtitle2" color="error">
              Last Callable Error Debug
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Context: {lastCallableError.context} | Code:{" "}
              {lastCallableError.code || "(none)"}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Message: {lastCallableError.message || "(empty)"}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Parsed: {lastCallableError.parsedMessage}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Details:
            </Typography>
            <pre
              style={{
                margin: "6px 0 0",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {lastCallableError.details || "(empty)"}
            </pre>
          </Paper>
        )}

        <Typography variant="h5" style={{ marginTop: 32 }} gutterBottom>
          Batch Fixes
        </Typography>
        <Typography variant="body2" color="textSecondary" paragraph>
          One word per line using this format:
          <br />
          WORD | G1,G2,G3 | P1 P2 P3 | syl.la.bles
          <br />
          Syllables are optional. Lines starting with # are ignored.
        </Typography>

        <TextField
          label="Batch Input"
          multiline
          rows={8}
          fullWidth
          variant="outlined"
          value={batchInput}
          onChange={(e) => setBatchInput(e.target.value)}
          disabled={busy}
          placeholder={
            "JIVE | J,I,V,E | JH AY V | ji.ve\nKNEW | KN,EW | N UW | knew"
          }
        />

        <Button
          variant="contained"
          color="primary"
          onClick={handleDryRunValidate}
          disabled={busy}
          style={{ marginTop: 16, marginRight: 8 }}
        >
          Dry Run Validate
        </Button>

        <Button
          variant="contained"
          color="primary"
          onClick={handleApplyBatchFixes}
          disabled={busy}
          style={{ marginTop: 16 }}
        >
          {busy ? "Applying Batch..." : "Apply Batch Fixes"}
        </Button>

        {lastBatchSummary && (
          <Typography style={{ marginTop: 16 }} color="textSecondary">
            Batch summary: {lastBatchSummary.successCount}/
            {lastBatchSummary.total} updated.
            {lastBatchSummary.failed.length
              ? ` Failed: ${lastBatchSummary.failed
                  .map((item) => item.word)
                  .join(", ")}`
              : ""}
          </Typography>
        )}

        {lastDryRunSummary && (
          <>
            <Typography style={{ marginTop: 12 }} color="textSecondary">
              Dry run: {lastDryRunSummary.totalValidRows} valid rows,{" "}
              {lastDryRunSummary.totalErrors} parse errors
              {lastDryRunSummary.duplicateWords.length
                ? `, duplicates: ${lastDryRunSummary.duplicateWords.join(", ")}`
                : ""}
              .
            </Typography>
            {(lastDryRunSummary.totalErrors > 0 ||
              lastDryRunSummary.duplicateWords.length > 0) && (
              <Button
                variant="outlined"
                size="small"
                onClick={handleDownloadErrorReport}
                style={{ marginTop: 8 }}
              >
                Download Error Report
              </Button>
            )}
          </>
        )}
      </Paper>
    </Container>
  );
}
