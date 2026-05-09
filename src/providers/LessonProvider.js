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
const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const LessonProvider = ({ children }) => {
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const [lessons, setLessons] = useState([]);
  const [lessonSectionsLoading, setLessonSectionsLoading] = useState(true);
  const [lessonSections, setLessonSections] = useState({});
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
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
        setRulesLoading(false);
        console.info("[perf] lessonProvider.rulesLoaded", {
          source,
          count: rulesData.length,
          ms: Math.round(nowMs() - startedAt),
        });
      })
      .catch((error) => {
        console.error("Failed to load rules:", error.code, error.message);
        setRulesLoading(false);
        console.info("[perf] lessonProvider.rulesLoadFailed", {
          source,
          ms: Math.round(nowMs() - startedAt),
          code: error?.code || "unknown",
        });
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
      console.log(
        "Setting current lesson to: ",
        normalizedLesson,
        currentLessonProgressObj,
      );
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
        return (
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

          if (!Number.isFinite(requestedLessonNumeric)) {
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
      if (typeof registerMasteredWord === "function") {
        registerMasteredWord(difficultyLevel, normalizedWord);
      }
      if (user?.uid) {
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
      }
    }

    const nextScore = Math.min(
      total_words,
      Number(nextProgress[level].score || 0) + (isCorrect ? 1 : 0),
    );
    nextProgress[level].score = nextScore;
    nextProgress[level].correct_words = nextCorrectWords;

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
    console.log("Saving to: ", user);
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

    return db
      .collection("users")
      .doc(user.uid)
      .set(updatePayload, { merge: true });
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
    console.log("updating score");
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
    // Check if word exists
    var rejectedWords = [];
    var wordCheckPromises = [];

    words.forEach((word) => {
      wordCheckPromises.push(db.collection("words").doc(word).get());
    });

    return Promise.all(wordCheckPromises).then((docRefs) => {
      docRefs.forEach((docRef) => {
        if (!docRef.exists) {
          rejectedWords.push(docRef.id);
        }
      });
      if (rejectedWords.length > 0) {
        return Promise.reject({ rejectedWords });
      } else {
        const createdBy = user.uid;
        const educator = isEducator ? user.uid : userData.educator;
        return db
          .collection("customLessons")
          .doc()
          .set({ title, description, words, createdBy, educator });
      }
    });
  };

  useEffect(() => {
    if (!user || !authLoaded) {
      if (!user) {
        console.log("LessonProvider: No user, skipping data load");
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
    const rulesPromise = loadRules("initial");

    console.log(
      "LessonProvider: Starting to load lessons and sections for user:",
      user.uid,
    );

    setLessonsLoading(true);
    setLessonSectionsLoading(true);

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

        console.log("Loaded lessons:", lessonData.length);
        setLessons(lessonData);
        setLessonsLoading(false);
      })
      .catch((error) => {
        console.error("Failed to load lessons:", error);
        setLessons([]);
        setLessonsLoading(false);
      });

    console.log("Attempting to load lessonSections collection...");
    const sectionsPromise = db
      .collection("lessonSections")
      .get()
      .then((sectionDocs) => {
        console.log("Got lessonSections docs, count:", sectionDocs.docs.length);
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

          console.log(`Loaded section ${sectionKey}: "${title}"`);
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

        console.log("Final lessonSection metadata map:", sectionMap);
        setLessonSections(sectionMap);
        setLessonSectionsLoading(false);
      })
      .catch((error) => {
        console.error("Failed to load lesson sections, error details:", error);
        setLessonSections({});
        setLessonSectionsLoading(false);
      });

    Promise.allSettled([rulesPromise, lessonsPromise, sectionsPromise]).then(
      (results) => {
        const fulfilledCount = results.filter(
          (result) => result.status === "fulfilled",
        ).length;
        const totalMs = Math.round(nowMs() - initialLoadStartedAt);
        const perfSessionId = getCurrentPerfSessionId();
        if (perfSessionId) {
          setPerfMetric("lessonInitialDataSkipped", false, {
            sessionId: perfSessionId,
          });
          setPerfMetric("lessonInitialDataMs", totalMs, {
            sessionId: perfSessionId,
          });
          setPerfMetric("route", String(location?.pathname || ""), {
            sessionId: perfSessionId,
          });
        }
        console.info("[perf] lessonProvider.initialDataLoaded", {
          route: String(location?.pathname || ""),
          userId: user.uid,
          fulfilled: fulfilledCount,
          total: results.length,
          ms: totalMs,
        });
      },
    );
    // db.collection('customLessons').onSnapshot(queryRef => {
    //   console.log(queryRef)
    // })
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
        refreshRules: loadRules,
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
