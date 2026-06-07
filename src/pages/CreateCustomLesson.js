import React, {
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useHistory, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { UserContext } from "../providers/UserProvider";
import { mgmtListData } from "../firebase";
import { triggerErrorAlert } from "../util/alerts";
import {
  validateWords,
  createCustomLesson,
  getCustomLesson,
  subscribeToEducatorClasses,
  subscribeToAllEducatorClasses,
  subscribeToSchools,
  updateCustomLesson,
} from "../util/customLessonHelpers";

import Container from "@material-ui/core/Container";
import Typography from "@material-ui/core/Typography";
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";
import Paper from "@material-ui/core/Paper";
import Box from "@material-ui/core/Box";
import Checkbox from "@material-ui/core/Checkbox";
import FormControlLabel from "@material-ui/core/FormControlLabel";
import FormGroup from "@material-ui/core/FormGroup";
import FormLabel from "@material-ui/core/FormLabel";
import CircularProgress from "@material-ui/core/CircularProgress";
import Chip from "@material-ui/core/Chip";
import MenuItem from "@material-ui/core/MenuItem";
import Select from "@material-ui/core/Select";
import FormControl from "@material-ui/core/FormControl";
import InputLabel from "@material-ui/core/InputLabel";
import Divider from "@material-ui/core/Divider";

const WORD_SOFT_LIMIT = 100;

// Parse a raw textarea value into a clean word array
function parseWordInput(raw) {
  return raw
    .split(/[\s,\n]+/)
    .map((w) => w.trim().toUpperCase())
    .filter(Boolean);
}

export default function CreateCustomLesson() {
  const history = useHistory();
  const location = useLocation();
  const auth = useAuth();
  const { userData } = useContext(UserContext);
  const editLessonId = new URLSearchParams(location.search).get("edit");
  const isEditMode = Boolean(editLessonId);
  const isHydratingEditRef = useRef(false);

  const isEducator = auth.isEducator;
  const isParent = auth.isParent;
  const isTutor = auth.isTutor;
  const isSchoolAdmin = auth.isSchoolAdmin;
  const isAdmin = auth.isAdmin;
  const role = auth.role || "student";
  const userId = auth.user?.uid || "";
  const userName =
    userData?.displayName || userData?.email || userData?.username || userId;

  // ─── Form state ───────────────────────────────────────────────────────────
  const [lessonName, setLessonName] = useState("");
  const [wordInput, setWordInput] = useState("");
  const [difficultyLevels, setDifficultyLevels] = useState([1, 2, 3]);
  const [assignmentType, setAssignmentType] = useState("personal"); // "personal" | "forStudent" | "forClass" | "forSchool" | "forAll"
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [parentTutorAssignee, setParentTutorAssignee] = useState("");

  // ─── Validation state ─────────────────────────────────────────────────────
  const [validWords, setValidWords] = useState([]);
  const [invalidWords, setInvalidWords] = useState([]);
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);

  // ─── Class data (legacy educatorClasses + v2 classes) ────────────────────
  const [legacyClasses, setLegacyClasses] = useState([]);
  const [scopedClasses, setScopedClasses] = useState([]);
  const [managedStudents, setManagedStudents] = useState([]);

  // ─── School data (for admin school picker / schoolAdmin display) ──────────
  const [schools, setSchools] = useState([]);

  // ─── UI state ─────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [loadingLesson, setLoadingLesson] = useState(false);

  const hasManagerLink = Boolean(
    userData?.ownerId ||
    userData?.parentOwnerId ||
    userData?.educator ||
    (Array.isArray(userData?.classIds) && userData.classIds.length > 0),
  );
  const canAssignToSelf =
    role === "student" && Boolean(auth.user?.email) && !hasManagerLink;
  const isParentOrTutor = isParent || isTutor;
  const canAssignByClass = !(
    !isEducator &&
    !isAdmin &&
    !isSchoolAdmin &&
    !isParent &&
    !isTutor
  );
  const canAssignByStudent = canAssignByClass;
  const canAssignBySchool = isAdmin || isSchoolAdmin;
  const canAssignForAll = isAdmin;
  const showAssignmentSection = Boolean(userId) && !canAssignToSelf;
  const isStudentWithoutAssignableTargets =
    role === "student" &&
    !isEducator &&
    !isAdmin &&
    !isSchoolAdmin &&
    !isParentOrTutor &&
    !canAssignToSelf;
  const hasNoParentTutorStudents =
    isParentOrTutor && managedStudents.length === 0;
  const hasNoAssignableTargets =
    isStudentWithoutAssignableTargets || hasNoParentTutorStudents;

  const classes = useMemo(() => {
    const out = [];
    const seen = new Set();

    legacyClasses.forEach((c) => {
      const id = String(c.id || "").trim();
      if (!id) return;
      const key = `legacy:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id,
        source: "legacy",
        className: c.className || c.name || id,
        educatorName: c.educatorName || c.educatorId || "",
        students: Object.values(c.students || {}),
      });
    });

    scopedClasses.forEach((c) => {
      const id = String(c.id || "").trim();
      if (!id) return;
      const key = `v2:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id,
        source: "v2",
        className: c.className || c.name || id,
        educatorName: c.educatorName || c.educatorId || "",
        students: Array.isArray(c.students) ? c.students : [],
      });
    });

    return out;
  }, [legacyClasses, scopedClasses]);

  useEffect(() => {
    if (!userId || (!isEducator && !isAdmin && !isSchoolAdmin)) return;
    // Keep legacy class support for existing educatorClasses-based lessons.
    const unsub =
      isAdmin || isSchoolAdmin
        ? subscribeToAllEducatorClasses(setLegacyClasses)
        : subscribeToEducatorClasses(userId, setLegacyClasses);
    return unsub;
  }, [isEducator, isAdmin, isSchoolAdmin, userId]);

  useEffect(() => {
    let isMounted = true;
    if (!userId || role === "student") {
      setScopedClasses([]);
      setManagedStudents([]);
      return () => {
        isMounted = false;
      };
    }

    const loadScopedClasses = async () => {
      try {
        const result = await mgmtListData({});
        if (!isMounted) return;
        const payload = result?.data || {};
        const users = Array.isArray(payload.users) ? payload.users : [];
        const usersById = users.reduce((acc, u) => {
          acc[String(u.id || "")] = u;
          return acc;
        }, {});

        const ownedStudents = users
          .filter((u) => {
            const normalizedRole = String(u?.role || "").toLowerCase();
            const ownerId = String(u?.ownerId || u?.parentOwnerId || "");
            return (
              isParentOrTutor &&
              normalizedRole === "student" &&
              ownerId === userId
            );
          })
          .map((u) => ({
            username: String(u.username || u.id || "").trim(),
            name: String(
              u.name || u.displayName || u.username || u.id || "",
            ).trim(),
          }))
          .filter((s) => Boolean(s.username));

        const normalized = (
          Array.isArray(payload.classes) ? payload.classes : []
        ).map((c) => {
          const studentIds = Array.isArray(c.studentIds) ? c.studentIds : [];
          const students = studentIds.map((id) => {
            const student = usersById[String(id)] || {};
            return {
              username: String(student.username || id),
              name: String(
                student.name || student.displayName || student.username || id,
              ),
            };
          });
          return {
            id: c.id,
            source: "v2",
            className: c.name || c.className || c.id,
            educatorId: c.educatorId || "",
            educatorName: c.educatorName || c.educatorId || "",
            students,
          };
        });

        setScopedClasses(normalized);
        setManagedStudents(ownedStudents);
      } catch (e) {
        if (!isMounted) return;
        // Students are not allowed to call mgmtListData. Others should usually pass.
        setScopedClasses([]);
        setManagedStudents([]);
      }
    };

    loadScopedClasses();

    return () => {
      isMounted = false;
    };
  }, [isParentOrTutor, userId, role]);

  // Load schools for school picker (schoolAdmin sees own school, admin sees all)
  useEffect(() => {
    if (!isSchoolAdmin && !isAdmin) return;
    return subscribeToSchools(setSchools);
  }, [isSchoolAdmin, isAdmin]);

  useEffect(() => {
    if (!isEditMode || !editLessonId || !userId) return;
    let isMounted = true;

    const loadLesson = async () => {
      setLoadingLesson(true);
      try {
        const lesson = await getCustomLesson(editLessonId);
        if (!isMounted) return;

        if (!lesson) {
          triggerErrorAlert("Lesson not found.");
          history.push("/custom-lessons");
          return;
        }

        if (lesson.creatorId !== userId) {
          triggerErrorAlert("You can only edit lessons you created.");
          history.push("/custom-lessons");
          return;
        }

        isHydratingEditRef.current = true;
        setLessonName(lesson.name || "");
        setWordInput((lesson.words || []).join("\n"));
        setDifficultyLevels(lesson.difficultyLevels || [1, 2, 3]);
        setAssignmentType(lesson.type || "personal");
        setSelectedClassId(lesson.assignedClassId || "");
        setSelectedStudentIds(lesson.assignedStudentIds || []);
        if (isParentOrTutor) {
          const firstAssigned = String(lesson.assignedStudentIds?.[0] || "");
          setParentTutorAssignee(
            lesson.type === "forStudent" && firstAssigned ? firstAssigned : "",
          );
        }
        setSelectedSchoolId(lesson.assignedSchoolId || "");
        setValidWords(lesson.words || []);
        setInvalidWords([]);
        setValidated(true);
      } catch (e) {
        if (isMounted) {
          triggerErrorAlert("Could not load lesson for editing.");
          history.push("/custom-lessons");
        }
      } finally {
        if (isMounted) {
          setLoadingLesson(false);
        }
      }
    };

    loadLesson();

    return () => {
      isMounted = false;
    };
  }, [editLessonId, history, isEditMode, isParentOrTutor, userId]);

  // Reset validation when word input changes
  useEffect(() => {
    if (isHydratingEditRef.current) {
      isHydratingEditRef.current = false;
      return;
    }
    setValidated(false);
    setValidWords([]);
    setInvalidWords([]);
  }, [wordInput]);

  // ─── Word validation ──────────────────────────────────────────────────────
  const handleValidate = useCallback(async () => {
    const words = parseWordInput(wordInput);
    if (words.length === 0) return;
    setValidating(true);
    try {
      const result = await validateWords(words);
      setValidWords(result.validWords);
      setInvalidWords(result.invalidWords);
      setValidated(true);
    } catch (e) {
      triggerErrorAlert("Could not validate words. Please try again.");
    } finally {
      setValidating(false);
    }
  }, [wordInput]);

  // ─── Level toggle ─────────────────────────────────────────────────────────
  const toggleLevel = (level) => {
    setDifficultyLevels((prev) =>
      prev.includes(level)
        ? prev.filter((l) => l !== level)
        : [...prev, level].sort(),
    );
  };

  // ─── Student selection ────────────────────────────────────────────────────
  const toggleStudent = (studentId) => {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId)
        ? prev.filter((id) => id !== studentId)
        : [...prev, studentId],
    );
  };

  // ─── Derive student list from selected class ──────────────────────────────
  const selectedClass = classes.find((c) => c.id === selectedClassId) || null;
  const studentsInSelectedClass = selectedClass
    ? Object.values(selectedClass.students || {})
    : [];
  const effectiveAssignmentType = canAssignToSelf
    ? "personal"
    : isParentOrTutor
      ? "forStudent"
      : assignmentType;

  // ─── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!lessonName.trim()) {
      triggerErrorAlert("Please enter a lesson name.");
      return;
    }
    if (!validated) {
      triggerErrorAlert("Please validate your word list first.");
      return;
    }
    if (validWords.length === 0) {
      triggerErrorAlert("No valid words found. Please check your word list.");
      return;
    }
    if (difficultyLevels.length === 0) {
      triggerErrorAlert("Please select at least one difficulty level.");
      return;
    }
    if (hasNoAssignableTargets) {
      triggerErrorAlert(
        "No assignable students are available for this account.",
      );
      return;
    }
    if (!canAssignToSelf && effectiveAssignmentType === "personal") {
      triggerErrorAlert(
        "Self-assignment is only available to independent student accounts.",
      );
      return;
    }
    if (
      effectiveAssignmentType === "forClass" &&
      canAssignByClass &&
      !selectedClassId
    ) {
      triggerErrorAlert("Please select a class to assign to.");
      return;
    }
    if (
      effectiveAssignmentType === "forStudent" &&
      canAssignByStudent &&
      (isParentOrTutor ? !parentTutorAssignee : selectedStudentIds.length === 0)
    ) {
      triggerErrorAlert("Please select at least one student.");
      return;
    }
    if (effectiveAssignmentType === "forSchool") {
      const resolvedSchoolId = isAdmin
        ? selectedSchoolId
        : userData?.schoolId || "";
      if (!resolvedSchoolId) {
        triggerErrorAlert(
          isAdmin
            ? "Please select a school to assign to."
            : "Your account is not associated with a school. Contact an admin.",
        );
        return;
      }
    }

    setSaving(true);
    try {
      const base = {
        name: lessonName.trim(),
        creatorId: userId,
        creatorName: userName,
        creatorType: role,
        words: validWords,
        difficultyLevels,
        type: effectiveAssignmentType,
      };

      if (isEducator || isAdmin || isSchoolAdmin || isParent || isTutor) {
        base.educatorId = userId;
        base.educatorName = userName;
      }

      if (effectiveAssignmentType === "forStudent") {
        base.assignedStudentIds = isParentOrTutor
          ? [parentTutorAssignee]
          : selectedStudentIds;
      }

      if (effectiveAssignmentType === "forClass") {
        base.assignedClassId = selectedClassId;
        base.assignedClassName = selectedClass?.className || "";
        base.assignedClassSource =
          selectedClass?.source === "v2" ? "v2" : "legacy";
        // Pre-populate assignedStudentIds so security rules can match individuals
        base.assignedStudentIds = studentsInSelectedClass.map(
          (s) => s.username,
        );
      }

      if (effectiveAssignmentType === "forSchool") {
        const schoolId = isAdmin ? selectedSchoolId : userData?.schoolId || "";
        const schoolDoc = schools.find((s) => s.id === schoolId);
        base.assignedSchoolId = schoolId;
        base.assignedSchoolName = schoolDoc?.name || "";
      }

      // forAll: no extra assignment fields needed — type alone is the selector

      if (isEditMode && editLessonId) {
        await updateCustomLesson(editLessonId, base);
        history.push(`/lessons/custom/${editLessonId}`);
      } else {
        const createdLesson = await createCustomLesson(base);
        history.push(`/lessons/custom/${createdLesson.id}`);
      }
    } catch (e) {
      triggerErrorAlert(e.message || "Could not save lesson.");
    } finally {
      setSaving(false);
    }
  };

  if (loadingLesson) {
    return (
      <Container maxWidth="sm" style={{ marginTop: 24 }}>
        <Box display="flex" alignItems="center" justifyContent="center" mt={6}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  // ─── Derived ──────────────────────────────────────────────────────────────
  const parsedWordCount = parseWordInput(wordInput).length;
  const overLimit = parsedWordCount > WORD_SOFT_LIMIT;

  return (
    <Container maxWidth="sm" style={{ marginTop: 24 }}>
      <Typography variant="h5" gutterBottom>
        {isEditMode ? "Edit Custom Lesson" : "Create Custom Lesson"}
      </Typography>

      {/* Lesson Name */}
      <Paper style={{ padding: 24, marginBottom: 24 }}>
        <TextField
          label="Lesson Name"
          variant="outlined"
          fullWidth
          value={lessonName}
          onChange={(e) => setLessonName(e.target.value)}
          inputProps={{ maxLength: 80 }}
        />
      </Paper>

      {/* Word List */}
      <Paper style={{ padding: 24, marginBottom: 24 }}>
        <Typography variant="subtitle1" gutterBottom>
          Word List
        </Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Paste or type words separated by spaces, commas, or new lines. Only
          words already in the Sound Spell Type word list will be included.
        </Typography>

        <TextField
          multiline
          rows={6}
          variant="outlined"
          fullWidth
          placeholder="e.g. future capture nature lecture"
          value={wordInput}
          onChange={(e) => setWordInput(e.target.value)}
          inputProps={{ style: { fontFamily: "monospace" } }}
        />

        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          mt={1}
        >
          <Typography
            variant="caption"
            color={overLimit ? "error" : "textSecondary"}
          >
            {parsedWordCount} word{parsedWordCount !== 1 ? "s" : ""}
            {overLimit
              ? ` — over the recommended limit of ${WORD_SOFT_LIMIT}. Large lessons may be slow.`
              : ""}
          </Typography>
          <Button
            variant="outlined"
            color="primary"
            size="small"
            onClick={handleValidate}
            disabled={parsedWordCount === 0 || validating}
          >
            {validating ? <CircularProgress size={18} /> : "Validate Words"}
          </Button>
        </Box>

        {/* Validation results */}
        {validated && (
          <Box mt={2}>
            {validWords.length > 0 && (
              <Box mb={1}>
                <Typography
                  variant="caption"
                  style={{ color: "#388e3c", fontWeight: 600 }}
                >
                  ✓ {validWords.length} valid word
                  {validWords.length !== 1 ? "s" : ""}
                </Typography>
                <Box display="flex" flexWrap="wrap" mt={0.5} style={{ gap: 4 }}>
                  {validWords.map((w) => (
                    <Chip
                      key={w}
                      label={w}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  ))}
                </Box>
              </Box>
            )}
            {invalidWords.length > 0 && (
              <Box>
                <Typography
                  variant="caption"
                  style={{ color: "#d32f2f", fontWeight: 600 }}
                >
                  ✗ {invalidWords.length} word
                  {invalidWords.length !== 1 ? "s" : ""} not found — will be
                  skipped
                </Typography>
                <Box display="flex" flexWrap="wrap" mt={0.5} style={{ gap: 4 }}>
                  {invalidWords.map((w) => (
                    <Chip
                      key={w}
                      label={w}
                      size="small"
                      variant="outlined"
                      style={{ color: "#999", borderColor: "#ccc" }}
                    />
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Paper>

      {/* Difficulty Levels */}
      <Paper style={{ padding: 24, marginBottom: 24 }}>
        <FormLabel component="legend" style={{ marginBottom: 8 }}>
          Difficulty Levels
        </FormLabel>
        <FormGroup row>
          {[1, 2, 3].map((level) => (
            <FormControlLabel
              key={level}
              control={
                <Checkbox
                  checked={difficultyLevels.includes(level)}
                  onChange={() => toggleLevel(level)}
                  color="primary"
                />
              }
              label={`Level ${level}`}
            />
          ))}
        </FormGroup>
      </Paper>

      {/* Assignment (role-aware) */}
      {showAssignmentSection && (
        <Paper style={{ padding: 24, marginBottom: 24 }}>
          <Typography variant="subtitle1" gutterBottom>
            Assign To
          </Typography>
          {isParentOrTutor ? (
            <Box mt={1}>
              <FormControl variant="outlined" fullWidth>
                <InputLabel>Select Student</InputLabel>
                <Select
                  value={parentTutorAssignee}
                  onChange={(e) => {
                    const value = String(e.target.value || "");
                    setParentTutorAssignee(value);
                    setAssignmentType("forStudent");
                    setSelectedStudentIds(value ? [value] : []);
                    setSelectedClassId("");
                    setSelectedSchoolId("");
                  }}
                  label="Select Student"
                >
                  {managedStudents.map((student) => (
                    <MenuItem key={student.username} value={student.username}>
                      {student.name || student.username}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {managedStudents.length === 0 && (
                <Typography variant="caption" color="textSecondary">
                  No students are linked to your account.
                </Typography>
              )}
            </Box>
          ) : (
            <FormGroup>
              {/* ── Entire school ── schoolAdmin and admin only */}
              {canAssignBySchool && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={assignmentType === "forSchool"}
                      onChange={() => {
                        setAssignmentType("forSchool");
                        setSelectedClassId("");
                        setSelectedStudentIds([]);
                        // Pre-select school admin's own school
                        if (!isAdmin) {
                          setSelectedSchoolId(userData?.schoolId || "");
                        }
                      }}
                      color="primary"
                    />
                  }
                  label="Entire school"
                />
              )}

              {/* ── All students everywhere ── admin only */}
              {canAssignForAll && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={assignmentType === "forAll"}
                      onChange={() => {
                        setAssignmentType("forAll");
                        setSelectedClassId("");
                        setSelectedStudentIds([]);
                        setSelectedSchoolId("");
                        setParentTutorAssignee("");
                      }}
                      color="primary"
                    />
                  }
                  label="All students (entire platform)"
                />
              )}

              {/* ── Entire class ── all educator roles */}
              {canAssignByClass && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={assignmentType === "forClass"}
                      onChange={() => {
                        setAssignmentType("forClass");
                        setSelectedStudentIds([]);
                        setSelectedSchoolId("");
                        setParentTutorAssignee("");
                      }}
                      color="primary"
                    />
                  }
                  label={isParentOrTutor ? "All students" : "An entire class"}
                />
              )}

              {/* ── Individual students ── all educator roles */}
              {canAssignByStudent && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={assignmentType === "forStudent"}
                      onChange={() => {
                        setAssignmentType("forStudent");
                        setSelectedClassId("");
                        setSelectedSchoolId("");
                        setParentTutorAssignee("");
                      }}
                      color="primary"
                    />
                  }
                  label={
                    isParentOrTutor
                      ? "Individual students"
                      : "Individual students from a class"
                  }
                />
              )}
            </FormGroup>
          )}

          {hasNoAssignableTargets && (
            <Box mt={2}>
              <Typography variant="caption" color="error">
                No assignable students are available for this account.
              </Typography>
            </Box>
          )}

          {/* School selector — admin picking a specific school for forSchool */}
          {assignmentType === "forSchool" && isAdmin && (
            <Box mt={2}>
              <FormControl variant="outlined" fullWidth>
                <InputLabel>Select School</InputLabel>
                <Select
                  value={selectedSchoolId}
                  onChange={(e) => setSelectedSchoolId(e.target.value)}
                  label="Select School"
                >
                  {schools.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          )}

          {/* School Admin: show their school name (no picker needed) */}
          {assignmentType === "forSchool" && isSchoolAdmin && !isAdmin && (
            <Box mt={2}>
              {(() => {
                const schoolDoc = schools.find(
                  (s) => s.id === (userData?.schoolId || ""),
                );
                return (
                  <Typography variant="caption" color="textSecondary">
                    This lesson will be assigned to all students in{" "}
                    <strong>
                      {schoolDoc?.name || userData?.schoolId || "your school"}
                    </strong>
                    .
                  </Typography>
                );
              })()}
            </Box>
          )}

          {/* forAll summary */}
          {assignmentType === "forAll" && (
            <Box mt={2}>
              <Typography variant="caption" color="textSecondary">
                This lesson will be visible to all students on the platform.
              </Typography>
            </Box>
          )}

          {/* Class selector */}
          {!isParentOrTutor &&
            (assignmentType === "forClass" ||
              assignmentType === "forStudent") && (
              <Box mt={2}>
                <FormControl variant="outlined" fullWidth>
                  <InputLabel>Select Class</InputLabel>
                  <Select
                    value={selectedClassId}
                    onChange={(e) => {
                      setSelectedClassId(e.target.value);
                      setSelectedStudentIds([]);
                    }}
                    label="Select Class"
                  >
                    {classes.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.className}
                        {isAdmin || isSchoolAdmin
                          ? ` — ${c.educatorName || c.educatorId}`
                          : ""}{" "}
                        ({Object.keys(c.students || {}).length} students)
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {classes.length === 0 && (
                  <Typography variant="caption" color="textSecondary">
                    No classes are available for your role yet.
                  </Typography>
                )}
              </Box>
            )}

          {/* Individual student picker */}
          {!isParentOrTutor &&
            assignmentType === "forStudent" &&
            selectedClassId && (
              <Box mt={2}>
                <Divider style={{ marginBottom: 12 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Pick students
                </Typography>
                {studentsInSelectedClass.length === 0 ? (
                  <Typography variant="body2" color="textSecondary">
                    No students in this class yet.
                  </Typography>
                ) : (
                  <FormGroup>
                    {studentsInSelectedClass.map((s) => (
                      <FormControlLabel
                        key={s.username}
                        control={
                          <Checkbox
                            checked={selectedStudentIds.includes(s.username)}
                            onChange={() => toggleStudent(s.username)}
                            color="primary"
                          />
                        }
                        label={s.username}
                      />
                    ))}
                  </FormGroup>
                )}
              </Box>
            )}

          {/* Class summary for forClass */}
          {!isParentOrTutor &&
            assignmentType === "forClass" &&
            selectedClass && (
              <Box mt={2}>
                <Typography variant="caption" color="textSecondary">
                  This lesson will be assigned to all{" "}
                  {studentsInSelectedClass.length} student
                  {studentsInSelectedClass.length !== 1 ? "s" : ""} in{" "}
                  <strong>{selectedClass.className}</strong>.
                </Typography>
              </Box>
            )}
        </Paper>
      )}

      {/* Save */}
      <Box display="flex" justifyContent="flex-end" style={{ gap: 12 }} mb={4}>
        <Button
          onClick={() => history.push("/custom-lessons")}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSave}
          disabled={
            saving ||
            !validated ||
            validWords.length === 0 ||
            hasNoAssignableTargets
          }
        >
          {saving ? (
            <CircularProgress size={20} />
          ) : isEditMode ? (
            "Save Changes"
          ) : (
            "Save Lesson"
          )}
        </Button>
      </Box>
    </Container>
  );
}
