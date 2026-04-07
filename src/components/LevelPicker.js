import React, { useContext } from "react";
import { Typography, ButtonGroup, Button } from "@material-ui/core";
import { LEVELS } from "../util/constants";
import { LessonContext } from "../providers/LessonProvider";

export default function LevelPicker({ onSelectLevel }) {
  const { currentLesson, currentLessonLevel, setLevel } =
    useContext(LessonContext);

  const handleSelectLevel = (levelIndex) => {
    if (typeof onSelectLevel === "function") {
      onSelectLevel(levelIndex);
      return;
    }

    setLevel(levelIndex);
  };

  return (
    <>
      <Typography>Pick a level:</Typography>
      <ButtonGroup color="primary">
        {currentLesson &&
          LEVELS.map((l, index) => {
            return (
              <Button
                key={index}
                variant={
                  currentLessonLevel === index ? `contained` : `outlined`
                }
                onClick={() => handleSelectLevel(index)}
              >
                {index + 1}
              </Button>
            );
          })}
      </ButtonGroup>
    </>
  );
}
