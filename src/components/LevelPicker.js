import React, { useContext } from "react";
import { Typography, ButtonGroup, Button } from "@material-ui/core";
import { LEVELS } from "../util/constants";
import { LessonContext } from "../providers/LessonProvider";

export default function LevelPicker({ onSelectLevel, disabled }) {
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      <Typography
        align="center"
        color="primary"
        style={{ fontWeight: 600, fontSize: 12 }}
      >
        Difficulty Level
      </Typography>
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
                disabled={disabled}
              >
                {index + 1}
              </Button>
            );
          })}
      </ButtonGroup>
    </div>
  );
}
