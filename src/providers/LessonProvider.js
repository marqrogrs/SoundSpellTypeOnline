import React, {
  useState,
  useEffect,
  useContext,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import firebase from "../firebase";
import { db } from "../firebase";
import { UserContext } from "./UserProvider";
import { getLessonSubsection, buildActiveLessonWords } from "../util/functions";
import { getCurrentPerfSessionId, setPerfMetric } from "../util/perfSession";
import sortBy from "lodash/sortBy";

const LessonContext = React.createContext({});
const CUSTOM_LESSON_PREFIX = "custom:";
const CUSTOM_LESSON_PROGRESS_COLLECTION = "customLessonProgress";
const LESSON_STATIC_CACHE_KEY = "lesson-provider:static-data";
const LESSON_STATIC_CACHE_TTL_MS = 10 * 60 * 1000;
const STREAK_SAVE_REFILL_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const toLocalDayKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDayKey = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const parts = raw.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [year, month, day] = parts;
  return { year, month, day };
};

const diffDayKeys = (laterDayKey, earlierDayKey) => {
  const later = parseDayKey(laterDayKey);
  const earlier = parseDayKey(earlierDayKey);
  if (!later || !earlier) {
    return null;
  }

  const laterTime = Date.UTC(later.year, later.month - 1, later.day);
  const earlierTime = Date.UTC(earlier.year, earlier.month - 1, earlier.day);
  return Math.round((laterTime - earlierTime) / MS_PER_DAY);
};

const normalizeDayKey = (value) => {
  const parsed = parseDayKey(value);
  return parsed
    ? toLocalDayKey(new Date(parsed.year, parsed.month - 1, parsed.day))
    : "";
};

const readLessonStaticCache = () => {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return null;
    }

    const raw = window.sessionStorage.getItem(LESSON_STATIC_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      Date.now() - Number(parsed.cachedAt || 0) > LESSON_STATIC_CACHE_TTL_MS
    ) {
      window.sessionStorage.removeItem(LESSON_STATIC_CACHE_KEY);
      return null;
    }

    if (
      !Array.isArray(parsed.lessons) ||
      !parsed.lessonSections ||
      typeof parsed.lessonSections !== "object" ||
      !Array.isArray(parsed.rules)
    ) {
      return null;
    }

    return {
      lessons: parsed.lessons,
      lessonSections: parsed.lessonSections,
      rules: parsed.rules,
    };
  } catch (_error) {
    return null;
  }
};

const writeLessonStaticCache = (data) => {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return;
    }

    window.sessionStorage.setItem(
      LESSON_STATIC_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        lessons: data.lessons,
        lessonSections: data.lessonSections,
        rules: data.rules,
      }),
    );
  } catch (_error) {
    // Best-effort cache only.
  }
};

const LessonProvider = ({ children }) => {
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const [lessons, setLessons] = useState([]);
  const [lessonSectionsLoading, setLessonSectionsLoading] = useState(true);
  const [lessonSections, setLessonSections] = useState({});
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const rulesRef = useRef([]);
  const { userData, registerMasteredWord } = useContext(UserContext);
  const userDataRef = useRef(userData);
  const location = useLocation();
  const loadedLessonDataUserIdRef = useRef(null);
  useEffect(() => {
    userDataRef.current = userData;
  }, [userData]);
  const { user, isEducator, isAdmin, isSchoolAdmin, authLoaded, role } =
    useAuth();

  const [currentLesson, setCurrentLesson] = useState();
  const [currentLessonProgress, setCurrentLessonProgress] = useState();
  const [currentLessonLevel, setCurrentLessonLevel] = useState();
  const [currentLessonLoading, setCurrentLessonLoading] = useState(false);

  const shouldLoadLessonData = useMemo(() => {
    const pathname = String(location?.pathname || "");
    if (pathname.startsWith("/lessons")) return true;
    if (pathname.startsWith("/progress")) return true;
    if (pathname.startsWith("/student-progress")) return true;
    if (pathname.startsWith("/students")) return true;
    if (pathname.startsWith("/create-lesson")) return true;
    if (pathname.startsWith("/custom-lessons")) return true;
    if (pathname.startsWith("/create-custom-lesson")) return true;

    // Home renders progress for students/educators, but not for admin roles.
    if (pathname === "/" && !(isAdmin || isSchoolAdmin)) {
      return true;
    }

    return false;
  }, [location?.pathname, isAdmin, isSchoolAdmin]);

  const loadRules = useCallback((source = "default") => {
    if (source !== "force" && rulesRef.current.length > 0) {
      return Promise.resolve(rulesRef.current);
    }
    const startedAt = nowMs();
    setRulesLoading(true);
    return db
      .collection("rules")
      .get()
      .then((snap) => {
        const rulesData = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setRules(rulesData);
        rulesRef.current = rulesData;
        setRulesLoading(false);
        console.info("[perf] lessonProvider.rulesLoaded", {
          source,
          count: rulesData.length,
          ms: Math.round(nowMs() - startedAt),
        });
        return rulesData;
      })
      .catch((error) => {
        console.error("Failed to load rules:", error.code, error.message);
        setRulesLoading(false);
        console.info("[perf] lessonProvider.rulesLoadFailed", {
          source,
          ms: Math.round(nowMs() - startedAt),
          code: error?.code || "unknown",
        });
        return null;
      });
  }, []);

  const cloneProgress = useCallback((progress = {}) => {
    return Object.keys(progress).reduce((acc, key) => {
      acc[key] = { ...progress[key] };
      return acc;
    }, {});
  }, []);

  const normalizeLessonId = useCallback((value) => {
    const rawValue = String(value ?? "").trim();
    const decodedValue = decodeURIComponent(rawValue);
    return decodedValue.includes("/")
      ? decodedValue.split("/").filter(Boolean).pop()
      : decodedValue;
  }, []);

  const hydrateLessonDoc = useCallback((doc) => {
    const data = doc?.data ? doc.data() || {} : {};
    return {
      ...data,
      lesson_id:
        data.lesson_id !== undefined && data.lesson_id !== null
          ? String(data.lesson_id)
          : String(doc?.id ?? ""),
    };
  }, []);

  const applyLessonSelection = useCallback(
    (selectedLesson) => {
      const normalizedLessonId = String(selectedLesson.lesson_id ?? "").trim();
      const normalizedLesson = {
        ...selectedLesson,
        lesson_id: normalizedLessonId,
        words: buildActiveLessonWords(selectedLesson.words, normalizedLessonId),
      };

      const lesson_section = String(normalizedLesson.lesson_section ?? "");
      const totalWords = Array.isArray(normalizedLesson.words)
        ? normalizedLesson.words.length
        : 0;

      const defaultLevelProgress = () => ({
        score: 0,
        completed_words: 0,
        high_score: 0,
        correct_words: [],
        completed: false,
      });

      const initProgress = {
        0: defaultLevelProgress(),
        1: defaultLevelProgress(),
        2: defaultLevelProgress(),
      };

      const normalizeProgress = (rawProgress = {}) => {
        const normalized = cloneProgress(initProgress);

        [0, 1, 2].forEach((idx) => {
          const incoming = rawProgress[idx] || rawProgress[String(idx)] || {};
          const pointsPerCorrectWord = (idx + 1) * 5;
          const legacyMaxLevelScore = totalWords * pointsPerCorrectWord;
          const incomingScore = Number(incoming.score) || 0;
          const incomingHighScore = Number(incoming.high_score) || 0;

          // Backward-compatible migration:
          // old score/high_score were points; new values are word-count and percent.
          const normalizedScore = Math.min(
            totalWords,
            incomingScore > totalWords
              ? Math.floor(incomingScore / pointsPerCorrectWord)
              : incomingScore,
          );

          const normalizedHighScore =
            incomingHighScore > 100 && legacyMaxLevelScore > 0
              ? Math.round(
                  (Math.min(incomingHighScore, legacyMaxLevelScore) /
                    legacyMaxLevelScore) *
                    100,
                )
              : Math.max(0, Math.min(100, incomingHighScore));

          const incomingCorrectWords = Array.isArray(incoming.correct_words)
            ? incoming.correct_words
            : [];

          normalized[idx] = {
            ...normalized[idx],
            ...incoming,
            score: normalizedScore,
            completed_words: Number(incoming.completed_words) || 0,
            high_score: normalizedHighScore,
            correct_words: incomingCorrectWords
              .map((word) =>
                String(word || "")
                  .trim()
                  .toUpperCase(),
              )
              .filter(Boolean),
            completed: Boolean(incoming.completed),
          };
        });

        return normalized;
      };

      const lesson_subsection = getLessonSubsection(normalizedLesson);
      const userProgress = userDataRef.current?.progress || {};
      const savedLessonProgress =
        userProgress[lesson_section] &&
        userProgress[lesson_section][lesson_subsection]
          ? userProgress[lesson_section][lesson_subsection]
          : null;
      const currentLessonProgressObj = savedLessonProgress
        ? normalizeProgress(savedLessonProgress)
        : cloneProgress(initProgress);
      setCurrentLesson({
        lesson: normalizedLesson,
        level: 0,
        progress: currentLessonProgressObj,
      });
      setCurrentLessonProgress(currentLessonProgressObj);
      setCurrentLessonLevel(0);
    },
    [cloneProgress],
  );

  const setLesson = useCallback(
    ({ lesson_id }) => {
      const requestedLessonId = normalizeLessonId(lesson_id);
      const requestedLessonIsIntegerId = /^\d+$/.test(requestedLessonId);
      if (!requestedLessonId) {
        setCurrentLesson(undefined);
        setCurrentLessonProgress(undefined);
        setCurrentLessonLevel(0);
        setCurrentLessonLoading(false);
        return;
      }

      setCurrentLessonLoading(true);

      if (requestedLessonId.startsWith(CUSTOM_LESSON_PREFIX)) {
        const customLessonId = requestedLessonId.slice(
          CUSTOM_LESSON_PREFIX.length,
        );

        if (!customLessonId) {
          setCurrentLesson(undefined);
          setCurrentLessonProgress(undefined);
          setCurrentLessonLevel(0);
          setCurrentLessonLoading(false);
          return;
        }

        db.collection("customLessons")
          .doc(customLessonId)
          .get()
          .then((doc) => {
            if (!doc.exists) {
              console.error("Custom lesson not found for id:", customLessonId);
              setCurrentLesson(undefined);
              setCurrentLessonProgress(undefined);
              setCurrentLessonLevel(0);
              return;
            }

            const data = doc.data() || {};
            applyLessonSelection({
              ...data,
              lesson_id: requestedLessonId,
              lesson_section: "custom",
              lesson_name: data.name || "Custom Lesson",
              isCustomLesson: true,
              custom_lesson_id: customLessonId,
              words: Array.isArray(data.words) ? data.words : [],
            });
          })
          .catch((error) => {
            console.error("Failed to load custom lesson:", error);
            setCurrentLesson(undefined);
            setCurrentLessonProgress(undefined);
            setCurrentLessonLevel(0);
          })
          .finally(() => {
            setCurrentLessonLoading(false);
          });

        return;
      }
      const requestedLessonNumeric = Number(requestedLessonId);
      const selectedLesson = lessons.find((lesson) => {
        const candidateId = normalizeLessonId(lesson?.lesson_id ?? lesson?.id);
        if (candidateId === requestedLessonId) {
          return true;
        }

        const candidateNumeric = Number(candidateId);
        const candidateIsIntegerId = /^\d+$/.test(candidateId);
        return (
          requestedLessonIsIntegerId &&
          candidateIsIntegerId &&
          Number.isFinite(requestedLessonNumeric) &&
          Number.isFinite(candidateNumeric) &&
          candidateNumeric === requestedLessonNumeric
        );
      });

      if (selectedLesson) {
        applyLessonSelection(selectedLesson);
        setCurrentLessonLoading(false);
        return;
      }

      const requestedLessonRef = db
        .collection("lessons")
        .doc(requestedLessonId);

      const queryLessonByField = () => {
        const stringQuery = db
          .collection("lessons")
          .where("lesson_id", "==", requestedLessonId)
          .limit(1)
          .get();

        return stringQuery.then((snapshot) => {
          if (!snapshot.empty) {
            return snapshot.docs[0];
          }

          if (
            !requestedLessonIsIntegerId ||
            !Number.isFinite(requestedLessonNumeric)
          ) {
            return null;
          }

          return db
            .collection("lessons")
            .where("lesson_id", "==", requestedLessonNumeric)
            .limit(1)
            .get()
            .then((numericSnapshot) => {
              return numericSnapshot.empty ? null : numericSnapshot.docs[0];
            });
        });
      };

      requestedLessonRef
        .get()
        .then((doc) => {
          if (doc.exists) {
            applyLessonSelection(hydrateLessonDoc(doc));
            return;
          }

          return queryLessonByField().then((matchedDoc) => {
            if (!matchedDoc) {
              console.error(
                "Lesson not found for lesson_id:",
                requestedLessonId,
              );
              setCurrentLesson(undefined);
              setCurrentLessonProgress(undefined);
              setCurrentLessonLevel(0);
              return;
            }

            applyLessonSelection(hydrateLessonDoc(matchedDoc));
          });
        })
        .catch((error) => {
          console.error("Failed to load lesson:", error);
          setCurrentLesson(undefined);
          setCurrentLessonProgress(undefined);
          setCurrentLessonLevel(0);
        })
        .finally(() => {
          setCurrentLessonLoading(false);
        });
    },
    [applyLessonSelection, hydrateLessonDoc, lessons, normalizeLessonId],
  );

  const updateCurrentLesson = ({ level, progress }) => {
    setCurrentLesson((prevLesson) => {
      if (!prevLesson) {
        return prevLesson;
      }

      const nextLesson = {
        ...prevLesson,
        ...(level !== undefined ? { level } : {}),
        ...(progress ? { progress } : {}),
      };

      if (level !== undefined) {
        setCurrentLessonLevel(level);
      }

      if (progress) {
        setCurrentLessonProgress(progress);
      }

      return nextLesson;
    });
  };

  const setLevel = (level) => {
    // setCurrentLevel(level)
    updateCurrentLesson({ level });
  };

  const setProgress = (completed_words, updatePayload = {}) => {
    if (!currentLesson) {
      return null;
    }

    const { progress, level } = currentLesson;
    const nextProgress = cloneProgress(progress);
    const total_words = currentLesson.lesson.words.length;
    const justFinishedLevel = completed_words === total_words;

    const isLegacyScoreIncrement =
      typeof updatePayload === "number" && Number(updatePayload) > 0;
    const isCorrect =
      typeof updatePayload === "object"
        ? Boolean(updatePayload.isCorrect)
        : isLegacyScoreIncrement;
    const submittedWord =
      typeof updatePayload === "object" ? updatePayload.word : undefined;
    const levelMetrics =
      typeof updatePayload === "object" &&
      updatePayload.levelMetrics &&
      typeof updatePayload.levelMetrics === "object"
        ? updatePayload.levelMetrics
        : null;
    const normalizedWord = String(submittedWord || "")
      .trim()
      .toUpperCase();

    const currentCorrectWords = Array.isArray(nextProgress[level].correct_words)
      ? nextProgress[level].correct_words
      : [];
    const nextCorrectWords = [...currentCorrectWords];

    if (isCorrect && normalizedWord) {
      if (!nextCorrectWords.includes(normalizedWord)) {
        nextCorrectWords.push(normalizedWord);
      }

      // Persist mastered words as soon as they are earned so the AppBar
      // counter updates during a lesson instead of waiting for manual save.
      // Only write the words_mastered_by_difficulty counter immediately.
      // Writing full progress per-word would trigger a Firestore snapshot that
      // re-initialises the lesson and resets correct_words. Full progress
      // (including correct_words) is persisted at lesson save/completion via
      // saveProgress(), which already includes the correct_words array.
      const difficultyLevel = String(Number(level || 0) + 1);
      const isMasteryDifficultyLevel = difficultyLevel === "3";
      if (
        isMasteryDifficultyLevel &&
        typeof registerMasteredWord === "function"
      ) {
        registerMasteredWord(difficultyLevel, normalizedWord);
      }
      if (isMasteryDifficultyLevel && user?.uid) {
        db.collection("users")
          .doc(user.uid)
          .set(
            {
              words_mastered_by_difficulty: {
                [difficultyLevel]:
                  firebase.firestore.FieldValue.arrayUnion(normalizedWord),
              },
            },
            { merge: true },
          )
          .catch((error) => {
            console.error("Failed to persist mastered word:", error);
          });

        const isCustomLesson = Boolean(currentLesson?.lesson?.isCustomLesson);
        const customLessonId = String(
          currentLesson?.lesson?.custom_lesson_id || "",
        ).trim();
        const isLevel3 = Number(level) === 2;
        if (isCustomLesson && customLessonId && isLevel3) {
          const progressDocId = `clp_${customLessonId}_${user.uid}`;
          const studentName =
            userDataRef.current?.displayName ||
            userDataRef.current?.username ||
            userDataRef.current?.email ||
            user.uid;
          const educatorId =
            currentLesson?.lesson?.creatorId ||
            currentLesson?.lesson?.createdBy ||
            userDataRef.current?.educator ||
            null;

          db.collection(CUSTOM_LESSON_PROGRESS_COLLECTION)
            .doc(progressDocId)
            .set(
              {
                lessonId: customLessonId,
                lessonName:
                  currentLesson?.lesson?.name ||
                  currentLesson?.lesson?.lesson_name ||
                  "Custom Lesson",
                studentId: user.uid,
                studentName,
                educatorId,
                totalWords: total_words,
                currentIndex: completed_words,
                lastAttemptAt: firebase.firestore.FieldValue.serverTimestamp(),
                masteredWordsLevel3:
                  firebase.firestore.FieldValue.arrayUnion(normalizedWord),
              },
              { merge: true },
            )
            .catch((error) => {
              console.error(
                "[setProgress] Failed to persist custom lesson Level 3 mastery:",
                error,
              );
            });
        }
      }
    }

    const nextScore = Math.min(
      total_words,
      Number(nextProgress[level].score || 0) + (isCorrect ? 1 : 0),
    );
    nextProgress[level].score = nextScore;
    nextProgress[level].correct_words = nextCorrectWords;

    if (levelMetrics) {
      nextProgress[level] = {
        ...nextProgress[level],
        ...levelMetrics,
      };
    }

    // Set completed flag
    nextProgress[level].completed = nextProgress[level].completed
      ? true
      : justFinishedLevel;
    // Update completed words
    // If level has been completed, we switch back to 0
    nextProgress[level].completed_words = justFinishedLevel
      ? 0
      : completed_words;

    if (justFinishedLevel) {
      // Track best lesson accuracy as a percentage.
      const boundedCurrentScore = Math.min(
        nextProgress[level].score,
        total_words,
      );
      const levelPercent = total_words
        ? Math.round((boundedCurrentScore / total_words) * 100)
        : 0;
      nextProgress[level].high_score =
        levelPercent > nextProgress[level].high_score
          ? levelPercent
          : nextProgress[level].high_score;

      nextProgress[level].score = 0;
      // Keep correct_words so the progress page can display cumulative unique
      // words the student has successfully spelled at this difficulty level.
    }

    updateCurrentLesson({ progress: nextProgress });
    return nextProgress;
  };

  const saveProgress = (progressOverride, options = {}) => {
    var { progress, lesson } = currentLesson;
    const progressToSave = progressOverride || progress;
    const lessonSection = lesson.lesson_section;
    const lessonSubsection = getLessonSubsection(lesson);

    const updatePayload = {
      progress: {
        [lessonSection]: {
          [lessonSubsection]: progressToSave,
        },
      },
    };

    const masteredWordsByLevel = options?.masteredWordsByLevel || {};
    Object.keys(masteredWordsByLevel).forEach((difficultyLevel) => {
      const words = Array.isArray(masteredWordsByLevel[difficultyLevel])
        ? masteredWordsByLevel[difficultyLevel]
            .map((word) =>
              String(word || "")
                .trim()
                .toUpperCase(),
            )
            .filter(Boolean)
        : [];

      if (words.length > 0) {
        updatePayload.words_mastered_by_difficulty = {
          ...(updatePayload.words_mastered_by_difficulty || {}),
          [difficultyLevel]: firebase.firestore.FieldValue.arrayUnion(...words),
        };
      }
    });

    const persistUserProgress = db
      .collection("users")
      .doc(user.uid)
      .set(updatePayload, { merge: true });

    const updatePracticeStreak = async () => {
      const userRef = db.collection("users").doc(user.uid);
      const todayDayKey = toLocalDayKey();

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const data = snap.exists ? snap.data() || {} : {};

        const lastPracticeDay = normalizeDayKey(
          data.lastPracticeDay || data.last_practice_day,
        );
        if (lastPracticeDay === todayDayKey) {
          const lastRefillDay = normalizeDayKey(
            data.streakSaveRefilledAtDay ||
              data.streak_save_refilled_at_day ||
              lastPracticeDay,
          );
          const streakSaveTokensRaw = Number(
            data.streakSaveTokens ?? data.streak_save_tokens ?? 0,
          );
          const streakSaveTokens = Number.isFinite(streakSaveTokensRaw)
            ? streakSaveTokensRaw
            : 0;
          const shouldRefillTokens =
            !lastRefillDay ||
            diffDayKeys(todayDayKey, lastRefillDay) >= STREAK_SAVE_REFILL_DAYS;
          if (shouldRefillTokens && streakSaveTokens < 1) {
            tx.set(
              userRef,
              {
                streakSaveTokens: 1,
                streak_save_tokens: 1,
                streakSaveRefilledAtDay: todayDayKey,
                streak_save_refilled_at_day: todayDayKey,
              },
              { merge: true },
            );
          }
          return;
        }

        const currentStreakRaw = Number(
          data.current_streak ?? data.practice_streak ?? data.streak ?? 0,
        );
        const bestStreakRaw = Number(data.best_streak ?? data.bestStreak ?? 0);
        const streakSaveTokensRaw = Number(
          data.streakSaveTokens ?? data.streak_save_tokens ?? 0,
        );
        let streakSaveTokens = Number.isFinite(streakSaveTokensRaw)
          ? streakSaveTokensRaw
          : 0;
        const currentStreak = Number.isFinite(currentStreakRaw)
          ? currentStreakRaw
          : 0;
        const bestStreak = Number.isFinite(bestStreakRaw) ? bestStreakRaw : 0;

        const lastRefillDay = normalizeDayKey(
          data.streakSaveRefilledAtDay || data.streak_save_refilled_at_day,
        );
        if (
          !lastRefillDay ||
          diffDayKeys(todayDayKey, lastRefillDay) >= STREAK_SAVE_REFILL_DAYS
        ) {
          streakSaveTokens = Math.max(streakSaveTokens, 1);
        }

        const gapDays = diffDayKeys(todayDayKey, lastPracticeDay);
        let nextStreak = currentStreak;
        let nextTokens = streakSaveTokens;

        if (lastPracticeDay && gapDays === 1) {
          nextStreak = currentStreak + 1;
        } else if (lastPracticeDay && gapDays > 1) {
          if (nextTokens > 0) {
            nextStreak = currentStreak + 1;
            nextTokens -= 1;
          } else {
            nextStreak = 1;
          }
        } else if (!lastPracticeDay) {
          nextStreak = 1;
        }

        tx.set(
          userRef,
          {
            current_streak: nextStreak,
            practice_streak: nextStreak,
            streak: nextStreak,
            best_streak: Math.max(bestStreak, nextStreak),
            bestStreak: Math.max(bestStreak, nextStreak),
            lastPracticeDay: todayDayKey,
            last_practice_day: todayDayKey,
            lastPracticeAt: firebase.firestore.FieldValue.serverTimestamp(),
            streakSaveTokens: nextTokens,
            streak_save_tokens: nextTokens,
            streakSaveRefilledAtDay: todayDayKey,
            streak_save_refilled_at_day: todayDayKey,
          },
          { merge: true },
        );
      });
    };

    const isCustomLesson = Boolean(lesson?.isCustomLesson);
    const customLessonId = String(lesson?.custom_lesson_id || "").trim();
    const persistAndTrack = persistUserProgress.then(() =>
      updatePracticeStreak().catch((error) => {
        console.error("Failed to update practice streak:", error);
      }),
    );

    if (!isCustomLesson || !customLessonId || !user?.uid) {
      return persistAndTrack;
    }

    const studentName =
      userDataRef.current?.displayName ||
      userDataRef.current?.username ||
      userDataRef.current?.email ||
      user.uid;
    const educatorId =
      lesson?.creatorId ||
      lesson?.createdBy ||
      userDataRef.current?.educator ||
      null;
    const levelThreeProgress =
      progressToSave?.[2] ||
      progressToSave?.["2"] ||
      progressToSave?.[3] ||
      progressToSave?.["3"] ||
      {};
    const levelThreeWords = Array.isArray(levelThreeProgress.correct_words)
      ? levelThreeProgress.correct_words
          .map((word) =>
            String(word || "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean)
      : [];
    const progressDocId = `clp_${customLessonId}_${user.uid}`;

    return persistAndTrack.then(() =>
      db
        .collection(CUSTOM_LESSON_PROGRESS_COLLECTION)
        .doc(progressDocId)
        .set(
          {
            lessonId: customLessonId,
            lessonName: lesson?.name || lesson?.lesson_name || "Custom Lesson",
            studentId: user.uid,
            studentName,
            educatorId,
            totalWords: Array.isArray(lesson?.words) ? lesson.words.length : 0,
            lastAttemptAt: firebase.firestore.FieldValue.serverTimestamp(),
            masteredWordsLevel3: levelThreeWords,
          },
          { merge: true },
        ),
    );
  };

  const markFirstLessonAttempted = useCallback(async () => {
    const uid = String(user?.uid || "").trim();
    if (!uid) return;

    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() || {} : {};
      if (data.firstLessonAttemptedAt) return;
      tx.set(
        userRef,
        {
          firstLessonAttemptedAt:
            firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  }, [user?.uid]);

  const updateScore = (word, isCorrect) => {
    const { progress, level } = currentLesson;
    const nextProgress = cloneProgress(progress);
    const currentScore = nextProgress[level].score;
    const totalWords = currentLesson.lesson.words.length;
    const maxLevelScore = totalWords * (level + 1) * 5;
    const newScore = isCorrect ? (level + 1) * 5 + currentScore : currentScore;
    const boundedScore = Math.min(newScore, maxLevelScore);
    nextProgress[level].score = boundedScore;
    updateCurrentLesson({ progress: nextProgress });
  };

  const createLesson = ({ title, words, description }) => {
    // Check if words exist using batched documentId queries to reduce reads.
    const normalizedWords = Array.isArray(words)
      ? words
          .map((word) =>
            String(word || "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean)
      : [];
    const uniqueWords = [...new Set(normalizedWords)];
    const chunkSize = 10;
    const chunks = [];

    for (let i = 0; i < uniqueWords.length; i += chunkSize) {
      chunks.push(uniqueWords.slice(i, i + chunkSize));
    }

    const checkPromises = chunks.map((chunk) =>
      db
        .collection("words")
        .where(firebase.firestore.FieldPath.documentId(), "in", chunk)
        .get(),
    );

    return Promise.all(checkPromises).then((snapshots) => {
      const foundWordIds = new Set();
      snapshots.forEach((snapshot) => {
        snapshot.docs.forEach((doc) => {
          foundWordIds.add(doc.id);
        });
      });

      const rejectedWords = uniqueWords.filter(
        (word) => !foundWordIds.has(word),
      );
      if (rejectedWords.length > 0) {
        return Promise.reject({ rejectedWords });
      }

      const createdBy = user.uid;
      const educator = isEducator ? user.uid : userData.educator;
      return db
        .collection("customLessons")
        .doc()
        .set({ title, description, words, createdBy, educator });
    });
  };

  useEffect(() => {
    if (!user || !authLoaded) {
      if (!user) {
        setLessons([]);
        setLessonsLoading(true);
        setLessonSections({});
        setLessonSectionsLoading(true);
        setRules([]);
        loadedLessonDataUserIdRef.current = null;
      }
      return;
    }

    if (!shouldLoadLessonData) {
      setLessonsLoading(false);
      setLessonSectionsLoading(false);
      const perfSessionId = getCurrentPerfSessionId();
      if (perfSessionId) {
        setPerfMetric("lessonInitialDataSkipped", true, {
          sessionId: perfSessionId,
        });
        setPerfMetric("route", String(location?.pathname || ""), {
          sessionId: perfSessionId,
        });
      }
      return;
    }

    const cacheKey = `${user.uid}:${role}`;
    if (loadedLessonDataUserIdRef.current === cacheKey) {
      return;
    }

    loadedLessonDataUserIdRef.current = cacheKey;

    const initialLoadStartedAt = nowMs();
    const cachedStaticData = readLessonStaticCache();
    const perfSessionId = getCurrentPerfSessionId();

    if (perfSessionId) {
      setPerfMetric("lessonStaticCacheHit", Boolean(cachedStaticData), {
        sessionId: perfSessionId,
      });
    }

    if (cachedStaticData) {
      setLessons(cachedStaticData.lessons);
      setLessonsLoading(false);
      setLessonSections(cachedStaticData.lessonSections);
      setLessonSectionsLoading(false);
      setRules(cachedStaticData.rules);
      rulesRef.current = cachedStaticData.rules;
      const totalMs = Math.round(nowMs() - initialLoadStartedAt);
      if (perfSessionId) {
        setPerfMetric("lessonInitialDataSkipped", false, {
          sessionId: perfSessionId,
        });
        setPerfMetric("lessonInitialDataMs", totalMs, {
          sessionId: perfSessionId,
        });
        setPerfMetric("lessonStaticRefreshMs", 0, {
          sessionId: perfSessionId,
        });
        setPerfMetric("lessonStaticRefreshSkipped", true, {
          sessionId: perfSessionId,
        });
        setPerfMetric("route", String(location?.pathname || ""), {
          sessionId: perfSessionId,
        });
      }
      console.info("[perf] lessonProvider.staticCacheHydrated", {
        route: String(location?.pathname || ""),
        userId: user.uid,
        refreshSkipped: true,
        ms: totalMs,
      });
      return;
    }

    if (perfSessionId) {
      setPerfMetric("lessonStaticRefreshSkipped", false, {
        sessionId: perfSessionId,
      });
    }

    const rulesPromise = loadRules("initial");

    if (!cachedStaticData) {
      setLessonsLoading(true);
      setLessonSectionsLoading(true);
    }

    const lessonsPromise = db
      .collection("lessons")
      .get()
      .then((lessonDocs) => {
        var lessonData = lessonDocs.docs.map((doc) => {
          const data = doc.data() || {};
          return {
            ...data,
            lesson_id:
              data.lesson_id !== undefined && data.lesson_id !== null
                ? data.lesson_id
                : doc.id,
          };
        });
        lessonData = sortBy(lessonData, [
          function (doc) {
            return parseInt(doc.lesson_id);
          },
        ]);

        setLessons(lessonData);
        setLessonsLoading(false);
        return lessonData;
      })
      .catch((error) => {
        console.error("Failed to load lessons:", error);
        if (!cachedStaticData) {
          setLessons([]);
        }
        setLessonsLoading(false);
        return null;
      });

    const sectionsPromise = db
      .collection("lessonSections")
      .get()
      .then((sectionDocs) => {
        const sectionMap = sectionDocs.docs.reduce((acc, doc) => {
          const data = doc.data() || {};

          // The document ID itself is the section number (1-13)
          const sectionKey = doc.id;

          if (!sectionKey) {
            console.warn("Skipping lessonSection doc with no ID");
            return acc;
          }

          const title = (
            typeof data.title === "string" ? data.title : ""
          ).trim();
          const description = (
            typeof data.description === "string" ? data.description : ""
          ).trim();

          acc[sectionKey] = { title, description };

          // Firestore docs are commonly keyed 2-13 while lesson_section values are 1-12.
          // Create an alias key (docId - 1) so consumers can read by part number directly.
          const numericSectionKey = Number(sectionKey);
          if (Number.isFinite(numericSectionKey) && numericSectionKey > 1) {
            const aliasKey = String(numericSectionKey - 1);
            if (!acc[aliasKey]?.description) {
              acc[aliasKey] = { title, description };
            }
          }

          return acc;
        }, {});

        setLessonSections(sectionMap);
        setLessonSectionsLoading(false);
        return sectionMap;
      })
      .catch((error) => {
        console.error("Failed to load lesson sections, error details:", error);
        if (!cachedStaticData) {
          setLessonSections({});
        }
        setLessonSectionsLoading(false);
        return null;
      });

    Promise.allSettled([rulesPromise, lessonsPromise, sectionsPromise]).then(
      (results) => {
        const rulesData =
          results[0].status === "fulfilled" ? results[0].value : null;
        const lessonData =
          results[1].status === "fulfilled" ? results[1].value : null;
        const sectionData =
          results[2].status === "fulfilled" ? results[2].value : null;

        if (rulesData && lessonData && sectionData) {
          writeLessonStaticCache({
            lessons: lessonData,
            lessonSections: sectionData,
            rules: rulesData,
          });
        }

        const fulfilledCount = results.filter(
          (result) => result.status === "fulfilled",
        ).length;
        const totalMs = Math.round(nowMs() - initialLoadStartedAt);
        if (perfSessionId) {
          setPerfMetric("lessonInitialDataSkipped", false, {
            sessionId: perfSessionId,
          });
          setPerfMetric("lessonInitialDataMs", totalMs, {
            sessionId: perfSessionId,
          });
          setPerfMetric("lessonStaticRefreshMs", totalMs, {
            sessionId: perfSessionId,
          });
          setPerfMetric("route", String(location?.pathname || ""), {
            sessionId: perfSessionId,
          });
        }
        console.info("[perf] lessonProvider.initialDataLoaded", {
          route: String(location?.pathname || ""),
          userId: user.uid,
          cacheHit: Boolean(cachedStaticData),
          fulfilled: fulfilledCount,
          total: results.length,
          ms: totalMs,
        });
      },
    );
  }, [user, authLoaded, role, loadRules, shouldLoadLessonData]);

  return (
    <LessonContext.Provider
      value={{
        lessonsLoading,
        lessonSectionsLoading,
        currentLessonLoading,
        currentLesson, //Lesson that user is currently viewing
        currentLessonProgress,
        currentLessonLevel,
        lessons, //All lessons
        lessonSections,
        rules,
        rulesLoading,
        refreshRules: () => loadRules("force"),
        setLesson,
        setLevel,
        setProgress,
        saveProgress,
        markFirstLessonAttempted,
        updateScore,
        createLesson,
      }}
    >
      {children}
    </LessonContext.Provider>
  );
};

export { LessonProvider, LessonContext };
