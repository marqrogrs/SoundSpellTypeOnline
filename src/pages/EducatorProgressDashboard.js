import React, { useEffect, useState, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";

import {
  subscribeToLessonsByCreator,
  subscribeToEducatorLessonProgress,
} from "../util/customLessonHelpers";

import Container from "@material-ui/core/Container";
import Typography from "@material-ui/core/Typography";
import Paper from "@material-ui/core/Paper";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableContainer from "@material-ui/core/TableContainer";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Collapse from "@material-ui/core/Collapse";
import Box from "@material-ui/core/Box";
import IconButton from "@material-ui/core/IconButton";
import Chip from "@material-ui/core/Chip";
import LinearProgress from "@material-ui/core/LinearProgress";
import Tabs from "@material-ui/core/Tabs";
import Tab from "@material-ui/core/Tab";

import KeyboardArrowDownIcon from "@material-ui/icons/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@material-ui/icons/KeyboardArrowUp";

import { useStyles } from "../styles/material";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  notStarted: "Not Started",
  inProgress: "In Progress",
  completed: "Completed",
};

const STATUS_COLORS = {
  notStarted: "default",
  completed: "primary",
  inProgress: "secondary",
};

function getStatus(progress) {
  if (!progress) return "notStarted";
  if (progress.completedAt) return "completed";
  if ((progress.wordsCompleted || []).length > 0) return "inProgress";
  return "notStarted";
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ProgressBar({ completed, total }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <Box display="flex" alignItems="center" style={{ minWidth: 120 }}>
      <Box flexGrow={1} mr={1}>
        <LinearProgress variant="determinate" value={pct} />
      </Box>
      <Typography variant="caption" color="textSecondary">
        {pct}%
      </Typography>
    </Box>
  );
}

// ─── Expandable row per lesson that shows student progress ───────────────────

function LessonProgressRow({ lesson, progressRecords }) {
  const classes = useStyles();
  const [open, setOpen] = useState(false);

  // All progress records for this lesson
  const lessonProgress = useMemo(
    () => progressRecords.filter((p) => p.lessonId === lesson.id),
    [progressRecords, lesson.id],
  );

  // Counters for summary chips
  const counts = useMemo(() => {
    const result = { notStarted: 0, inProgress: 0, completed: 0 };
    // eslint-disable-next-line no-unused-vars
    const totalStudents = getTotalStudents(lesson);
    const assignedStudents = getAssignedStudentIds(lesson);

    // Count from actual progress records
    lessonProgress.forEach((p) => {
      const s = getStatus(p);
      result[s]++;
    });

    // Students assigned but never started
    const startedIds = new Set(lessonProgress.map((p) => p.studentId));
    result.notStarted += assignedStudents.filter(
      (id) => !startedIds.has(id),
    ).length;

    return result;
  }, [lessonProgress, lesson]);

  const assignedStudentIds = getAssignedStudentIds(lesson);
  // Merge: progress records + never-started assigned students
  const rows = useMemo(() => {
    const started = lessonProgress.map((p) => ({
      studentId: p.studentId,
      studentName: p.studentName || p.studentId,
      completed: (p.wordsCompleted || []).length,
      total: p.totalWords || lesson.words?.length || 0,
      attempts: p.attempts || 0,
      lastPlayed: p.lastAttemptAt,
      status: getStatus(p),
    }));
    const startedIds = new Set(started.map((r) => r.studentId));
    const notStarted = assignedStudentIds
      .filter((id) => !startedIds.has(id))
      .map((id) => ({
        studentId: id,
        studentName: id,
        completed: 0,
        total: lesson.words?.length || 0,
        attempts: 0,
        lastPlayed: null,
        status: "notStarted",
      }));
    return [...started, ...notStarted];
  }, [lessonProgress, assignedStudentIds, lesson]);

  const assignmentLabel =
    lesson.type === "personal"
      ? "Personal"
      : lesson.type === "forClass"
        ? `Class: ${lesson.assignedClassName || "—"}`
        : `${(lesson.assignedStudentIds || []).length} student(s)`;

  return (
    <>
      <TableRow className={classes.progressList}>
        <TableCell>
          <IconButton size="small" onClick={() => setOpen((o) => !o)}>
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell>
          <strong>{lesson.name}</strong>
          <Typography variant="caption" color="textSecondary" display="block">
            {assignmentLabel} · {lesson.words?.length ?? 0} words · Levels:{" "}
            {(lesson.difficultyLevels || []).join(", ")}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography variant="caption" color="textSecondary">
            Created {formatDate(lesson.createdAt)}
          </Typography>
        </TableCell>
        <TableCell>
          <Box display="flex" style={{ gap: 4 }}>
            {counts.completed > 0 && (
              <Chip
                size="small"
                label={`${counts.completed} done`}
                color="primary"
              />
            )}
            {counts.inProgress > 0 && (
              <Chip
                size="small"
                label={`${counts.inProgress} in progress`}
                color="secondary"
              />
            )}
            {counts.notStarted > 0 && (
              <Chip size="small" label={`${counts.notStarted} not started`} />
            )}
          </Box>
        </TableCell>
      </TableRow>

      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={4}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box margin={2}>
              {rows.length === 0 ? (
                <Typography variant="body2" color="textSecondary">
                  No students have accessed this lesson yet.
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Student</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Progress</TableCell>
                      <TableCell align="right">Attempts</TableCell>
                      <TableCell align="right">Last Played</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.studentId}>
                        <TableCell>{row.studentName}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={STATUS_LABELS[row.status]}
                            color={STATUS_COLORS[row.status]}
                          />
                        </TableCell>
                        <TableCell>
                          <ProgressBar
                            completed={row.completed}
                            total={row.total}
                          />
                        </TableCell>
                        <TableCell align="right">{row.attempts}</TableCell>
                        <TableCell align="right">
                          {formatDate(row.lastPlayed)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

// ─── Helpers for student IDs ──────────────────────────────────────────────────

function getAssignedStudentIds(lesson) {
  if (lesson.type === "forStudent") {
    return lesson.assignedStudentIds || [];
  }
  // For class assignments, we don't have the roster here—
  // only recorded progress tells us which students have played.
  return [];
}

function getTotalStudents(lesson) {
  if (lesson.type === "forStudent") {
    return (lesson.assignedStudentIds || []).length;
  }
  return null; // unknown for class lessons until played
}

// ─── Tab panel ────────────────────────────────────────────────────────────────

function TabPanel({ children, value, index }) {
  return value === index ? <Box mt={2}>{children}</Box> : null;
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function EducatorProgressDashboard({ embedded = false }) {
  const classes = useStyles();
  const auth = useAuth();
  const educatorId = auth.user?.uid || "";

  const [lessons, setLessons] = useState([]);
  const [progressRecords, setProgressRecords] = useState([]);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (!educatorId) return;
    const unsubLessons = subscribeToLessonsByCreator(educatorId, setLessons);
    const unsubProgress = subscribeToEducatorLessonProgress(
      educatorId,
      setProgressRecords,
    );
    return () => {
      unsubLessons();
      unsubProgress();
    };
  }, [educatorId]);

  const allLessons = lessons;
  const personalLessons = lessons.filter((l) => l.type === "personal");
  const assignedLessons = lessons.filter((l) => l.type !== "personal");

  const renderTable = (filteredLessons) => (
    <TableContainer component={Paper} className={classes.table}>
      <Table aria-label="educator progress table">
        <TableHead>
          <TableRow>
            <TableCell style={{ width: 40 }} />
            <TableCell>Lesson</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Student Progress</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filteredLessons.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} align="center">
                <Typography
                  variant="body2"
                  color="textSecondary"
                  style={{ padding: "24px 0" }}
                >
                  No lessons here yet.
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            filteredLessons.map((lesson) => (
              <LessonProgressRow
                key={lesson.id}
                lesson={lesson}
                progressRecords={progressRecords}
              />
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );

  const content = (
    <>
      <Typography variant="h5" gutterBottom>
        Educator Progress Dashboard
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        Track student completion across all lessons you have created or
        assigned.
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        indicatorColor="primary"
        textColor="primary"
        style={{ marginTop: 16 }}
      >
        <Tab label={`All Lessons (${allLessons.length})`} />
        <Tab label={`Assigned (${assignedLessons.length})`} />
        <Tab label={`Personal (${personalLessons.length})`} />
      </Tabs>

      <TabPanel value={tab} index={0}>
        {renderTable(allLessons)}
      </TabPanel>
      <TabPanel value={tab} index={1}>
        {renderTable(assignedLessons)}
      </TabPanel>
      <TabPanel value={tab} index={2}>
        {renderTable(personalLessons)}
      </TabPanel>
    </>
  );

  if (embedded) {
    return <Box mt={1}>{content}</Box>;
  }

  return (
    <Container maxWidth="lg" style={{ marginTop: 24 }}>
      {content}
    </Container>
  );
}
