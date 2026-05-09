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

export default function ProgressListItem({
  lesson,
  progress,
  showButtons,
  patternRules,
}) {
  const REQUIRED_ACCURACY_FOR_CHECKMARK = 90;
  const REQUIRED_ACCURACY_FOR_LESSON_COMPLETION = 100;
  const [open, setOpen] = useState(false);

  const classes = useStyles();

  // Total active words for this lesson (mirrors what the lesson engine uses).
  const totalLessonWords = buildActiveLessonWords(
    lesson?.words,
    lesson?.lesson_id,
  ).length;

  // Used only for checkmark / completed status (best single-session score).
  const getLevelAccuracy = (levelProgress) => {
    const rawPercent = Number(levelProgress?.high_score) || 0;
    return Math.max(0, Math.min(100, rawPercent));
  };

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

  const activeLevelIndexes = LEVELS.map((_, index) => index);

  const isInProgress = activeLevelIndexes.some((index) => {
    const levelProgress = progress[index] || {};
    return levelProgress.completed_words > 0 || levelProgress.completed;
  });

  const hasCheckmark = activeLevelIndexes.every((index) => {
    const levelProgress = progress[index] || {};
    return getLevelAccuracy(levelProgress) >= REQUIRED_ACCURACY_FOR_CHECKMARK;
  });

  const isCompleted = activeLevelIndexes.every((index) => {
    const levelProgress = progress[index] || {};
    return (
      getLevelAccuracy(levelProgress) >= REQUIRED_ACCURACY_FOR_LESSON_COMPLETION
    );
  });

  const status = hasCheckmark ? (
    <CheckCircleIcon color="primary" />
  ) : isInProgress ? (
    "In progress"
  ) : (
    "Not started"
  );

  const lessonButtonStyle = { fontSize: "0.6875rem", padding: "2px 8px" };

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
        </TableCell>
        <TableCell>{lesson.description || lesson.title}</TableCell>
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
                    const levelAccuracy = getLevelAccuracy(levelProgress);
                    const isCompleted =
                      levelAccuracy >= REQUIRED_ACCURACY_FOR_CHECKMARK;
                    const isInProgress =
                      (levelProgress.completed_words > 0 ||
                        levelProgress.completed) &&
                      !isCompleted;

                    var levelStatus;
                    if (isCompleted) {
                      levelStatus = <CheckCircleIcon color="primary" />;
                    } else if (isInProgress) {
                      levelStatus = "In Progress";
                    } else {
                      levelStatus = "Not Started";
                    }
                    const levelPercent =
                      getLevelWordsCorrectPercent(levelProgress);
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
