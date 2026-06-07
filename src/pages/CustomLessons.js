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
  subscribeToSchools,
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
import Box from "@material-ui/core/Box";
import Chip from "@material-ui/core/Chip";
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

function isLikelyFirestoreId(value) {
  return /^[A-Za-z0-9]{20}$/.test(String(value || ""));
}

const SCHOOL_NAME_OVERRIDES = {
  qFdKygbxib8yNlkA0yj9: "Bird Haven",
};

function assignmentLabel(lesson, schools = [], schoolFallbacks = {}) {
  if (lesson.type === "forClass")
    return `Class: ${lesson.assignedClassName || "—"}`;
  if (lesson.type === "forStudent") {
    const count = (lesson.assignedStudentIds || []).length;
    return `${count} student${count !== 1 ? "s" : ""}`;
  }
  if (lesson.type === "forSchool") {
    // Prefer persisted name, then explicit school lookups, then user-context fallback, then ID.
    let schoolName = lesson.assignedSchoolName;
    if (
      schoolName &&
      lesson.assignedSchoolId &&
      (schoolName === lesson.assignedSchoolId ||
        isLikelyFirestoreId(schoolName))
    ) {
      schoolName = "";
    }
    if (!schoolName && lesson.assignedSchoolId) {
      const school = schools.find((s) => s.id === lesson.assignedSchoolId);
      schoolName = school?.name;
    }
    if (!schoolName && lesson.assignedSchoolId) {
      schoolName = schoolFallbacks.byId?.[lesson.assignedSchoolId] || "";
    }
    if (!schoolName && lesson.assignedSchoolId) {
      schoolName = SCHOOL_NAME_OVERRIDES[lesson.assignedSchoolId] || "";
    }
    if (
      !schoolName &&
      lesson.assignedSchoolId &&
      schoolFallbacks.currentId &&
      lesson.assignedSchoolId === schoolFallbacks.currentId
    ) {
      schoolName = schoolFallbacks.currentName || "";
    }
    return `School: ${schoolName || lesson.assignedSchoolId || "—"}`;
  }
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

function LessonRow({
  lesson,
  progress,
  currentUserId,
  isEducator,
  onDelete,
  schools,
  schoolFallbacks,
}) {
  const history = useHistory();

  const isCreator = lesson.creatorId === currentUserId;
  // eslint-disable-next-line no-unused-vars
  const canDelete = isCreator;

  // Find this user's progress record
  const lessonId = String(lesson?.id || "").trim();
  const myProgress =
    progress.find((p) => String(p?.lessonId || "").trim() === lessonId) || null;
  const wordsCompleted = (myProgress?.wordsCompleted || []).length;
  const masteredWords = (
    myProgress?.masteredWordsLevel3 ||
    myProgress?.wordsMasteredLevel3 ||
    []
  ).length;
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
          {assignmentLabel(lesson, schools, schoolFallbacks)}
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
        <Typography variant="caption">
          {isCreator ? "You" : lesson.creatorName || "—"}
        </Typography>
      </TableCell>
      <TableCell>
        <Chip label={status} color={statusColor} size="small" />
      </TableCell>
      <TableCell>
        <Typography variant="body2" style={{ fontWeight: 600 }}>
          {masteredWords}
        </Typography>
        <Typography variant="caption" color="textSecondary">
          of {totalWords}
        </Typography>
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

// ─── Lesson table ─────────────────────────────────────────────────────────────

function LessonTable({
  lessons,
  progress,
  currentUserId,
  isEducator,
  onDelete,
  schools,
  schoolFallbacks,
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
            <TableCell>Assigned by</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Words Mastered</TableCell>
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
              schools={schools}
              schoolFallbacks={schoolFallbacks}
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
  const isAdmin = auth.isAdmin;
  const isSchoolAdmin = auth.isSchoolAdmin;
  const isParent = auth.isParent;
  const isTutor = auth.isTutor;
  const role = auth.role || "student";
  const userId = auth.user?.uid || "";

  // Determine student username (for student accounts, uid !== username)
  const studentUsername = userData?.username || null;
  const effectiveId = isEducator ? userId : studentUsername || userId;
  const studentIdsToMatch = useMemo(() => {
    if (isEducator) return [];
    return Array.from(
      new Set(
        [userId, studentUsername]
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      ),
    );
  }, [isEducator, userId, studentUsername]);
  const progressStudentIdsToMatch = useMemo(() => {
    // Progress docs are keyed by auth UID; querying legacy username IDs can
    // trigger permission errors for non-matching auth principals.
    if (role !== "student") return [];
    const id = String(userId || "").trim();
    return id ? [id] : [];
  }, [role, userId]);
  const hasManagerLink = Boolean(
    userData?.ownerId ||
    userData?.parentOwnerId ||
    userData?.educator ||
    (Array.isArray(userData?.classIds) && userData.classIds.length > 0),
  );
  const canCreateIndependentStudentLesson =
    role === "student" && Boolean(auth.user?.email) && !hasManagerLink;
  const canCreateLesson =
    isEducator ||
    isAdmin ||
    isSchoolAdmin ||
    isParent ||
    isTutor ||
    canCreateIndependentStudentLesson;

  // ─── Data state ─────────────────────────────────────────────────────────
  const [myLessons, setMyLessons] = useState([]); // created by me
  const [assignedLessons, setAssignedLessons] = useState([]); // assigned to me
  const [classLessons, setClassLessons] = useState([]); // via class membership
  const [schoolLessons, setSchoolLessons] = useState([]); // via school assignment
  const [platformLessons, setPlatformLessons] = useState([]); // forAll lessons
  const [progress, setProgress] = useState([]);
  const [schools, setSchools] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const mergedStudentProgress = useMemo(() => {
    const byLessonId = new Map();
    progress.forEach((record) => {
      const lessonId = String(record?.lessonId || "").trim();
      if (!lessonId) return;
      const existing = byLessonId.get(lessonId);
      if (!existing) {
        byLessonId.set(lessonId, record);
        return;
      }

      const existingMastered = Array.isArray(existing.masteredWordsLevel3)
        ? existing.masteredWordsLevel3.length
        : 0;
      const nextMastered = Array.isArray(record.masteredWordsLevel3)
        ? record.masteredWordsLevel3.length
        : 0;

      const existingUpdatedAt = existing.lastAttemptAt?.toMillis
        ? existing.lastAttemptAt.toMillis()
        : 0;
      const nextUpdatedAt = record.lastAttemptAt?.toMillis
        ? record.lastAttemptAt.toMillis()
        : 0;

      if (
        nextMastered > existingMastered ||
        (nextMastered === existingMastered &&
          nextUpdatedAt >= existingUpdatedAt)
      ) {
        byLessonId.set(lessonId, record);
      }
    });
    return Array.from(byLessonId.values());
  }, [progress]);

  // ─── Subscribe to lessons I created ─────────────────────────────────────
  useEffect(() => {
    if (!effectiveId) return;
    return subscribeToLessonsByCreator(effectiveId, setMyLessons);
  }, [effectiveId]);

  // ─── Subscribe to lessons assigned to me (student only) ─────────────────
  useEffect(() => {
    if (isEducator || studentIdsToMatch.length === 0) {
      setAssignedLessons([]);
      return;
    }

    const snapshotsByStudentId = {};
    const refreshMergedLessons = () => {
      const seen = new Set();
      const merged = [];
      Object.values(snapshotsByStudentId)
        .flat()
        .forEach((lesson) => {
          if (seen.has(lesson.id)) return;
          seen.add(lesson.id);
          merged.push(lesson);
        });
      setAssignedLessons(merged);
    };

    const unsubscribers = studentIdsToMatch.map((studentId) =>
      subscribeToLessonsForStudent(studentId, (lessons) => {
        snapshotsByStudentId[studentId] = lessons;
        refreshMergedLessons();
      }),
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe && unsubscribe());
    };
  }, [isEducator, studentIdsToMatch]);

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
    if (progressStudentIdsToMatch.length === 0) {
      setProgress([]);
      return;
    }

    const snapshotsByStudentId = {};
    const refreshMergedProgress = () => {
      const merged = Object.values(snapshotsByStudentId).flat();
      setProgress(merged);
    };

    const unsubscribers = progressStudentIdsToMatch.map((studentId) =>
      subscribeToStudentProgress(
        studentId,
        (records) => {
          snapshotsByStudentId[studentId] = records;
          refreshMergedProgress();
        },
        (error) => {
          console.error("Custom lessons progress subscription failed:", error);
          triggerErrorAlert(
            "Could not load custom lesson progress. Check Firestore indexes and permissions.",
          );
        },
      ),
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe && unsubscribe());
    };
  }, [progressStudentIdsToMatch]);

  // ─── Subscribe to schools for enriching lesson display ──────────────────
  useEffect(() => {
    return subscribeToSchools(setSchools);
  }, []);

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

  const schoolNameById = useMemo(() => {
    const map = {};
    schools.forEach((school) => {
      if (school?.id && school?.name) map[school.id] = school.name;
    });
    allLessons.forEach((lesson) => {
      const assignedSchoolName = lesson?.assignedSchoolName;
      if (
        lesson?.assignedSchoolId &&
        assignedSchoolName &&
        assignedSchoolName !== lesson.assignedSchoolId &&
        !isLikelyFirestoreId(assignedSchoolName)
      ) {
        map[lesson.assignedSchoolId] = lesson.assignedSchoolName;
      }
    });
    return map;
  }, [schools, allLessons]);

  const currentUserSchoolId = userData?.schoolId || "";
  const currentUserSchoolName =
    userData?.schoolName || userData?.school?.name || userData?.school || "";
  const schoolFallbacks = useMemo(
    () => ({
      byId: schoolNameById,
      currentId: currentUserSchoolId,
      currentName: currentUserSchoolName,
    }),
    [schoolNameById, currentUserSchoolId, currentUserSchoolName],
  );

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
        {canCreateLesson && (
          <Button
            variant="contained"
            color="primary"
            onClick={() => history.push("/create-custom-lesson")}
            startIcon={<AddIcon />}
          >
            New Lesson
          </Button>
        )}
      </Box>

      <Box mt={2}>
        <LessonTable
          lessons={allLessons}
          progress={mergedStudentProgress}
          currentUserId={effectiveId}
          isEducator={isEducator}
          onDelete={setDeleteTarget}
          schools={schools}
          schoolFallbacks={schoolFallbacks}
        />
      </Box>

      {isEducator && (
        <Box mt={3}>
          <Typography variant="h6" gutterBottom>
            Student Progress
          </Typography>
          <EducatorProgressDashboard embedded />
        </Box>
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
