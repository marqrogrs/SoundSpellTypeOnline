import React, { useState, useEffect, useContext, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";

import { db } from "../firebase";
import { UserContext } from "./UserProvider";
import { getLessonSubsection, buildActiveLessonWords } from "../util/functions";
var _ = require("lodash");

const LessonContext = React.createContext({});

const LessonProvider = ({ children }) => {
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const [lessons, setLessons] = useState([]);
  const [lessonSectionsLoading, setLessonSectionsLoading] = useState(true);
  const [lessonSections, setLessonSections] = useState({});
  const { userData } = useContext(UserContext);
  const { user, isEducator } = useAuth();

  const [currentLesson, setCurrentLesson] = useState();
  const [currentLessonProgress, setCurrentLessonProgress] = useState();
  const [currentLessonLevel, setCurrentLessonLevel] = useState();
  const [currentLessonLoading, setCurrentLessonLoading] = useState(false);

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
      const normalizedLesson = {
        ...selectedLesson,
        lesson_id: String(selectedLesson.lesson_id ?? "").trim(),
        words: buildActiveLessonWords(selectedLesson.words),
      };

      const lesson_section = String(normalizedLesson.lesson_section ?? "");

      const defaultLevelProgress = () => ({
        score: 0,
        completed_words: 0,
        high_score: 0,
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
          normalized[idx] = {
            ...normalized[idx],
            ...incoming,
            score: Number(incoming.score) || 0,
            completed_words: Number(incoming.completed_words) || 0,
            high_score: Number(incoming.high_score) || 0,
            completed: Boolean(incoming.completed),
          };
        });

        return normalized;
      };

      const lesson_subsection = getLessonSubsection(normalizedLesson);
      const userProgress = userData?.progress || {};
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
    [cloneProgress, userData],
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

  const setProgress = (completed_words, scoreIncrement = 0) => {
    if (!currentLesson) {
      return null;
    }

    const { progress, level } = currentLesson;
    const nextProgress = cloneProgress(progress);
    const total_words = currentLesson.lesson.words.length;
    const justFinishedLevel = completed_words === total_words;
    const maxLevelScore = total_words * (level + 1) * 5;

    // Update running score before checking level completion so the last
    // submitted word is included in high_score when the level ends.
    const nextScore = Math.min(
      Number(nextProgress[level].score || 0) + Number(scoreIncrement || 0),
      maxLevelScore,
    );
    nextProgress[level].score = nextScore;

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
      // Update high score
      const boundedCurrentScore = Math.min(
        nextProgress[level].score,
        maxLevelScore,
      );
      nextProgress[level].high_score =
        boundedCurrentScore > nextProgress[level].high_score
          ? boundedCurrentScore
          : nextProgress[level].high_score;

      nextProgress[level].score = 0;
    }

    updateCurrentLesson({ progress: nextProgress });
    return nextProgress;
  };

  const saveProgress = (progressOverride) => {
    console.log("Saving to: ", user);
    var { progress, lesson } = currentLesson;
    const progressToSave = progressOverride || progress;
    const lessonSection = lesson.lesson_section;
    const lessonSubsection = getLessonSubsection(lesson);
    return db
      .collection("users")
      .doc(user.uid)
      .update({
        [`progress.${lessonSection}.${lessonSubsection}`]: progressToSave,
      });
  };

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
    if (!user) {
      console.log("LessonProvider: No user, skipping data load");
      setLessons([]);
      setLessonsLoading(true);
      setLessonSections({});
      setLessonSectionsLoading(true);
      return;
    }

    console.log(
      "LessonProvider: Starting to load lessons and sections for user:",
      user.uid,
    );

    setLessonsLoading(true);
    setLessonSectionsLoading(true);

    db.collection("lessons")
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
        lessonData = _.sortBy(lessonData, [
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

    console.log("Attempting to load lessonSection collection...");
    db.collection("lessonSection")
      .get()
      .then((sectionDocs) => {
        console.log("Got lessonSection docs, count:", sectionDocs.docs.length);
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
    // db.collection('customLessons').onSnapshot(queryRef => {
    //   console.log(queryRef)
    // })
  }, [user]);

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
        setLesson,
        setLevel,
        setProgress,
        saveProgress,
        updateScore,
        createLesson,
      }}
    >
      {children}
    </LessonContext.Provider>
  );
};

export { LessonProvider, LessonContext };
