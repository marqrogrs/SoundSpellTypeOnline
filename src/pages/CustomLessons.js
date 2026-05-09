import React, { useContext, useEffect, useState, useMemo } from "react";
import { useHistory } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { UserContext } from "../providers/UserProvider";
import EducatorProgressDashboard from "./EducatorProgressDashboard";
import { triggerErrorAlert } from "../util/alerts";
import {
  subscribeToLessonsByCreator,
  subscribeToLessonsForStudent,
  subscribeToLessonsForClasses,
  subscribeToLessonsForSchool,
  subscribeToLessonsForAll,
  subscribeToStudentProgress,
  deleteCustomLesson,
  getStudentClassIds,
} from "../util/customLessonHelpers";

import Container from "@material-ui/core/Container";
import Typography from "@material-ui/core/Typography";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";
import Paper from "@material-ui/core/Paper";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableContainer from "@material-ui/core/TableContainer";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import LinearProgress from "@material-ui/core/LinearProgress";
import Box from "@material-ui/core/Box";
import Chip from "@material-ui/core/Chip";
import Tabs from "@material-ui/core/Tabs";
import Tab from "@material-ui/core/Tab";
import Tooltip from "@material-ui/core/Tooltip";
import Modal from "@material-ui/core/Modal";
import Backdrop from "@material-ui/core/Backdrop";
import Fade from "@material-ui/core/Fade";
import CircularProgress from "@material-ui/core/CircularProgress";

import PlayArrowIcon from "@material-ui/icons/PlayArrow";
import EditIcon from "@material-ui/icons/Edit";
import DeleteIcon from "@material-ui/icons/Delete";
import AddIcon from "@material-ui/icons/Add";

import { useStyles } from "../styles/material";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    <Box display="flex" alignItems="center" style={{ minWidth: 100 }}>
      <Box flexGrow={1} mr={1}>
        <LinearProgress variant="determinate" value={pct} />
      </Box>
      <Typography
        variant="caption"
        color="textSecondary"
        style={{ whiteSpace: "nowrap" }}
      >
        {completed}/{total}
      </Typography>
    </Box>
  );
}

function assignmentLabel(lesson) {
  if (lesson.type === "forClass")
    return `Class: ${lesson.assignedClassName || "—"}`;
  if (lesson.type === "forStudent") {
    const count = (lesson.assignedStudentIds || []).length;
    return `${count} student${count !== 1 ? "s" : ""}`;
  }
  if (lesson.type === "forSchool")
    return `School: ${lesson.assignedSchoolName || lesson.assignedSchoolId || "—"}`;
  if (lesson.type === "forAll") return "All students";
  return "Personal";
}

// ─── Delete confirmation modal ────────────────────────────────────────────────

function DeleteModal({ open, onClose, lesson, onConfirm, deleting }) {
  const classes = useStyles();
  return (
    <Modal
      className={classes.modal}
      open={open}
      onClose={onClose}
      closeAfterTransition
      BackdropComponent={Backdrop}
      BackdropProps={{ timeout: 500 }}
    >
      <Fade in={open}>
        <div className={classes.modalPaper}>
          <Typography variant="h6">Delete Lesson?</Typography>
          <Typography>
            Delete <strong>{lesson?.name}</strong>? This cannot be undone.
          </Typography>
          <Box display="flex" justifyContent="flex-end" style={{ gap: 8 }}>
            <Button onClick={onClose} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="contained"
              style={{ backgroundColor: "#d32f2f", color: "#fff" }}
              onClick={onConfirm}
              disabled={deleting}
            >
              {deleting ? <CircularProgress size={20} /> : "Delete"}
            </Button>
          </Box>
        </div>
      </Fade>
    </Modal>
  );
}

// ─── Single lesson row ────────────────────────────────────────────────────────

function LessonRow({ lesson, progress, currentUserId, isEducator, onDelete }) {
  const history = useHistory();

  const isCreator = lesson.creatorId === currentUserId;
  // eslint-disable-next-line no-unused-vars
  const canDelete = isCreator;

  // Find this user's progress record
  const myProgress = progress.find((p) => p.lessonId === lesson.id) || null;
  const wordsCompleted = (myProgress?.wordsCompleted || []).length;
  const totalWords = lesson.words?.length || 0;
  const status = myProgress?.completedAt
    ? "Completed"
    : wordsCompleted > 0
      ? "In Progress"
      : "Not Started";
  const statusColor =
    status === "Completed"
      ? "primary"
      : status === "In Progress"
        ? "secondary"
        : "default";

  const availableLevels = lesson.difficultyLevels || [1, 2, 3];

  const handlePlay = () => {
    history.push(`/lessons/custom/${lesson.id}`);
  };

  const handleEdit = () => {
    history.push(`/create-custom-lesson?edit=${lesson.id}`);
  };

  return (
    <TableRow>
      <TableCell>
        <Typography variant="body2">
          <strong>{lesson.name}</strong>
        </Typography>
        <Typography variant="caption" color="textSecondary">
          {isCreator ? "Created by you" : `By ${lesson.creatorName || "—"}`}
          {" · "}
          {assignmentLabel(lesson)}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography variant="caption">{totalWords} words</Typography>
        <br />
        <Typography variant="caption" color="textSecondary">
          Levels: {availableLevels.join(", ")}
        </Typography>
      </TableCell>
      <TableCell>
        <ProgressBar completed={wordsCompleted} total={totalWords} />
      </TableCell>
      <TableCell>
        <Chip label={status} color={statusColor} size="small" />
      </TableCell>
      <TableCell align="right">
        <Typography variant="caption" color="textSecondary">
          {formatDate(myProgress?.lastAttemptAt || lesson.createdAt)}
        </Typography>
      </TableCell>
      <TableCell align="right">
        <Tooltip title="Play">
          <IconButton size="small" color="primary" onClick={handlePlay}>
            <PlayArrowIcon />
          </IconButton>
        </Tooltip>
        {isCreator && (
          <>
            <Tooltip title="Edit">
              <IconButton
                size="small"
                onClick={handleEdit}
                style={{ marginLeft: 4 }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton
                size="small"
                onClick={() => onDelete(lesson)}
                style={{ marginLeft: 4 }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

// ─── Tab panel wrapper ────────────────────────────────────────────────────────

function TabPanel({ children, value, index }) {
  return value === index ? <Box mt={2}>{children}</Box> : null;
}

// ─── Lesson table ─────────────────────────────────────────────────────────────

function LessonTable({
  lessons,
  progress,
  currentUserId,
  isEducator,
  onDelete,
}) {
  const classes = useStyles();
  if (lessons.length === 0) {
    return (
      <Paper style={{ padding: 32, textAlign: "center" }}>
        <Typography variant="body2" color="textSecondary">
          No lessons here yet.
        </Typography>
      </Paper>
    );
  }
  return (
    <TableContainer component={Paper} className={classes.table}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Lesson</TableCell>
            <TableCell>Words</TableCell>
            <TableCell>Progress</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Last Played</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lessons.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              progress={progress}
              currentUserId={currentUserId}
              isEducator={isEducator}
              onDelete={onDelete}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function CustomLessons() {
  // eslint-disable-next-line no-unused-vars
  const classes = useStyles();
  const history = useHistory();
  const auth = useAuth();
  const { userData } = useContext(UserContext);

  const isEducator = auth.isEducator;
  const userId = auth.user?.uid || "";

  // Determine student username (for student accounts, uid !== username)
  const studentUsername = userData?.username || null;
  const effectiveId = isEducator ? userId : studentUsername || userId;

  // ─── Data state ─────────────────────────────────────────────────────────
  const [myLessons, setMyLessons] = useState([]); // created by me
  const [assignedLessons, setAssignedLessons] = useState([]); // assigned to me
  const [classLessons, setClassLessons] = useState([]); // via class membership
  const [schoolLessons, setSchoolLessons] = useState([]); // via school assignment
  const [platformLessons, setPlatformLessons] = useState([]); // forAll lessons
  const [progress, setProgress] = useState([]);
  const [tab, setTab] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Subscribe to lessons I created ─────────────────────────────────────
  useEffect(() => {
    if (!effectiveId) return;
    return subscribeToLessonsByCreator(effectiveId, setMyLessons);
  }, [effectiveId]);

  // ─── Subscribe to lessons assigned to me (student only) ─────────────────
  useEffect(() => {
    if (!effectiveId || isEducator) return;
    return subscribeToLessonsForStudent(effectiveId, setAssignedLessons);
  }, [effectiveId, isEducator]);

  // ─── Subscribe to class-assigned lessons (student only) ──────────────────
  useEffect(() => {
    if (!effectiveId || isEducator) return;
    let unsub = () => {};
    getStudentClassIds(effectiveId).then((classIds) => {
      if (classIds.length > 0) {
        unsub = subscribeToLessonsForClasses(classIds, setClassLessons);
      }
    });
    return () => unsub();
  }, [effectiveId, isEducator]);

  // ─── Subscribe to school-assigned lessons (student only) ─────────────────
  useEffect(() => {
    if (!effectiveId || isEducator) return;
    const schoolId = userData?.schoolId || "";
    return subscribeToLessonsForSchool(schoolId, setSchoolLessons);
  }, [effectiveId, isEducator, userData]);

  // ─── Subscribe to platform-wide lessons (all signed-in users) ────────────
  useEffect(() => {
    if (!effectiveId || isEducator) return;
    return subscribeToLessonsForAll(setPlatformLessons);
  }, [effectiveId, isEducator]);

  // ─── Subscribe to my progress records ────────────────────────────────────
  useEffect(() => {
    if (!effectiveId) return;
    return subscribeToStudentProgress(effectiveId, setProgress);
  }, [effectiveId]);

  // ─── Merge all lessons (de-duplicated by id) ──────────────────────────────
  const allLessons = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const l of [
      ...myLessons,
      ...assignedLessons,
      ...classLessons,
      ...schoolLessons,
      ...platformLessons,
    ]) {
      if (!seen.has(l.id)) {
        seen.add(l.id);
        merged.push(l);
      }
    }
    return merged;
  }, [
    myLessons,
    assignedLessons,
    classLessons,
    schoolLessons,
    platformLessons,
  ]);

  const assignedOnly = useMemo(() => {
    return [
      ...assignedLessons,
      ...classLessons,
      ...schoolLessons,
      ...platformLessons,
    ].filter((l) => l.creatorId !== effectiveId);
  }, [
    assignedLessons,
    classLessons,
    schoolLessons,
    platformLessons,
    effectiveId,
  ]);

  // ─── Delete ────────────────────────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteCustomLesson(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      triggerErrorAlert(e.message || "Could not delete lesson.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Container maxWidth="lg" style={{ marginTop: 24 }}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h5">Custom Lessons</Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={() => history.push("/create-custom-lesson")}
          startIcon={<AddIcon />}
        >
          New Lesson
        </Button>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        indicatorColor="primary"
        textColor="primary"
      >
        <Tab label={`All (${allLessons.length})`} />
        <Tab label={`My Lessons (${myLessons.length})`} />
        {isEducator && <Tab label="Student Progress" />}
        {!isEducator && (
          <Tab label={`Assigned to Me (${assignedOnly.length})`} />
        )}
      </Tabs>

      <TabPanel value={tab} index={0}>
        <LessonTable
          lessons={allLessons}
          progress={progress}
          currentUserId={effectiveId}
          isEducator={isEducator}
          onDelete={setDeleteTarget}
        />
      </TabPanel>
      <TabPanel value={tab} index={1}>
        <LessonTable
          lessons={myLessons}
          progress={progress}
          currentUserId={effectiveId}
          isEducator={isEducator}
          onDelete={setDeleteTarget}
        />
      </TabPanel>
      {isEducator && (
        <TabPanel value={tab} index={2}>
          <EducatorProgressDashboard embedded />
        </TabPanel>
      )}
      {!isEducator && (
        <TabPanel value={tab} index={2}>
          <LessonTable
            lessons={assignedOnly}
            progress={progress}
            currentUserId={effectiveId}
            isEducator={isEducator}
            onDelete={setDeleteTarget}
          />
        </TabPanel>
      )}

      <DeleteModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        lesson={deleteTarget}
        onConfirm={handleConfirmDelete}
        deleting={deleting}
      />
    </Container>
  );
}
