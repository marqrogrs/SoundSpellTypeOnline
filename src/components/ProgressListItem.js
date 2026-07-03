import React, { useState } from "react";
import { Link } from "react-router-dom";
import Box from "@material-ui/core/Box";
import Collapse from "@material-ui/core/Collapse";
import IconButton from "@material-ui/core/IconButton";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import KeyboardArrowDownIcon from "@material-ui/icons/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@material-ui/icons/KeyboardArrowUp";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import Button from "@material-ui/core/Button";
import PatternButton from "./PatternButton";

import { LEVELS } from "../util/constants";
import { buildActiveLessonWords } from "../util/functions";

import { useStyles } from "../styles/material";

const REQUIRED_ACCURACY_FOR_CHECKMARK = 90;

function getMilestoneLabel(percentComplete, isCompleted, isInProgress) {
  if (isCompleted) {
    return "Part complete";
  }
  if (percentComplete >= 75) {
    return "Nearly there";
  }
  if (percentComplete >= 50) {
    return "Halfway there";
  }
  if (percentComplete >= 25) {
    return "Building mastery";
  }
  if (isInProgress) {
    return "Getting started";
  }
  return "Ready to begin";
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

export default function ProgressListItem({
  lesson,
  progress,
  showButtons,
  patternRules,
  recommendedLessonId,
}) {
  const [open, setOpen] = useState(false);

  const classes = useStyles();

  // Total active words for this lesson (mirrors what the lesson engine uses).
  const totalLessonWords = buildActiveLessonWords(
    lesson?.words,
    lesson?.lesson_id,
  ).length;

  // Unique words the student has ever spelled correctly at this level in this
  // lesson, as a percentage of the total lesson word count.
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

  const activeLevelIndexes = LEVELS.map((_, index) => index);
  const isLevelMastered = (levelProgress) =>
    getLevelWordsCorrectPercent(levelProgress) >=
    REQUIRED_ACCURACY_FOR_CHECKMARK;
  const masteryLevelIndex =
    activeLevelIndexes[activeLevelIndexes.length - 1] ?? 2;

  const isInProgress = activeLevelIndexes.some((index) => {
    const levelProgress = progress[index] || {};
    return hasLevelStarted(levelProgress);
  });

  const isCompleted = isLevelMastered(progress[masteryLevelIndex] || {});
  const masteryProgressPercent = getLevelWordsCorrectPercent(
    progress[masteryLevelIndex] || {},
  );
  const milestoneLabel = getMilestoneLabel(
    masteryProgressPercent,
    isCompleted,
    isInProgress,
  );

  const status = isCompleted ? (
    <CheckCircleIcon color="primary" />
  ) : isInProgress ? (
    "In progress"
  ) : (
    "Not started"
  );

  const lessonButtonStyle = { fontSize: "0.6875rem", padding: "2px 8px" };
  const { mainText, exampleWords } = splitExampleWords(
    lesson.description || lesson.title,
  );
  const isRecommendedLesson =
    String(recommendedLessonId || "").trim() ===
    String(lesson?.lesson_id || "").trim();

  const button = isCompleted ? null : isInProgress ? (
    <Link to={`/lessons/${lesson.lesson_id}`}>
      <Button
        color="primary"
        variant="contained"
        size="small"
        style={lessonButtonStyle}
      >
        Continue
      </Button>
    </Link>
  ) : (
    <Link to={`/lessons/${lesson.lesson_id}`}>
      <Button
        color="primary"
        variant="outlined"
        size="small"
        style={lessonButtonStyle}
      >
        Start
      </Button>
    </Link>
  );

  return (
    <>
      <TableRow className={classes.progressList}>
        <TableCell>
          <IconButton
            aria-label="expand row"
            size="small"
            onClick={() => setOpen(!open)}
          >
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell component="th" scope="row">
          {lesson.lesson_id}
          {isRecommendedLesson ? (
            <span
              style={{
                display: "inline-block",
                marginLeft: 8,
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "#1e5f99",
                backgroundColor: "#e7f1fb",
                verticalAlign: "middle",
              }}
            >
              Next Recommended
            </span>
          ) : null}
          <span
            style={{
              display: "inline-block",
              marginLeft: 8,
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: isCompleted ? "#205c3b" : "#6b4e16",
              backgroundColor: isCompleted ? "#e7f5ee" : "#fff2d8",
              verticalAlign: "middle",
            }}
          >
            {milestoneLabel}
          </span>
        </TableCell>
        <TableCell>
          {mainText ||
            (!exampleWords ? lesson.description || lesson.title : "")}
          {exampleWords ? (
            <span style={{ display: "block" }}>
              <strong>Example Words:</strong>
              {` ${exampleWords}`}
            </span>
          ) : null}
        </TableCell>
        <TableCell align="right">
          <PatternButton
            rules={patternRules}
            buttonStyle={{ fontSize: "0.6875rem", padding: "2px 8px" }}
          />
        </TableCell>
        <TableCell align="right">{status}</TableCell>
        <TableCell align="right">{showButtons && button}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={6}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box margin={1}>
              <Table size="small" aria-label="purchases">
                <TableHead>
                  <TableRow>
                    <TableCell>Level</TableCell>
                    <TableCell>Words Correct</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activeLevelIndexes.map((i) => {
                    const levelProgress = progress[i] || {};
                    const levelPercent =
                      getLevelWordsCorrectPercent(levelProgress);
                    const levelStarted = hasLevelStarted(levelProgress);
                    const isCompleted =
                      levelPercent >= REQUIRED_ACCURACY_FOR_CHECKMARK;
                    const isInProgress = levelStarted && !isCompleted;

                    var levelStatus;
                    if (isCompleted) {
                      levelStatus = <CheckCircleIcon color="primary" />;
                    } else if (isInProgress) {
                      levelStatus = "In Progress";
                    } else {
                      levelStatus = "Not Started";
                    }
                    return (
                      <TableRow key={`${lesson.lesson_id}.${i}`}>
                        <TableCell component="th" scope="row">
                          {i + 1}
                        </TableCell>
                        <TableCell>{levelPercent}%</TableCell>
                        <TableCell>{levelStatus}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}
