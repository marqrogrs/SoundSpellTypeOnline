/**
 * StudentProgressDashboard.js
 *
 * Role-scoped student progress matrix.
 *
 * Left axis  : expandable tree  School > Educator > Class > Student
 * Right axis : columns for each lesson structured as
 *              Words Mastered | Part 1 [Lesson 1 L1 L2 L3, Lesson 2 L1 L2 L3 …] | Part 2 … (collapsible)
 *
 * Role scoping (mirrors mgmtListData on the backend):
 *   admin       – all students
 *   schoolAdmin – students at their school
 *   educator    – students in their classes
 *   parent      – their own linked students
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import firebase from "firebase/compat/app";
import { useAuth } from "../hooks/useAuth";
import { mgmtListData } from "../firebase";
import { db } from "../firebase";
import {
  INIT_PROGRESS_OBJ,
  LESSON_SECTION_OVERRIDES,
  LEVELS,
} from "../util/constants";
import { getLessonSubsection } from "../util/functions";
import { buildActiveLessonWords } from "../util/functions";
import { triggerErrorAlert } from "../util/alerts";
import PatternButton from "../components/PatternButton";
import {
  Box,
  Button,
  CircularProgress,
  Container,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@material-ui/core";
import KeyboardArrowDownIcon from "@material-ui/icons/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@material-ui/icons/KeyboardArrowRight";
import SearchIcon from "@material-ui/icons/Search";
import RefreshIcon from "@material-ui/icons/Refresh";
import ChevronLeftIcon from "@material-ui/icons/ChevronLeft";
import ChevronRightIcon from "@material-ui/icons/ChevronRight";
import { makeStyles } from "@material-ui/core/styles";

// ─── Local styles ─────────────────────────────────────────────────────────────

const useLocalStyles = makeStyles((theme) => ({
  treeLabel: {
    cursor: "pointer",
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  stickyLeft: {
    position: "sticky",
    left: 0,
    background: theme.palette.background.paper,
    zIndex: 2,
    borderRight: `1px solid ${theme.palette.divider}`,
  },
  stickyHeader: {
    position: "sticky",
    top: 0,
    background: theme.palette.background.paper,
    zIndex: 3,
    borderBottom: `2px solid ${theme.palette.divider}`,
  },
  partHeader: {
    background: theme.palette.grey[100],
    fontWeight: 700,
    textAlign: "left",
    borderLeft: `2px solid ${theme.palette.divider}`,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "normal",
    padding: "6px 8px",
  },
  partHeaderTop: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  partHeaderTopCollapsed: {
    justifyContent: "center",
    gap: 4,
  },
  collapsedPartHeaderText: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    lineHeight: 1.2,
  },
  collapsedPartHeaderLineOne: {
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  collapsedPartHeaderLineTwo: {
    fontWeight: 400,
    whiteSpace: "nowrap",
  },
  partDescriptionRow: {
    marginTop: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  partDescriptionText: {
    fontWeight: 400,
    fontSize: "0.75rem",
    color: theme.palette.text.secondary,
  },
  lessonSubHeader: {
    background: theme.palette.grey[50],
    textAlign: "center",
    whiteSpace: "normal",
    fontSize: "0.7rem",
    borderLeft: `1px solid ${theme.palette.divider}`,
    minWidth: 132,
  },
  lessonSubTitle: {
    display: "block",
    marginTop: 2,
    fontWeight: 400,
    fontSize: "0.65rem",
    color: theme.palette.text.secondary,
    whiteSpace: "nowrap",
  },
  lessonSubDescription: {
    display: "block",
    marginTop: 1,
    fontWeight: 400,
    fontSize: "0.65rem",
    color: theme.palette.text.secondary,
    whiteSpace: "nowrap",
  },
  levelSubHeader: {
    background: theme.palette.grey[50],
    textAlign: "center",
    fontSize: "0.65rem",
    color: theme.palette.text.secondary,
    padding: "2px 4px",
  },
  dataCell: {
    textAlign: "center",
    padding: "4px 8px",
    fontSize: "0.75rem",
    borderLeft: `1px solid ${theme.palette.divider}`,
    minWidth: 44,
  },
  partBorderLeft: {
    borderLeft: `2px solid ${theme.palette.divider}`,
  },
  filterBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
    alignItems: "center",
  },
  indentSchool: { paddingLeft: 8 },
  indentEducator: { paddingLeft: 24 },
  indentClass: { paddingLeft: 40 },
  indentStudent: { paddingLeft: 56 },
  rowSchool: {
    background: theme.palette.primary.main + "14",
    fontWeight: 700,
  },
  rowEducator: {
    background: theme.palette.secondary.main + "14",
    fontWeight: 600,
  },
  rowClass: {
    background: theme.palette.grey[100],
    fontWeight: 500,
    fontStyle: "italic",
  },
  rowStudent: { background: theme.palette.background.paper },
  pctHigh: { color: "#2e7d32", fontWeight: 700 },
  pctMid: { color: "#f57f17", fontWeight: 600 },
  pctLow: { color: theme.palette.text.secondary },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LEVEL_LABELS = ["L1", "L2", "L3"];
const COLLAPSED_PART_COLUMN_WIDTH_PX = 200;
const STUDENT_PROGRESS_CACHE_TTL_MS = 60 * 1000;
const STATIC_DATA_CACHE_KEY = "student-progress:static";
const STATIC_DATA_CACHE_TTL_MS = 10 * 60 * 1000;
const studentSnapshotCache = new Map();
const studentSnapshotInflight = new Map();

const getStudentProgressCacheKey = (uid, role) =>
  `student-progress:list:${uid || "anon"}:${role || "unknown"}`;

const readStudentProgressCache = (key) => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (
      Date.now() - Number(parsed.cachedAt || 0) >
      STUDENT_PROGRESS_CACHE_TTL_MS
    ) {
      return null;
    }

    return {
      schools: Array.isArray(parsed.schools) ? parsed.schools : [],
      classes: Array.isArray(parsed.classes) ? parsed.classes : [],
      users: Array.isArray(parsed.users) ? parsed.users : [],
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
      lessonSections:
        parsed.lessonSections && typeof parsed.lessonSections === "object"
          ? parsed.lessonSections
          : {},
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    };
  } catch (_err) {
    return null;
  }
};

const writeStudentProgressCache = (key, data) => {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        cachedAt: Date.now(),
        schools: Array.isArray(data?.schools) ? data.schools : [],
        classes: Array.isArray(data?.classes) ? data.classes : [],
        users: Array.isArray(data?.users) ? data.users : [],
        lessons: Array.isArray(data?.lessons) ? data.lessons : [],
        lessonSections:
          data?.lessonSections && typeof data.lessonSections === "object"
            ? data.lessonSections
            : {},
        rules: Array.isArray(data?.rules) ? data.rules : [],
      }),
    );
  } catch (_err) {
    // Best-effort cache only.
  }
};

const clearStudentProgressCache = (key) => {
  try {
    sessionStorage.removeItem(key);
  } catch (_err) {
    // Best-effort cache only.
  }
};

const readStaticDataCache = () => {
  try {
    const raw = sessionStorage.getItem(STATIC_DATA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (Date.now() - Number(parsed.cachedAt || 0) > STATIC_DATA_CACHE_TTL_MS) {
      return null;
    }
    return {
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
      lessonSections:
        parsed.lessonSections && typeof parsed.lessonSections === "object"
          ? parsed.lessonSections
          : {},
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    };
  } catch (_err) {
    return null;
  }
};

const writeStaticDataCache = (data) => {
  try {
    sessionStorage.setItem(
      STATIC_DATA_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        lessons: Array.isArray(data?.lessons) ? data.lessons : [],
        lessonSections:
          data?.lessonSections && typeof data.lessonSections === "object"
            ? data.lessonSections
            : {},
        rules: Array.isArray(data?.rules) ? data.rules : [],
      }),
    );
  } catch (_err) {
    // Best-effort cache only.
  }
};

function getStudentSnapshotCacheKey(student) {
  return String(student?.id || student?.username || "").trim();
}

function clearStudentSnapshotCache() {
  studentSnapshotCache.clear();
  studentSnapshotInflight.clear();
  try {
    sessionStorage.removeItem(STATIC_DATA_CACHE_KEY);
  } catch (_err) {
    // Best-effort.
  }
}

function pctColor(cls, pct) {
  if (pct === null || pct === undefined) return "";
  if (pct >= 90) return cls.pctHigh;
  if (pct >= 50) return cls.pctMid;
  return cls.pctLow;
}

function fmtPct(val) {
  if (val === null || val === undefined) return "—";
  return `${val}%`;
}

function getWordsTotal(lesson) {
  try {
    return buildActiveLessonWords(lesson?.words, lesson?.lesson_id).length;
  } catch {
    return (lesson?.words || []).length;
  }
}

function computeLessonProgress(lesson, userProgress) {
  const section = lesson.lesson_section;
  const sub = getLessonSubsection(lesson);
  const raw =
    userProgress[section] && userProgress[section][sub]
      ? userProgress[section][sub]
      : JSON.parse(JSON.stringify(INIT_PROGRESS_OBJ));
  return raw;
}

function levelCumulativePct(levelProgress, totalWords) {
  if (!totalWords) return null;
  const words = Array.isArray(levelProgress?.correct_words)
    ? levelProgress.correct_words
    : [];
  const unique = new Set(
    words
      .map((w) =>
        String(w || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  ).size;
  return Math.round((unique / totalWords) * 100);
}

function wordsLevelThreeMastered(userDoc) {
  const mbd = userDoc?.words_mastered_by_difficulty || {};
  const arr = mbd[3] || mbd["3"] || [];
  return Array.isArray(arr) ? arr.length : 0;
}

// Group lessons by part (lesson_section)
function groupLessonsByPart(lessons) {
  const parts = [];
  const partIndex = {};
  for (const lesson of lessons) {
    const section = String(lesson.lesson_section ?? "");
    if (!(section in partIndex)) {
      partIndex[section] = parts.length;
      const override = LESSON_SECTION_OVERRIDES[section] || {};
      parts.push({
        key: section,
        title: override.title
          ? `Part ${section} – ${override.title}`
          : `Part ${section}`,
        lessons: [],
      });
    }
    parts[partIndex[section]].lessons.push(lesson);
  }
  return parts;
}

function normalizeSectionTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getRuleParts(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { section: "", subsection: "" };
  }
  const parts = raw.split(".");
  return {
    section: parts[0] || "",
    subsection: parts[1] || "0",
  };
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getPartSectionCandidates(part) {
  const sectionKey = String(part?.key || "").trim();
  const firstLessonId = String(part?.lessons?.[0]?.lesson_id || "").trim();
  const lessonIdSectionKey = firstLessonId.split(".")[0] || "";
  const normalizedSectionKey = sectionKey.includes(".")
    ? lessonIdSectionKey
    : sectionKey || lessonIdSectionKey;

  return uniqueStrings([
    normalizedSectionKey,
    lessonIdSectionKey,
    sectionKey.split(".")[0] || "",
  ]);
}

function getSectionRulesForPart(part, rules) {
  const sectionCandidates = getPartSectionCandidates(part);
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => {
      const { section } = getRuleParts(rule?.rule_les_num);
      return sectionCandidates.includes(section);
    })
    .sort((a, b) => {
      const aParts = getRuleParts(a?.rule_les_num);
      const bParts = getRuleParts(b?.rule_les_num);
      return String(aParts.subsection).localeCompare(
        String(bParts.subsection),
        undefined,
        { numeric: true },
      );
    });
}

function getPartMeta(part, lessonSections) {
  const sectionKey = String(part?.key || "").trim();
  const sectionOverrideMeta = LESSON_SECTION_OVERRIDES[sectionKey] || {};
  const sectionKeyMeta = lessonSections?.[sectionKey] || {};
  const sectionOffsetKey = String((parseInt(sectionKey, 10) || 0) + 1);
  const sectionOffsetMeta = lessonSections?.[sectionOffsetKey] || {};
  const sectionDisplayTitle =
    sectionOverrideMeta.title || sectionKeyMeta.title || "";
  const normalizedTitle = normalizeSectionTitle(sectionDisplayTitle);
  const titleMatchedMeta = normalizedTitle
    ? Object.values(lessonSections || {}).find(
        (section) => normalizeSectionTitle(section?.title) === normalizedTitle,
      )
    : null;

  const title = sectionDisplayTitle
    ? `Part ${sectionKey} - ${sectionDisplayTitle}`
    : `Part ${sectionKey}`;

  const description =
    sectionOffsetMeta.description ||
    sectionKeyMeta.description ||
    titleMatchedMeta?.description ||
    sectionOverrideMeta.description ||
    "";

  return { title, description };
}

// ─── Cell: single level pct ──────────────────────────────────────────────────

function averagePartPct(part, userProgress, wordsTotalByLessonId) {
  const allLevelPcts = [];
  for (const lesson of part.lessons) {
    const totalWords =
      wordsTotalByLessonId?.get(lesson.lesson_id) ?? getWordsTotal(lesson);
    const lessonProgress = computeLessonProgress(lesson, userProgress);
    for (let i = 0; i < LEVELS.length; i++) {
      const pct = levelCumulativePct(lessonProgress[i] || {}, totalWords);
      if (pct !== null) allLevelPcts.push(pct);
    }
  }

  if (allLevelPcts.length === 0) return null;
  return Math.round(
    allLevelPcts.reduce((sum, pct) => sum + pct, 0) / allLevelPcts.length,
  );
}

function useStudentSnapshot(student) {
  const [userProgress, setUserProgress] = useState(null);
  const [wordsMastered, setWordsMastered] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;
    const cacheKey = getStudentSnapshotCacheKey(student);

    if (cacheKey && studentSnapshotCache.has(cacheKey)) {
      const cached = studentSnapshotCache.get(cacheKey);
      setUserProgress(cached.userProgress || {});
      setWordsMastered(cached.wordsMastered ?? 0);
      setLoading(false);
      return () => {
        isActive = false;
      };
    }

    const load = async () => {
      setLoading(true);

      const assignSnapshot = (next) => {
        if (!isActive) return;
        setUserProgress(next.userProgress || {});
        setWordsMastered(next.wordsMastered ?? 0);
        setLoading(false);
      };

      if (cacheKey && studentSnapshotInflight.has(cacheKey)) {
        try {
          const inflightResult = await studentSnapshotInflight.get(cacheKey);
          assignSnapshot(inflightResult);
        } catch {
          assignSnapshot({ userProgress: {}, wordsMastered: 0 });
        }
        return;
      }

      const fetchPromise = (async () => {
        try {
          const ref = db.collection("users").doc(student.id);
          const snap = await ref.get();

          if (snap.exists) {
            const data = snap.data();
            return {
              userProgress: data.progress || {},
              wordsMastered: wordsLevelThreeMastered(data),
            };
          }

          const querySnap = await db
            .collection("users")
            .where("username", "==", student.username || student.id)
            .limit(1)
            .get();

          const doc = querySnap.docs[0];
          if (doc) {
            const data = doc.data();
            return {
              userProgress: data.progress || {},
              wordsMastered: wordsLevelThreeMastered(data),
            };
          }

          return {
            userProgress: {},
            wordsMastered: 0,
          };
        } catch {
          return {
            userProgress: {},
            wordsMastered: 0,
          };
        }
      })();

      if (cacheKey) {
        studentSnapshotInflight.set(cacheKey, fetchPromise);
      }

      try {
        const result = await fetchPromise;
        if (cacheKey) {
          studentSnapshotCache.set(cacheKey, result);
        }
        assignSnapshot(result);
      } finally {
        if (cacheKey) {
          studentSnapshotInflight.delete(cacheKey);
        }
      }
    };

    load();

    return () => {
      isActive = false;
    };
  }, [student.id, student.username]);

  return { loading, userProgress, wordsMastered };
}

function StudentSummaryRow({
  student,
  parts,
  collapsedParts,
  wordsTotalByLessonId,
  studentOpen,
  onToggle,
  cls,
}) {
  const { loading, userProgress, wordsMastered } = useStudentSnapshot(student);
  const studentName =
    [student.firstName, student.lastName].filter(Boolean).join(" ") ||
    student.username ||
    student.id;

  return (
    <TableRow
      hover
      onClick={onToggle}
      style={{ cursor: "pointer" }}
      className={cls.rowStudent}
    >
      <TableCell
        className={`${cls.stickyLeft} ${cls.indentStudent} ${cls.rowStudent}`}
        style={{ whiteSpace: "nowrap" }}
      >
        <span className={cls.treeLabel}>
          {studentOpen ? (
            <KeyboardArrowDownIcon fontSize="small" />
          ) : (
            <KeyboardArrowRightIcon fontSize="small" />
          )}
          <Typography variant="body2">{studentName}</Typography>
        </span>
      </TableCell>

      <TableCell className={cls.dataCell} style={{ fontWeight: 600 }}>
        {loading ? <CircularProgress size={12} /> : (wordsMastered ?? "—")}
      </TableCell>

      {parts.map((part) => {
        const isCollapsed = collapsedParts[part.key];
        if (isCollapsed) {
          const avg =
            !loading && userProgress
              ? averagePartPct(part, userProgress, wordsTotalByLessonId)
              : null;

          return (
            <TableCell
              key={`summary-${student.id}-${part.key}`}
              className={`${cls.dataCell} ${cls.partBorderLeft} ${pctColor(cls, avg)}`}
              style={{
                minWidth: COLLAPSED_PART_COLUMN_WIDTH_PX,
                width: COLLAPSED_PART_COLUMN_WIDTH_PX,
              }}
            >
              {loading ? <CircularProgress size={10} /> : fmtPct(avg)}
            </TableCell>
          );
        }

        return part.lessons.map((lesson, lIdx) => {
          const totalWords =
            wordsTotalByLessonId?.get(lesson.lesson_id) ??
            getWordsTotal(lesson);
          const lessonProgress =
            userProgress && !loading
              ? computeLessonProgress(lesson, userProgress)
              : null;

          return LEVELS.map((_, lvlIdx) => {
            const pct = loading
              ? null
              : levelCumulativePct(lessonProgress?.[lvlIdx] || {}, totalWords);
            return (
              <TableCell
                key={`summary-${student.id}-${lesson.lesson_id}-${lvlIdx}`}
                className={`${cls.dataCell} ${lIdx === 0 && lvlIdx === 0 ? cls.partBorderLeft : ""}`}
              >
                {loading ? (
                  <CircularProgress size={10} />
                ) : (
                  <span className={pctColor(cls, pct)}>{fmtPct(pct)}</span>
                )}
              </TableCell>
            );
          });
        });
      })}
    </TableRow>
  );
}

// ─── Student detail row (expanded) ───────────────────────────────────────────

function StudentDetailRow({
  student,
  parts,
  collapsedParts,
  wordsTotalByLessonId,
  cls,
}) {
  const { loading, userProgress, wordsMastered } = useStudentSnapshot(student);

  const studentName =
    [student.firstName, student.lastName].filter(Boolean).join(" ") ||
    student.username ||
    student.id;

  return (
    <TableRow>
      {/* Name cell – sticky */}
      <TableCell
        className={`${cls.stickyLeft} ${cls.indentStudent} ${cls.rowStudent}`}
        style={{ whiteSpace: "nowrap" }}
      >
        <Typography variant="body2" style={{ fontWeight: 500 }}>
          {studentName}
        </Typography>
      </TableCell>

      {/* Words Mastered */}
      <TableCell className={cls.dataCell} style={{ fontWeight: 600 }}>
        {loading ? <CircularProgress size={12} /> : (wordsMastered ?? "—")}
      </TableCell>

      {/* Per-part, per-lesson, per-level cells */}
      {parts.map((part) => {
        const isCollapsed = collapsedParts[part.key];
        if (isCollapsed) {
          const avg =
            !loading && userProgress
              ? averagePartPct(part, userProgress, wordsTotalByLessonId)
              : null;
          return (
            <TableCell
              key={part.key}
              className={`${cls.dataCell} ${cls.partBorderLeft} ${pctColor(cls, avg)}`}
              style={{
                minWidth: COLLAPSED_PART_COLUMN_WIDTH_PX,
                width: COLLAPSED_PART_COLUMN_WIDTH_PX,
              }}
            >
              {loading ? <CircularProgress size={10} /> : fmtPct(avg)}
            </TableCell>
          );
        }

        return part.lessons.map((lesson, lIdx) => {
          const totalWords =
            wordsTotalByLessonId?.get(lesson.lesson_id) ??
            getWordsTotal(lesson);
          const lessonProgress =
            userProgress && !loading
              ? computeLessonProgress(lesson, userProgress)
              : null;

          return LEVELS.map((_, lvlIdx) => {
            const pct = loading
              ? null
              : levelCumulativePct(lessonProgress?.[lvlIdx] || {}, totalWords);
            return (
              <TableCell
                key={`${lesson.lesson_id}-${lvlIdx}`}
                className={`${cls.dataCell} ${lIdx === 0 && lvlIdx === 0 ? cls.partBorderLeft : ""}`}
              >
                {loading ? (
                  <CircularProgress size={10} />
                ) : (
                  <span className={pctColor(cls, pct)}>{fmtPct(pct)}</span>
                )}
              </TableCell>
            );
          });
        });
      })}
    </TableRow>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StudentProgressDashboard() {
  const auth = useAuth();
  const cls = useLocalStyles();

  // ── Data from backend ──
  const [loading, setLoading] = useState(false);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessons, setLessons] = useState([]);
  const [lessonSections, setLessonSections] = useState({});
  const [rules, setRules] = useState([]);
  const [schools, setSchools] = useState([]);
  const [classes, setClasses] = useState([]);
  const [users, setUsers] = useState([]);

  // ── Filter state ──
  const [filterSchool, setFilterSchool] = useState("");
  const [filterEducator, setFilterEducator] = useState("");
  const [filterClass, setFilterClass] = useState("");
  // Raw value bound to the input; debounced value drives the tree filter.
  const [filterStudentInput, setFilterStudentInput] = useState("");
  const [filterStudent, setFilterStudent] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setFilterStudent(filterStudentInput), 200);
    return () => clearTimeout(id);
  }, [filterStudentInput]);

  // ── Tree open/close state ──
  const [openSchools, setOpenSchools] = useState({});
  const [openEducators, setOpenEducators] = useState({});
  const [openClasses, setOpenClasses] = useState({});
  const [openStudents, setOpenStudents] = useState({});

  // ── Collapsible columns per part ──
  const [collapsedParts, setCollapsedParts] = useState({});

  const loadData = useCallback(
    async ({ force = false } = {}) => {
      const cacheKey = getStudentProgressCacheKey(auth.user?.uid, auth.role);
      const cached = force ? null : readStudentProgressCache(cacheKey);
      const cachedStaticForCheck = force ? null : readStaticDataCache();
      // When both caches are warm we can render immediately and revalidate
      // silently — no loading spinners at all.
      const fullyFromCache = !!(cached && cachedStaticForCheck);

      if (cached) {
        setSchools(cached.schools);
        setClasses(cached.classes);
        setUsers(cached.users);
        setLessons(cached.lessons);
        setLessonSections(cached.lessonSections);
        setRules(cached.rules);
        setLoading(false);
      } else {
        setLoading(true);
      }

      if (!fullyFromCache) {
        setLessonsLoading(true);
      }
      try {
        // Lessons, lessonSections, and rules are global/static data — cache
        // them independently under a longer-lived key so revisits only need
        // to call mgmtListData (user-scoped) and skip the 3 collection reads.
        const cachedStatic = cachedStaticForCheck;

        let lessonData, nextLessonSections, nextRules;

        if (cachedStatic) {
          lessonData = cachedStatic.lessons;
          nextLessonSections = cachedStatic.lessonSections;
          nextRules = cachedStatic.rules;
        }

        const [result, lessonDocs, lessonSectionsSnap, rulesSnap] =
          await Promise.all([
            mgmtListData({}),
            cachedStatic
              ? Promise.resolve(null)
              : db.collection("lessons").get(),
            cachedStatic
              ? Promise.resolve(null)
              : db.collection("lessonSections").get(),
            cachedStatic ? Promise.resolve(null) : db.collection("rules").get(),
          ]);
        const d = result?.data || {};

        if (!cachedStatic) {
          lessonData = lessonDocs.docs
            .map((doc) => {
              const data = doc.data() || {};
              return {
                ...data,
                lesson_id:
                  data.lesson_id !== undefined && data.lesson_id !== null
                    ? String(data.lesson_id)
                    : String(doc.id),
              };
            })
            .sort((a, b) =>
              String(a.lesson_id).localeCompare(
                String(b.lesson_id),
                undefined,
                { numeric: true, sensitivity: "base" },
              ),
            );
          nextLessonSections = lessonSectionsSnap.docs.reduce((acc, doc) => {
            const data = doc.data() || {};
            const key = String(doc.id || "").trim();
            if (!key) return acc;

            const title = (
              typeof data.title === "string" ? data.title : ""
            ).trim();
            const description = (
              typeof data.description === "string" ? data.description : ""
            ).trim();

            acc[key] = { title, description };

            const numericKey = Number(key);
            if (Number.isFinite(numericKey) && numericKey > 1) {
              const aliasKey = String(numericKey - 1);
              if (!acc[aliasKey]?.description) {
                acc[aliasKey] = { title, description };
              }
            }

            return acc;
          }, {});
          nextRules = rulesSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          writeStaticDataCache({
            lessons: lessonData,
            lessonSections: nextLessonSections,
            rules: nextRules,
          });
        }

        const payload = {
          schools: Array.isArray(d.schools) ? d.schools : [],
          classes: Array.isArray(d.classes) ? d.classes : [],
          users: Array.isArray(d.users) ? d.users : [],
          lessons: lessonData,
          lessonSections: nextLessonSections,
          rules: nextRules,
        };

        // Batch-prefetch student progress docs so every row renders with data
        // immediately instead of each firing its own individual Firestore read.
        const studentIdsToFetch = payload.users
          .filter((u) => (u.role || "").toLowerCase() === "student")
          .map((u) => String(u.id || "").trim())
          .filter((id) => id && !studentSnapshotCache.has(id));

        if (studentIdsToFetch.length > 0) {
          const BATCH_SIZE = 30;
          const idChunks = [];
          for (let i = 0; i < studentIdsToFetch.length; i += BATCH_SIZE) {
            idChunks.push(studentIdsToFetch.slice(i, i + BATCH_SIZE));
          }
          await Promise.all(
            idChunks.map(async (ids) => {
              try {
                const snap = await db
                  .collection("users")
                  .where(firebase.firestore.FieldPath.documentId(), "in", ids)
                  .get();
                snap.docs.forEach((doc) => {
                  const key = doc.id;
                  if (key && !studentSnapshotCache.has(key)) {
                    const data = doc.data();
                    studentSnapshotCache.set(key, {
                      userProgress: data.progress || {},
                      wordsMastered: wordsLevelThreeMastered(data),
                    });
                  }
                });
              } catch {
                // Best-effort prefetch; rows will fall back to their own fetch.
              }
            }),
          );
        }

        setSchools(payload.schools);
        setClasses(payload.classes);
        setUsers(payload.users);
        setLessons(payload.lessons);
        setLessonSections(payload.lessonSections);
        setRules(payload.rules);
        writeStudentProgressCache(cacheKey, payload);
      } catch (err) {
        triggerErrorAlert(
          err?.message || "Could not load student progress data.",
        );
        setLessons([]);
        setLessonSections({});
        setRules([]);
      } finally {
        setLoading(false);
        setLessonsLoading(false);
      }
    },
    [auth.user?.uid, auth.role],
  );

  useEffect(() => {
    if (auth.user) loadData();
  }, [auth.user, loadData]);

  // ── Lesson structure ──
  const parts = useMemo(() => groupLessonsByPart(lessons || []), [lessons]);

  // Pre-compute per-lesson word totals once so row renders don't call
  // buildActiveLessonWords repeatedly for every student × lesson × level.
  const wordsTotalByLessonId = useMemo(() => {
    const map = new Map();
    for (const lesson of lessons || []) {
      map.set(lesson.lesson_id, getWordsTotal(lesson));
    }
    return map;
  }, [lessons]);

  useEffect(() => {
    if (!parts.length) return;

    setCollapsedParts((prev) => {
      const next = { ...prev };
      let changed = false;

      parts.forEach((part) => {
        if (!(part.key in next)) {
          next[part.key] = false;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [parts]);

  // ── Build scoped tree ──
  // students
  const students = useMemo(
    () => users.filter((u) => u.role === "student"),
    [users],
  );

  const educators = useMemo(
    () => users.filter((u) => u.role === "educator"),
    [users],
  );

  // Map class → school
  const classById = useMemo(() => {
    const m = {};
    classes.forEach((c) => (m[c.id] = c));
    return m;
  }, [classes]);

  // Map school id → school
  const schoolById = useMemo(() => {
    const m = {};
    schools.forEach((s) => (m[s.id] = s));
    return m;
  }, [schools]);

  // ── Filter helpers ──
  const matchesFilter = useCallback(
    (student) => {
      const name =
        [student.firstName, student.lastName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase() + (student.username || student.id || "").toLowerCase();

      if (filterStudent && !name.includes(filterStudent.toLowerCase()))
        return false;

      if (filterSchool) {
        const sid = student.schoolId || student.homeSchoolId || "";
        if (sid !== filterSchool) return false;
      }

      if (filterEducator) {
        const hasClass = (student.classIds || []).some((cid) => {
          const c = classById[cid];
          return c && c.educatorId === filterEducator;
        });
        if (!hasClass) return false;
      }

      if (filterClass) {
        if (!(student.classIds || []).includes(filterClass)) return false;
      }

      return true;
    },
    [filterStudent, filterSchool, filterEducator, filterClass, classById],
  );

  // ── Build the tree rows ──
  // Structure: school -> (educators per school) -> (classes per educator) -> (students per class)
  // For students without a class, they appear under their educator's "Unclassed" group.
  const tree = useMemo(() => {
    // Filter students first
    const filteredStudents = students.filter(matchesFilter);

    // Build a set of schools referenced
    const schoolIds = new Set(
      filteredStudents.map(
        (s) => s.schoolId || s.homeSchoolId || "__no_school__",
      ),
    );

    const schoolNodes = [];

    for (const schoolId of schoolIds) {
      const school = schoolById[schoolId] || {
        id: schoolId,
        name: schoolId === "__no_school__" ? "Unassigned" : schoolId,
      };

      // Skip if school filter is set and doesn't match
      if (filterSchool && schoolId !== filterSchool) continue;

      const schoolStudents = filteredStudents.filter(
        (s) => (s.schoolId || s.homeSchoolId || "__no_school__") === schoolId,
      );
      if (schoolStudents.length === 0) continue;

      // Find educators for this school
      const schoolEducatorIds = new Set();
      schoolStudents.forEach((s) => {
        // Try to derive educator from class membership
        let foundViaClass = false;
        (s.classIds || []).forEach((cid) => {
          const c = classById[cid];
          if (c && (c.schoolId === schoolId || c.schoolType === "home")) {
            if (c.educatorId) {
              schoolEducatorIds.add(c.educatorId);
              foundViaClass = true;
            }
          }
        });
        // Only fall back to legacy educator field when no class-based educator found
        if (!foundViaClass && s.educator) schoolEducatorIds.add(s.educator);
      });

      if (schoolEducatorIds.size === 0)
        schoolEducatorIds.add("__no_educator__");

      const educatorNodes = [];

      for (const educatorId of schoolEducatorIds) {
        if (filterEducator && educatorId !== filterEducator) continue;

        const educatorUser = educators.find((e) => e.id === educatorId);
        const educatorName = educatorUser
          ? [educatorUser.firstName, educatorUser.lastName]
              .filter(Boolean)
              .join(" ") ||
            educatorUser.email ||
            educatorId
          : educatorId === "__no_educator__"
            ? "Unassigned Educator"
            : educatorId;

        // Gather classes this educator has in this school
        const educatorClassIds = new Set();
        schoolStudents.forEach((s) => {
          (s.classIds || []).forEach((cid) => {
            const c = classById[cid];
            if (!c) return;
            const cSchoolId = c.schoolId;
            const matchSchool =
              cSchoolId === schoolId || c.schoolType === "home";
            const matchEducator =
              educatorId === "__no_educator__"
                ? !c.educatorId
                : c.educatorId === educatorId;
            if (matchSchool && matchEducator) educatorClassIds.add(cid);
          });
        });

        if (educatorClassIds.size === 0) educatorClassIds.add("__no_class__");

        const classNodes = [];

        for (const classId of educatorClassIds) {
          if (filterClass && classId !== filterClass) continue;

          const classObj = classById[classId] || {
            id: classId,
            name: classId === "__no_class__" ? "Unclassed" : classId,
          };
          const className =
            classObj.name ||
            (classId === "__no_class__" ? "Unclassed" : classId);

          // Students in this class under this educator
          const classStudents = schoolStudents
            .filter((s) => {
              if (classId === "__no_class__") {
                // Only include students with no classIds (or whose only educator ref is legacy)
                return (s.classIds || []).length === 0;
              }
              return (s.classIds || []).includes(classId);
            })
            .sort((a, b) => {
              const na =
                [a.firstName, a.lastName].filter(Boolean).join(" ") ||
                a.username ||
                "";
              const nb =
                [b.firstName, b.lastName].filter(Boolean).join(" ") ||
                b.username ||
                "";
              return na.localeCompare(nb);
            });

          if (classStudents.length === 0) continue;
          classNodes.push({ classId, className, students: classStudents });
        }

        if (classNodes.length === 0) continue;
        educatorNodes.push({ educatorId, educatorName, classes: classNodes });
      }

      if (educatorNodes.length === 0) continue;
      schoolNodes.push({
        schoolId,
        schoolName: school.name || schoolId,
        educators: educatorNodes,
      });
    }

    return schoolNodes;
  }, [
    students,
    matchesFilter,
    schoolById,
    classById,
    educators,
    filterSchool,
    filterEducator,
    filterClass,
  ]);

  // ── Column structure for header ──
  const togglePart = (partKey) =>
    setCollapsedParts((prev) => ({ ...prev, [partKey]: !prev[partKey] }));

  // ── Unique filter options ──
  const schoolOptions = useMemo(
    () => schools.filter((s) => s.type !== "home"),
    [schools],
  );
  const educatorOptions = useMemo(() => educators, [educators]);
  const classOptions = useMemo(
    () => classes.filter((c) => c.schoolType !== "home"),
    [classes],
  );

  // ── Expand/collapse all ──
  const expandAll = () => {
    const so = {},
      eo = {},
      co = {};
    const expandedParts = {};

    tree.forEach((sn) => {
      so[sn.schoolId] = true;
      sn.educators.forEach((en) => {
        eo[en.educatorId] = true;
        en.classes.forEach((cn) => {
          co[cn.classId] = true;
        });
      });
    });

    parts.forEach((part) => {
      expandedParts[part.key] = false;
    });

    setOpenSchools(so);
    setOpenEducators(eo);
    setOpenClasses(co);
    setCollapsedParts(expandedParts);
  };

  const collapseAll = () => {
    const collapsed = {};

    parts.forEach((part) => {
      collapsed[part.key] = true;
    });

    setOpenSchools({});
    setOpenEducators({});
    setOpenClasses({});
    setOpenStudents({});
    setCollapsedParts(collapsed);
  };

  // ── Render header rows ──
  const renderHeaderRows = () => {
    // Row 1: Words Mastered | Part 1 (span) | Part 2 (span) | …
    // Row 2: (blank)        | Lesson 1 (span L1/L2/L3) | Lesson 2 (span) | …
    // Row 3: (blank)        | L1 | L2 | L3 | L1 | L2 | L3 | …

    return (
      <>
        {/* Row 1 – part-level headers */}
        <TableRow>
          <TableCell
            className={`${cls.stickyLeft} ${cls.stickyHeader}`}
            rowSpan={3}
            style={{ minWidth: 220, fontWeight: 700 }}
          >
            Student
          </TableCell>
          <TableCell
            className={`${cls.stickyHeader} ${cls.dataCell}`}
            rowSpan={3}
            style={{ fontWeight: 700, minWidth: 70, whiteSpace: "nowrap" }}
          >
            Words
            <br />
            Mastered
          </TableCell>
          {parts.map((part) => {
            const isCollapsed = collapsedParts[part.key];
            const colSpan = isCollapsed
              ? 1
              : part.lessons.length * LEVELS.length;
            const partMeta = getPartMeta(part, lessonSections);
            const sectionRules = getSectionRulesForPart(part, rules);
            const sectionLabel =
              String(partMeta.title || "")
                .split(" - ")
                .slice(1)
                .join(" - ") || "Part";
            return (
              <TableCell
                key={part.key}
                colSpan={colSpan}
                className={`${cls.stickyHeader} ${cls.partHeader} ${cls.partBorderLeft}`}
                onClick={() => togglePart(part.key)}
                style={
                  isCollapsed
                    ? {
                        minWidth: COLLAPSED_PART_COLUMN_WIDTH_PX,
                        width: COLLAPSED_PART_COLUMN_WIDTH_PX,
                      }
                    : undefined
                }
              >
                <div
                  className={`${cls.partHeaderTop} ${isCollapsed ? cls.partHeaderTopCollapsed : ""}`}
                >
                  {isCollapsed ? (
                    <ChevronRightIcon fontSize="small" />
                  ) : (
                    <ChevronLeftIcon fontSize="small" />
                  )}
                  {isCollapsed ? (
                    <span className={cls.collapsedPartHeaderText}>
                      <span className={cls.collapsedPartHeaderLineOne}>
                        {`Part ${part.key} -`}
                      </span>
                      <span className={cls.collapsedPartHeaderLineTwo}>
                        {sectionLabel}
                      </span>
                    </span>
                  ) : (
                    <span>{partMeta.title}</span>
                  )}
                </div>
                {!isCollapsed &&
                (partMeta.description || sectionRules.length > 0) ? (
                  <div className={cls.partDescriptionRow}>
                    <span className={cls.partDescriptionText}>
                      {partMeta.description}
                    </span>
                    {sectionRules.length > 0 ? (
                      <PatternButton
                        rules={sectionRules}
                        size="small"
                        buttonStyle={{
                          fontSize: "0.6875rem",
                          padding: "2px 8px",
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
              </TableCell>
            );
          })}
        </TableRow>

        {/* Row 2 – lesson-level headers */}
        <TableRow>
          {parts.map((part) => {
            const isCollapsed = collapsedParts[part.key];
            if (isCollapsed) return null; // rowspan from row 1 covers this
            const partMeta = getPartMeta(part, lessonSections);
            const sectionLabel =
              String(partMeta.title || "")
                .split(" - ")
                .slice(1)
                .join(" - ") || `Part ${part.key}`;

            return part.lessons.map((lesson, lIdx) => {
              const subsection = getLessonSubsection(lesson);
              const lessonTailRaw = String(
                lesson.description || lesson.title || "",
              ).trim();
              const lineTwoText = `${sectionLabel} ${subsection}.`;
              const lessonTail = lessonTailRaw
                .replace(
                  new RegExp(
                    `^${lineTwoText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-:]?\\s*`,
                    "i",
                  ),
                  "",
                )
                .trim();

              return (
                <TableCell
                  key={lesson.lesson_id}
                  colSpan={LEVELS.length}
                  className={`${cls.stickyHeader} ${cls.lessonSubHeader} ${lIdx === 0 ? cls.partBorderLeft : ""}`}
                >
                  <span>{`Lesson ${lesson.lesson_id}`}</span>
                  <span
                    className={cls.lessonSubTitle}
                  >{`${sectionLabel} ${subsection}.`}</span>
                  <span className={cls.lessonSubDescription}>
                    {lessonTail || "\u00A0"}
                  </span>
                </TableCell>
              );
            });
          })}
        </TableRow>

        {/* Row 3 – level headers */}
        <TableRow>
          {parts.map((part) => {
            const isCollapsed = collapsedParts[part.key];
            if (isCollapsed) return null;
            return part.lessons.map((lesson, lIdx) =>
              LEVELS.map((_, lvlIdx) => (
                <TableCell
                  key={`${lesson.lesson_id}-${lvlIdx}`}
                  className={`${cls.stickyHeader} ${cls.levelSubHeader} ${lIdx === 0 && lvlIdx === 0 ? cls.partBorderLeft : ""}`}
                >
                  {LEVEL_LABELS[lvlIdx]}
                </TableCell>
              )),
            );
          })}
        </TableRow>
      </>
    );
  };

  // ── Render tree rows ──
  const renderTree = () => {
    if (tree.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={999} align="center" style={{ padding: 32 }}>
            <Typography color="textSecondary">
              {loading ? "Loading…" : "No students found."}
            </Typography>
          </TableCell>
        </TableRow>
      );
    }

    const rows = [];

    tree.forEach((schoolNode) => {
      const schoolOpen = openSchools[schoolNode.schoolId] !== false; // default open

      // School row
      rows.push(
        <TableRow
          key={`school-${schoolNode.schoolId}`}
          className={cls.rowSchool}
        >
          <TableCell
            className={`${cls.stickyLeft} ${cls.indentSchool} ${cls.rowSchool}`}
            style={{ whiteSpace: "nowrap" }}
            colSpan={1}
          >
            <span
              className={cls.treeLabel}
              onClick={() =>
                setOpenSchools((p) => ({
                  ...p,
                  [schoolNode.schoolId]: !schoolOpen,
                }))
              }
            >
              {schoolOpen ? (
                <KeyboardArrowDownIcon fontSize="small" />
              ) : (
                <KeyboardArrowRightIcon fontSize="small" />
              )}
              <Typography variant="body2" style={{ fontWeight: 700 }}>
                🏫 {schoolNode.schoolName}
              </Typography>
            </span>
          </TableCell>
          {/* Blank data cells so the row spans the full table width */}
          <TableCell colSpan={999} className={cls.rowSchool} />
        </TableRow>,
      );

      if (!schoolOpen) return;

      schoolNode.educators.forEach((educatorNode) => {
        const educatorOpen = openEducators[educatorNode.educatorId] !== false;

        rows.push(
          <TableRow
            key={`educator-${schoolNode.schoolId}-${educatorNode.educatorId}`}
            className={cls.rowEducator}
          >
            <TableCell
              className={`${cls.stickyLeft} ${cls.indentEducator} ${cls.rowEducator}`}
              style={{ whiteSpace: "nowrap" }}
            >
              <span
                className={cls.treeLabel}
                onClick={() =>
                  setOpenEducators((p) => ({
                    ...p,
                    [educatorNode.educatorId]: !educatorOpen,
                  }))
                }
              >
                {educatorOpen ? (
                  <KeyboardArrowDownIcon fontSize="small" />
                ) : (
                  <KeyboardArrowRightIcon fontSize="small" />
                )}
                <Typography variant="body2" style={{ fontWeight: 600 }}>
                  👤 {educatorNode.educatorName}
                </Typography>
              </span>
            </TableCell>
            <TableCell colSpan={999} className={cls.rowEducator} />
          </TableRow>,
        );

        if (!educatorOpen) return;

        educatorNode.classes.forEach((classNode) => {
          const classOpen = openClasses[classNode.classId] !== false;

          rows.push(
            <TableRow
              key={`class-${schoolNode.schoolId}-${educatorNode.educatorId}-${classNode.classId}`}
              className={cls.rowClass}
            >
              <TableCell
                className={`${cls.stickyLeft} ${cls.indentClass} ${cls.rowClass}`}
                style={{ whiteSpace: "nowrap" }}
              >
                <span
                  className={cls.treeLabel}
                  onClick={() =>
                    setOpenClasses((p) => ({
                      ...p,
                      [classNode.classId]: !classOpen,
                    }))
                  }
                >
                  {classOpen ? (
                    <KeyboardArrowDownIcon fontSize="small" />
                  ) : (
                    <KeyboardArrowRightIcon fontSize="small" />
                  )}
                  <Typography variant="body2" style={{ fontStyle: "italic" }}>
                    📚 {classNode.className}
                  </Typography>
                </span>
              </TableCell>
              <TableCell colSpan={999} className={cls.rowClass} />
            </TableRow>,
          );

          if (!classOpen) return;

          classNode.students.forEach((student) => {
            const studentKey = `student-${student.id}`;
            const studentOpen = openStudents[student.id] === true;

            rows.push(
              <StudentSummaryRow
                key={`${studentKey}-summary`}
                student={student}
                parts={parts}
                collapsedParts={collapsedParts}
                wordsTotalByLessonId={wordsTotalByLessonId}
                studentOpen={studentOpen}
                onToggle={() =>
                  setOpenStudents((p) => ({
                    ...p,
                    [student.id]: !studentOpen,
                  }))
                }
                cls={cls}
              />,
            );

            // Expanded detail row
            if (studentOpen) {
              rows.push(
                <StudentDetailRow
                  key={`${studentKey}-detail`}
                  student={student}
                  parts={parts}
                  collapsedParts={collapsedParts}
                  wordsTotalByLessonId={wordsTotalByLessonId}
                  cls={cls}
                />,
              );
            }
          });
        });
      });
    });

    return rows;
  };

  return (
    <Container maxWidth={false} style={{ marginTop: 24, marginBottom: 40 }}>
      {/* Page header */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h5">Student Progress</Typography>
        <Button
          startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={() => {
            const cacheKey = getStudentProgressCacheKey(
              auth.user?.uid,
              auth.role,
            );
            clearStudentProgressCache(cacheKey);
            clearStudentSnapshotCache();
            loadData({ force: true });
          }}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {/* Filter bar */}
      <Box className={cls.filterBar}>
        {/* School filter */}
        {schoolOptions.length > 0 && (
          <TextField
            select
            label="School"
            size="small"
            variant="outlined"
            value={filterSchool}
            onChange={(e) => setFilterSchool(e.target.value)}
            style={{ minWidth: 160 }}
            InputLabelProps={{ shrink: true }}
            SelectProps={{ native: true }}
          >
            <option value="">All Schools</option>
            {schoolOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </TextField>
        )}

        {/* Educator filter */}
        {educatorOptions.length > 0 && (
          <TextField
            select
            label="Educator"
            size="small"
            variant="outlined"
            value={filterEducator}
            onChange={(e) => setFilterEducator(e.target.value)}
            style={{ minWidth: 180 }}
            InputLabelProps={{ shrink: true }}
            SelectProps={{ native: true }}
          >
            <option value="">All Educators</option>
            {educatorOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {[e.firstName, e.lastName].filter(Boolean).join(" ") ||
                  e.email ||
                  e.id}
              </option>
            ))}
          </TextField>
        )}

        {/* Class filter */}
        {classOptions.length > 0 && (
          <TextField
            select
            label="Class"
            size="small"
            variant="outlined"
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            style={{ minWidth: 160 }}
            InputLabelProps={{ shrink: true }}
            SelectProps={{ native: true }}
          >
            <option value="">All Classes</option>
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </TextField>
        )}

        {/* Student search */}
        <TextField
          label="Search student"
          size="small"
          variant="outlined"
          value={filterStudentInput}
          onChange={(e) => setFilterStudentInput(e.target.value)}
          style={{ minWidth: 200 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />

        {/* Expand / collapse all */}
        <Box style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Button size="small" variant="outlined" onClick={expandAll}>
            Expand All
          </Button>
          <Button size="small" variant="outlined" onClick={collapseAll}>
            Collapse All
          </Button>
        </Box>
      </Box>

      {/* Hint about collapsible part columns */}
      <Typography
        variant="caption"
        color="textSecondary"
        style={{ marginBottom: 8, display: "block" }}
      >
        Click a Part header to collapse or expand its lesson columns. Click a
        student row to open full detail.
      </Typography>

      {/* Progress table */}
      <TableContainer
        component={Paper}
        style={{ maxHeight: "calc(100vh - 280px)", overflow: "auto" }}
      >
        <Table
          size="small"
          stickyHeader
          style={{ tableLayout: "auto", minWidth: 600 }}
        >
          <TableHead>{renderHeaderRows()}</TableHead>
          <TableBody>
            {loading || lessonsLoading ? (
              <TableRow>
                <TableCell colSpan={999} align="center" style={{ padding: 48 }}>
                  <CircularProgress />
                </TableCell>
              </TableRow>
            ) : (
              renderTree()
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Container>
  );
}
