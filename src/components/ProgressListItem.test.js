import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ProgressListItem from "./ProgressListItem";

jest.mock("./PatternButton", () => () => null);

const baseLesson = {
  lesson_id: "1.3",
  title: "Lesson 1.3",
  description: "Lesson 1.3",
  words: ["CAT", "DOG", "HAT"],
};

function renderProgressListItem(progress) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <ProgressListItem
            lesson={baseLesson}
            progress={progress}
            showButtons={true}
            patternRules={[]}
          />
        </tbody>
      </table>
    </MemoryRouter>,
  );
}

describe("ProgressListItem", () => {
  test("shows in progress instead of a checkmark when all levels are passed but the lesson is not completed", () => {
    const progress = {
      0: {
        completed: false,
        completed_words: 0,
        correct_words: ["CAT"],
        score: 0,
        high_score: 100,
      },
      1: {
        completed: false,
        completed_words: 0,
        correct_words: ["DOG"],
        score: 0,
        high_score: 90,
      },
      2: {
        completed: false,
        completed_words: 0,
        correct_words: ["HAT"],
        score: 0,
        high_score: 90,
      },
    };

    const { container } = renderProgressListItem(progress);

    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Continue")).toBeInTheDocument();
    expect(
      container.querySelector("svg[data-testid='CheckCircleIcon']"),
    ).toBeNull();

    fireEvent.click(screen.getByLabelText("expand row"));

    expect(screen.getAllByText("In Progress")).toHaveLength(3);
  });

  test("does not show checkmark when completed flags are true but words-correct accuracy is low", () => {
    const progress = {
      0: {
        completed: true,
        completed_words: 0,
        correct_words: ["CAT"],
        score: 0,
        high_score: 100,
      },
      1: {
        completed: true,
        completed_words: 0,
        correct_words: ["DOG"],
        score: 0,
        high_score: 100,
      },
      2: {
        completed: true,
        completed_words: 0,
        correct_words: ["HAT"],
        score: 0,
        high_score: 100,
      },
    };

    const { container } = renderProgressListItem(progress);

    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(
      container.querySelector("svg[data-testid='CheckCircleIcon']"),
    ).toBeNull();

    fireEvent.click(screen.getByLabelText("expand row"));

    expect(screen.getAllByText("In Progress")).toHaveLength(3);
  });

  test("shows a competence milestone badge when a lesson is mastered", () => {
    const progress = {
      0: {
        completed: true,
        completed_words: 0,
        correct_words: ["CAT", "DOG", "HAT"],
        score: 0,
        high_score: 100,
      },
      1: {
        completed: true,
        completed_words: 0,
        correct_words: ["CAT", "DOG", "HAT"],
        score: 0,
        high_score: 100,
      },
      2: {
        completed: true,
        completed_words: 0,
        correct_words: ["CAT", "DOG", "HAT"],
        score: 0,
        high_score: 100,
      },
    };

    renderProgressListItem(progress);

    expect(screen.getByText("Part complete")).toBeInTheDocument();
    expect(screen.queryByText("Continue")).toBeNull();
    expect(screen.queryByText("In progress")).toBeNull();
    expect(screen.queryByText("Start")).toBeNull();
  });
});
