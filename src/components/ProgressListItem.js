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

import { LEVELS } from "../util/constants";

import { useStyles } from "../styles/material";

export default function ProgressListItem({ lesson, progress, showButtons }) {
  const REQUIRED_ACCURACY_FOR_CHECKMARK = 90;
  const [open, setOpen] = useState(false);
  const hasWords = Array.isArray(lesson?.words) && lesson.words.length > 0;
  const scoringWordCount = hasWords ? lesson.words.length : 0;

  const classes = useStyles();

  const getLevelAccuracy = (levelProgress, levelIndex) => {
    const highestPossibleScore = scoringWordCount * (levelIndex + 1) * 5;
    if (!highestPossibleScore) {
      return 0;
    }
    const boundedHighScore = Math.min(
      Number(levelProgress?.high_score) || 0,
      highestPossibleScore,
    );
    return (boundedHighScore / highestPossibleScore) * 100;
  };

  const activeLevelIndexes = LEVELS.map((_, index) => index);

  const isInProgress = activeLevelIndexes.some((index) => {
    const levelProgress = progress[index] || {};
    return levelProgress.completed_words > 0 || levelProgress.completed;
  });

  const finalLevelIndex =
    activeLevelIndexes[activeLevelIndexes.length - 1] || 0;
  const finalLevel = progress[finalLevelIndex] || {};
  const isCompleted =
    getLevelAccuracy(finalLevel, finalLevelIndex) >=
    REQUIRED_ACCURACY_FOR_CHECKMARK;

  const status = isCompleted ? (
    <CheckCircleIcon color="primary" />
  ) : isInProgress || finalLevel.completed ? (
    "In progress"
  ) : (
    "Not started"
  );

  const button = isCompleted ? null : isInProgress || finalLevel.completed ? (
    <Link to={`/lessons/${lesson.lesson_id}`}>
      <Button color="primary" variant="contained">
        Continue
      </Button>
    </Link>
  ) : (
    <Link to={`/lessons/${lesson.lesson_id}`}>
      <Button color="primary" variant="outlined">
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
        <TableCell align="right">{status}</TableCell>
        <TableCell align="right">{showButtons && button}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={5}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box margin={1}>
              <Table size="small" aria-label="purchases">
                <TableHead>
                  <TableRow>
                    <TableCell>Level</TableCell>
                    <TableCell>High Score</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activeLevelIndexes.map((i) => {
                    const levelProgress = progress[i] || {};
                    const levelAccuracy = getLevelAccuracy(levelProgress, i);
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
                    const highest_possible_score =
                      scoringWordCount * (i + 1) * 5;
                    const boundedHighScore = Math.min(
                      Number(levelProgress.high_score) || 0,
                      highest_possible_score,
                    );
                    const levelPercent = highest_possible_score
                      ? (boundedHighScore / highest_possible_score) * 100
                      : 0;
                    return (
                      <TableRow key={`${lesson.lesson_id}.${i}`}>
                        <TableCell component="th" scope="row">
                          {i + 1}
                        </TableCell>
                        <TableCell>{levelPercent.toFixed(0)}%</TableCell>
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
