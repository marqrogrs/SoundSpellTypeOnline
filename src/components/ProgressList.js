import React, { useContext, useEffect, useState } from "react";

import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableContainer from "@material-ui/core/TableContainer";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";
import KeyboardArrowDownIcon from "@material-ui/icons/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@material-ui/icons/KeyboardArrowUp";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import { LessonContext } from "../providers/LessonProvider";
import ProgressListItem from "./ProgressListItem";
import PatternButton from "./PatternButton";

import { UserContext } from "../providers/UserProvider";
import { getLessonSubsection, buildActiveLessonWords } from "../util/functions";
import {
  INIT_PROGRESS_OBJ,
  LESSON_SECTION_OVERRIDES,
  LEVELS,
} from "../util/constants";
import { useStyles } from "../styles/material";
import { db, auth } from "../firebase";

const LESSON_SECTIONS_CACHE_KEY = "progress:lessonSections:v1";
const LESSON_SECTIONS_CACHE_TTL_MS = 10 * 60 * 1000;
const REQUIRED_ACCURACY_FOR_CHECKMARK = 90;

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeWords = (words) =>
  new Set(
    (Array.isArray(words) ? words : [])
      .map((word) =>
        String(word || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  );

function readLessonSectionsCache() {
  try {
    const raw = sessionStorage.getItem(LESSON_SECTIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (
      Date.now() - Number(parsed.cachedAt || 0) >
      LESSON_SECTIONS_CACHE_TTL_MS
    ) {
      return null;
    }
    return parsed.data && typeof parsed.data === "object" ? parsed.data : null;
  } catch (_err) {
    return null;
  }
}

function writeLessonSectionsCache(data) {
  try {
    sessionStorage.setItem(
      LESSON_SECTIONS_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        data,
      }),
    );
  } catch (_err) {
    // Best-effort cache only.
  }
}

function buildLessonSectionsMap(docs) {
  return docs.reduce((acc, doc) => {
    const data = doc.data() || {};
    const key = String(doc.id || "").trim();
    if (!key) return acc;

    const title = (typeof data.title === "string" ? data.title : "").trim();
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
}

function splitExampleWords(description) {
  const raw = String(description || "").trim();
  if (!raw) {
    return { mainText: "", exampleWords: "" };
  }

  const markerPattern = /\b(?:examaple words|example words)\b/i;
  const markerMatch = raw.match(markerPattern);

  if (!markerMatch || typeof markerMatch.index !== "number") {
    return { mainText: raw, exampleWords: "" };
  }

  const markerStart = markerMatch.index;
  const markerEnd = markerStart + markerMatch[0].length;
  const before = raw.slice(0, markerStart).trim();
  const after = raw
    .slice(markerEnd)
    .replace(/^[:\-\u2013\u2014.\s]+/, "")
    .trim();

  return {
    mainText: before,
    exampleWords: after,
  };
}

export default function ProgressList({ student }) {
  const activeLevelIndexes = LEVELS.map((_, index) => index);
  const {
    lessons,
    lessonSections = {},
    rules = [],
  } = useContext(LessonContext);
  const { userData } = useContext(UserContext);
  const [userLessonData, setUserLessonData] = useState(null);
  const [sectionExpanded, setSectionExpanded] = useState({});
  const [firestoreLessonSections, setFirestoreLessonSections] = useState({});
  const classes = useStyles();
  const effectiveLessonSections = {
    ...firestoreLessonSections,
    ...lessonSections,
  };

  const recommendedLessonId = React.useMemo(() => {
    const userProgress = asObject(userData?.progress);

    const lessonRows = (Array.isArray(lessons) ? lessons : []).map((lesson) => {
      const lessonSection = String(lesson?.lesson_section || "").trim();
      const lessonSubsection = getLessonSubsection(lesson);
      const sectionProgress = asObject(userProgress[lessonSection]);
      const rawLessonProgress = asObject(sectionProgress[lessonSubsection]);
      const masteryLevelProgress =
        rawLessonProgress[2] || rawLessonProgress["2"] || {};

      const isStarted = activeLevelIndexes.some((index) => {
        const levelProgress =
          rawLessonProgress[index] || rawLessonProgress[String(index)] || {};
        const completedWords = Number(levelProgress?.completed_words) || 0;
        const hasCompletedFlag = Boolean(levelProgress?.completed);
        const hasCorrectWords =
          Array.isArray(levelProgress?.correct_words) &&
          levelProgress.correct_words.length > 0;
        const hasScore = Number(levelProgress?.score) > 0;

        return (
          completedWords > 0 || hasCompletedFlag || hasCorrectWords || hasScore
        );
      });

      const totalLessonWords = buildActiveLessonWords(
        lesson?.words,
        lesson?.lesson_id,
      ).length;
      const masteredCount = normalizeWords(
        masteryLevelProgress?.correct_words,
      ).size;
      const masteredPercent = totalLessonWords
        ? Math.round((masteredCount / totalLessonWords) * 100)
        : 0;

      return {
        lesson,
        isStarted,
        isCompleted: masteredPercent >= REQUIRED_ACCURACY_FOR_CHECKMARK,
      };
    });

    const nextLesson =
      lessonRows.find((row) => !row.isCompleted) || lessonRows[0] || null;

    return String(nextLesson?.lesson?.lesson_id || "").trim();
  }, [lessons, userData]);

  const hasLevelStarted = (levelProgress) => {
    const completedWords = Number(levelProgress?.completed_words) || 0;
    const hasCompletedFlag = Boolean(levelProgress?.completed);
    const hasCorrectWords =
      Array.isArray(levelProgress?.correct_words) &&
      levelProgress.correct_words.length > 0;
    const hasScore = Number(levelProgress?.score) > 0;

    return (
      completedWords > 0 || hasCompletedFlag || hasCorrectWords || hasScore
    );
  };

  const getLessonProgress = (lesson, userProgress) => {
    const lessonSection = lesson.lesson_section;
    const lessonSubsection = getLessonSubsection(lesson);
    return userProgress[lessonSection] &&
      userProgress[lessonSection][lessonSubsection]
      ? userProgress[lessonSection][lessonSubsection]
      : JSON.parse(JSON.stringify(INIT_PROGRESS_OBJ));
  };

  const getLessonSummary = (lesson, progress) => {
    const totalLessonWords = buildActiveLessonWords(
      lesson?.words,
      lesson?.lesson_id,
    ).length;
    const getLevelWordsCorrectPercent = (levelProgress) => {
      if (!totalLessonWords) {
        return 0;
      }

      const words = Array.isArray(levelProgress?.correct_words)
        ? levelProgress.correct_words
        : [];
      const uniqueCount = new Set(
        words
          .map((w) =>
            String(w || "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean),
      ).size;

      return Math.round((uniqueCount / totalLessonWords) * 100);
    };

    const isInProgress = activeLevelIndexes.some((index) => {
      const levelProgress = progress[index] || {};
      return hasLevelStarted(levelProgress);
    });

    const masteryLevelIndex =
      activeLevelIndexes[activeLevelIndexes.length - 1] ?? 2;
    const masteryLevelProgress = progress[masteryLevelIndex] || {};
    const isCompleted =
      getLevelWordsCorrectPercent(masteryLevelProgress) >=
      REQUIRED_ACCURACY_FOR_CHECKMARK;

    return {
      isStarted: isInProgress,
      isCompleted,
    };
  };

  const normalizeSectionTitle = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const getLessonSectionByTitle = (title) => {
    const normalizedTitle = normalizeSectionTitle(title);
    if (!normalizedTitle) {
      return null;
    }

    const sections = Object.values(effectiveLessonSections || {});
    return (
      sections.find(
        (section) => normalizeSectionTitle(section?.title) === normalizedTitle,
      ) || null
    );
  };

  const toggleSection = (sectionKey) => {
    setSectionExpanded((prev) => ({
      ...prev,
      [sectionKey]: prev[sectionKey] !== true,
    }));
  };

  useEffect(() => {
    // Fallback load so Progress descriptions still render if context section
    // data is delayed. Use a one-time read + cache instead of a live listener.
    if (Object.keys(lessonSections || {}).length > 0) {
      setFirestoreLessonSections({});
      return;
    }

    const cached = readLessonSectionsCache();
    if (cached) {
      setFirestoreLessonSections(cached);
      return;
    }

    let cancelled = false;
    db.collection("lessonSections")
      .get()
      .then((snap) => {
        if (cancelled) return;
        const nextSections = buildLessonSectionsMap(snap.docs);
        setFirestoreLessonSections(nextSections);
        writeLessonSectionsCache(nextSections);
      })
      .catch(() => {
        if (cancelled) return;
        setFirestoreLessonSections({});
      });

    return () => {
      cancelled = true;
    };
  }, [lessonSections]);

  useEffect(() => {
    var unsubscribeStudent = () => {};
    if (student) {
      unsubscribeStudent = db
        .collection("users")
        .where("username", "==", student)
        .where("educator", "==", auth.currentUser.uid)
        .onSnapshot((snap) => {
          const firstDoc = snap.docs[0];
          setUserLessonData(firstDoc ? firstDoc.data() : null);
        });
    } else {
      setUserLessonData(userData || { progress: {} });
    }
    return () => {
      unsubscribeStudent();
    };
  }, [student, userData]);

  return (
    <>
      <TableContainer component={Paper} className={classes.table}>
        <Table style={{ tableLayout: "fixed", width: "100%" }}>
          <TableHead>
            <TableRow>
              <TableCell style={{ width: 56 }} />
              <TableCell style={{ width: 190, whiteSpace: "nowrap" }}>
                Lesson
              </TableCell>
              <TableCell>Description</TableCell>
              <TableCell
                align="right"
                style={{ width: 170, whiteSpace: "nowrap" }}
              >
                Spelling Patterns
              </TableCell>
              <TableCell
                align="right"
                style={{ width: 120, whiteSpace: "nowrap" }}
              >
                Status
              </TableCell>
              <TableCell align="right" style={{ width: 120 }}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {userLessonData && (
              <>
                {(() => {
                  let previousSection = null;

                  return lessons.map((lesson) => {
                    const lesson_section = lesson.lesson_section;
                    const lesson_subsection = getLessonSubsection(lesson);
                    const sectionKey = String(lesson_section || "").trim();
                    const lessonId = String(lesson.lesson_id || "").trim();
                    const lessonIdSectionKey = lessonId.split(".")[0] || "";
                    const normalizedSectionKey = sectionKey.includes(".")
                      ? lessonIdSectionKey
                      : sectionKey || lessonIdSectionKey;
                    const currentSection = sectionKey || "unknown";
                    const isNewSection = previousSection !== currentSection;
                    previousSection = currentSection;
                    const isCurrentSectionExpanded =
                      sectionExpanded[currentSection] === true;

                    const sectionOverrideMeta =
                      LESSON_SECTION_OVERRIDES[sectionKey] || {};
                    const sectionKeyMeta =
                      effectiveLessonSections[sectionKey] || {};
                    const sectionOffsetKey = String(
                      (parseInt(sectionKey, 10) || 0) + 1,
                    );
                    const sectionOffsetMeta =
                      effectiveLessonSections[sectionOffsetKey] || {};
                    const sectionDisplayTitle =
                      sectionOverrideMeta.title || sectionKeyMeta.title || "";
                    const sectionTitleMatchedMeta =
                      getLessonSectionByTitle(sectionDisplayTitle);
                    const fallbackTitle = sectionKey
                      ? `Part ${sectionKey}`
                      : "Part";

                    const sectionTitle = sectionDisplayTitle
                      ? `Part ${sectionKey} - ${sectionDisplayTitle}`
                      : fallbackTitle;
                    const sectionDescription =
                      sectionOffsetMeta.description ||
                      sectionKeyMeta.description ||
                      sectionTitleMatchedMeta?.description ||
                      "";
                    const {
                      mainText: sectionDescriptionMain,
                      exampleWords: sectionExampleWords,
                    } = splitExampleWords(sectionDescription);

                    const lessonIdSubsection = lessonId.split(".")[1] || "0";
                    const sectionRuleLesNum = lessonIdSectionKey
                      ? `${lessonIdSectionKey}.0`
                      : "";
                    const getRuleParts = (value) => {
                      const raw = String(value || "").trim();
                      if (!raw) {
                        return { section: "", subsection: "" };
                      }
                      const parts = raw.split(".");
                      return {
                        section: parts[0] || "",
                        subsection: parts[1] || "0",
                      };
                    };
                    const sectionCandidates = [
                      normalizedSectionKey,
                      lessonIdSectionKey,
                      sectionKey.split(".")[0] || "",
                    ].filter(Boolean);
                    const sectionRules = rules
                      .filter((r) => {
                        const { section } = getRuleParts(r?.rule_les_num);
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

                    // Include the section rule (subsection 0) and the lesson rule.
                    const matchedLessonRules = rules.filter((r) => {
                      const rawRuleLesNum = String(
                        r?.rule_les_num || "",
                      ).trim();
                      const { section, subsection } = getRuleParts(
                        r?.rule_les_num,
                      );
                      const matchesLessonRule = rawRuleLesNum === lessonId;
                      const matchesSectionRule =
                        sectionCandidates.includes(section) &&
                        subsection === "0";
                      const matchesLessonSubsectionRule =
                        sectionCandidates.includes(section) &&
                        subsection === lessonIdSubsection;
                      return (
                        matchesLessonRule ||
                        matchesSectionRule ||
                        matchesLessonSubsectionRule
                      );
                    });

                    // If specific lesson matching found nothing, fall back to
                    // the already-computed sectionRules so those lessons always
                    // show a Patterns button when the section has any rules.
                    const lessonRules = (
                      matchedLessonRules.length > 0
                        ? matchedLessonRules
                        : sectionRules
                    ).sort((a, b) => {
                      const aParts = getRuleParts(a?.rule_les_num);
                      const bParts = getRuleParts(b?.rule_les_num);
                      const aIsSectionRule = aParts.subsection === "0";
                      const bIsSectionRule = bParts.subsection === "0";
                      if (aIsSectionRule && !bIsSectionRule) {
                        return -1;
                      }
                      if (bIsSectionRule && !aIsSectionRule) {
                        return 1;
                      }
                      return String(aParts.subsection).localeCompare(
                        String(bParts.subsection),
                        undefined,
                        {
                          numeric: true,
                        },
                      );
                    });

                    const userProgress = userLessonData.progress || {};
                    const progress = getLessonProgress(lesson, userProgress);

                    const sectionLessons = lessons.filter(
                      (sectionLesson) =>
                        String(sectionLesson.lesson_section || "").trim() ===
                        currentSection,
                    );
                    const sectionSummaries = sectionLessons.map(
                      (sectionLesson) =>
                        getLessonSummary(
                          sectionLesson,
                          getLessonProgress(sectionLesson, userProgress),
                        ),
                    );
                    const sectionHasAnyStarted = sectionSummaries.some(
                      (summary) => summary.isStarted,
                    );
                    const sectionAllCompleted =
                      sectionSummaries.length > 0 &&
                      sectionSummaries.every((summary) => summary.isCompleted);

                    const sectionStatus = sectionAllCompleted ? (
                      <CheckCircleIcon color="primary" />
                    ) : sectionHasAnyStarted ? (
                      "In progress"
                    ) : (
                      "Not started"
                    );

                    const showSectionButton = student ? false : true;
                    const sectionButton =
                      !showSectionButton || sectionAllCompleted ? null : (
                        <Button
                          color="primary"
                          variant={
                            sectionExpanded[currentSection]
                              ? "outlined"
                              : sectionHasAnyStarted
                                ? "contained"
                                : "outlined"
                          }
                          onClick={() => toggleSection(currentSection)}
                        >
                          {sectionExpanded[currentSection]
                            ? "Close"
                            : sectionHasAnyStarted
                              ? "Continue"
                              : "Start"}
                        </Button>
                      );

                    return (
                      <React.Fragment key={lesson.lesson_id}>
                        {isNewSection && (
                          <TableRow>
                            <TableCell>
                              <IconButton
                                aria-label={`toggle part ${currentSection}`}
                                size="small"
                                onClick={() => toggleSection(currentSection)}
                              >
                                {isCurrentSectionExpanded ? (
                                  <KeyboardArrowUpIcon />
                                ) : (
                                  <KeyboardArrowDownIcon />
                                )}
                              </IconButton>
                            </TableCell>
                            <TableCell />
                            <TableCell>
                              <strong>{sectionTitle}</strong>
                              {sectionDescription ? (
                                <div>
                                  {sectionDescriptionMain ||
                                    (!sectionExampleWords
                                      ? sectionDescription
                                      : "")}
                                  {sectionExampleWords ? (
                                    <span style={{ display: "block" }}>
                                      <strong>Example Words:</strong>
                                      {` ${sectionExampleWords}`}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell
                              align="right"
                              style={{ whiteSpace: "nowrap" }}
                            >
                              {sectionRules.length > 0 ? (
                                <PatternButton
                                  rules={sectionRules}
                                  size="medium"
                                />
                              ) : null}
                            </TableCell>
                            <TableCell
                              align="right"
                              style={{ whiteSpace: "nowrap" }}
                            >
                              {sectionStatus}
                            </TableCell>
                            <TableCell
                              align="right"
                              style={{ whiteSpace: "nowrap" }}
                            >
                              {sectionButton}
                            </TableCell>
                          </TableRow>
                        )}
                        {isCurrentSectionExpanded && (
                          <ProgressListItem
                            lesson={lesson}
                            progress={progress}
                            showButtons={student ? false : true}
                            patternRules={lessonRules}
                            recommendedLessonId={recommendedLessonId}
                          />
                        )}
                      </React.Fragment>
                    );
                  });
                })()}
              </>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
