import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Container,
  Grid,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from "@material-ui/core";
import { useSnackbar } from "notistack";
import {
  getPlacementPublicReport,
  listPlacementPublicReports,
  markPlacementPublicReportReviewed,
} from "../firebase";

const getWordStatus = (wordResult) =>
  wordResult?.isCorrect ? "Correct" : "Incorrect";

export default function PlacementReports() {
  const { enqueueSnackbar } = useSnackbar();
  const [statusFilter, setStatusFilter] = useState("new");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [selectedReport, setSelectedReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listPlacementPublicReports({
        status: statusFilter,
        limit: 100,
      });
      const nextRows = Array.isArray(result?.data?.rows)
        ? result.data.rows
        : [];
      setRows(nextRows);
      setSelectedReportId((prev) => {
        if (prev && nextRows.some((row) => row.id === prev)) {
          return prev;
        }
        return nextRows[0]?.id || "";
      });
    } catch (error) {
      enqueueSnackbar(error?.message || "Unable to load placement reports.", {
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [enqueueSnackbar, statusFilter]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const loadSelectedReport = useCallback(async () => {
    if (!selectedReportId) {
      setSelectedReport(null);
      return;
    }

    setLoadingReport(true);
    try {
      const result = await getPlacementPublicReport({
        reportId: selectedReportId,
      });
      setSelectedReport(result?.data || null);
    } catch (error) {
      enqueueSnackbar(error?.message || "Unable to load selected report.", {
        variant: "error",
      });
      setSelectedReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [enqueueSnackbar, selectedReportId]);

  useEffect(() => {
    loadSelectedReport();
  }, [loadSelectedReport]);

  const handleMarkReviewed = async () => {
    if (!selectedReportId) return;
    try {
      await markPlacementPublicReportReviewed({ reportId: selectedReportId });
      enqueueSnackbar("Marked report as reviewed.", { variant: "success" });
      await loadRows();
      await loadSelectedReport();
    } catch (error) {
      enqueueSnackbar(error?.message || "Unable to mark report reviewed.", {
        variant: "error",
      });
    }
  };

  return (
    <Container maxWidth="lg">
      <Grid container spacing={2} direction="column">
        <Grid item>
          <Typography variant="h4">Placement Reports</Typography>
          <Typography variant="body2" style={{ marginTop: 8 }}>
            Public Placement Test submissions are listed here for admin review.
          </Typography>
        </Grid>

        <Grid item>
          <Paper style={{ padding: 16 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  fullWidth
                  variant="outlined"
                  label="Filter"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(String(event.target.value || "new"))
                  }
                >
                  <MenuItem value="new">New</MenuItem>
                  <MenuItem value="reviewed">Reviewed</MenuItem>
                  <MenuItem value="all">All</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={8}>
                <Button variant="contained" color="primary" onClick={loadRows}>
                  {loading ? "Refreshing..." : "Refresh"}
                </Button>
              </Grid>
            </Grid>

            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {rows.map((row) => (
                <Paper
                  key={row.id}
                  variant="outlined"
                  style={{
                    padding: 10,
                    cursor: "pointer",
                    border:
                      row.id === selectedReportId
                        ? "2px solid #0d47a1"
                        : "1px solid #ddd",
                  }}
                  onClick={() => setSelectedReportId(row.id)}
                >
                  <Typography style={{ fontWeight: 700 }}>
                    {row.studentFirstName || "(Student)"} -{" "}
                    {row.proctorFirstName || ""} {row.proctorLastName || ""}
                  </Typography>
                  <Typography variant="body2">
                    {row.proctorEmail || ""}
                  </Typography>
                  <Typography variant="body2">
                    Status: {row.status} | Recommended Start: Part{" "}
                    {row.recommendedStartPart || "?"}
                  </Typography>
                </Paper>
              ))}
              {rows.length === 0 && (
                <Typography variant="body2">No reports found.</Typography>
              )}
            </div>
          </Paper>
        </Grid>

        <Grid item>
          <Paper style={{ padding: 16 }}>
            <Typography variant="h6">Report Details</Typography>
            {loadingReport && <Typography>Loading report...</Typography>}
            {!loadingReport && !selectedReport && (
              <Typography>Select a report to view details.</Typography>
            )}

            {!loadingReport && selectedReport && (
              <>
                <Typography style={{ marginTop: 8 }}>
                  Student first name: {selectedReport.studentFirstName || "—"}
                </Typography>
                <Typography>
                  Proctor: {selectedReport.proctorFirstName || "—"}{" "}
                  {selectedReport.proctorLastName || ""}
                </Typography>
                <Typography>
                  Proctor email: {selectedReport.proctorEmail || "—"}
                </Typography>
                <Typography style={{ marginTop: 8 }}>
                  Recommended starting part: Part{" "}
                  {selectedReport?.report?.recommendedStartPart || "?"}
                </Typography>
                {selectedReport?.report?.stoppedAtPartNumber && (
                  <Typography>
                    Assessment stopped at Part{" "}
                    {selectedReport.report.stoppedAtPartNumber}.
                  </Typography>
                )}
                <Typography style={{ marginTop: 8 }}>
                  {selectedReport?.report?.retakeWarning || ""}
                </Typography>

                <div style={{ marginTop: 12 }}>
                  {(Array.isArray(selectedReport?.report?.partResults)
                    ? selectedReport.report.partResults
                    : []
                  ).map((part) => (
                    <Paper
                      key={`placement-public-part-${part.partNumber}`}
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
                        {(Array.isArray(part.words) ? part.words : []).map(
                          (wordResult) => (
                            <Typography
                              key={`placement-public-word-${part.partNumber}-${wordResult.word}`}
                              style={{ fontSize: 14 }}
                            >
                              {wordResult.word}: {getWordStatus(wordResult)}
                              {!wordResult.isCorrect
                                ? ` (typed: ${wordResult.typed || "(blank)"}; correct: ${wordResult.correctSpelling})`
                                : ""}
                            </Typography>
                          ),
                        )}
                      </div>
                    </Paper>
                  ))}
                </div>

                {selectedReport.status !== "reviewed" && (
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleMarkReviewed}
                  >
                    Mark Reviewed
                  </Button>
                )}
              </>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}
