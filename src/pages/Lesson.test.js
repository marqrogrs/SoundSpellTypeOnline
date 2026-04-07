import React from "react";
import { render, fireEvent, wait } from "@testing-library/react";
import Lesson from "./Lesson";
import { LessonContext } from "../providers/LessonProvider";

// ── external dependencies ────────────────────────────────────────────────────

jest.mock("react-router-dom", () => ({
  useParams: () => ({ lesson: "2.4" }),
  useHistory: () => ({ push: jest.fn() }),
  Prompt: () => null,
}));

jest.mock("notistack", () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}));

jest.mock("../firebase", () => ({
  db: { collection: jest.fn() },
}));

jest.mock("../util/Audio", () => ({
  primeAudioPlayback: jest.fn().mockResolvedValue(true),
  SPEECH_RATE: 1,
  terminateAudio: jest.fn(),
  setPlayAudio: jest.fn(),
}));

// Mock OutputWord to immediately open the answer field (no real audio needed).
jest.mock("../components/OutputWord", () => {
  const React = require("react");
  return function MockOutputWord({ onFlowEvent }) {
    React.useEffect(() => {
      if (typeof onFlowEvent === "function") {
        onFlowEvent({ phase: "flow-ready-for-input" });
      }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="output-word" />;
  };
});

jest.mock("../components/Keyboard", () => () => null);
jest.mock("../components/LevelPicker", () => () => null);
jest.mock("../components/LessonProgress", () => () => null);
jest.mock("../components/SpeechRateFab", () => () => null);

// ── test helpers ─────────────────────────────────────────────────────────────

const MOCK_LESSON = {
  lesson: {
    lesson_id: "2.4",
    lesson_section: "1",
    words: ["DID", "PIT"],
  },
  level: 0,
  progress: {
    0: { score: 0, completed_words: 0, high_score: 0, completed: false },
    1: { score: 0, completed_words: 0, high_score: 0, completed: false },
    2: { score: 0, completed_words: 0, high_score: 0, completed: false },
  },
};

function renderLesson(contextOverrides = {}) {
  const mockSetLevel = jest.fn();
  const mockSaveProgress = jest.fn().mockResolvedValue();
  const mockSetProgress = jest.fn();
  const mockUpdateScore = jest.fn();
  const mockSetLesson = jest.fn();

  const contextValue = {
    currentLesson: MOCK_LESSON,
    currentLessonLevel: 0,
    currentLessonProgress: MOCK_LESSON.progress,
    lessonsLoading: false,
    currentLessonLoading: false,
    setLesson: mockSetLesson,
    setProgress: mockSetProgress,
    updateScore: mockUpdateScore,
    saveProgress: mockSaveProgress,
    setLevel: mockSetLevel,
    ...contextOverrides,
  };

  const utils = render(
    <LessonContext.Provider value={contextValue}>
      <Lesson />
    </LessonContext.Provider>,
  );

  const startLesson = () => fireEvent.click(utils.getByText(/start lesson/i));

  const getTextarea = () => document.querySelector("textarea");

  const typeWord = (word) =>
    fireEvent.change(getTextarea(), { target: { value: word } });

  const pressEnter = () => fireEvent.keyDown(getTextarea(), { key: "Enter" });

  return {
    ...utils,
    mockSetLevel,
    mockSaveProgress,
    mockSetProgress,
    mockUpdateScore,
    startLesson,
    typeWord,
    pressEnter,
    getTextarea,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Lesson – word submission", () => {
  test("answer field is locked until cue completes, then opens", () => {
    const { startLesson, getTextarea } = renderLesson();

    startLesson();

    // MockOutputWord fires flow-ready-for-input immediately after mount,
    // so the textarea should now be writable (readOnly=false).
    expect(getTextarea().readOnly).toBe(false);
  });

  test("submitting word 1 calls setProgress(1) and clears the input", async () => {
    const { startLesson, typeWord, pressEnter, getTextarea, mockSetProgress } =
      renderLesson();

    startLesson();
    typeWord("DID");
    pressEnter();

    await wait(() => {
      expect(mockSetProgress).toHaveBeenCalledWith(1, 5);
      expect(getTextarea().value).toBe("");
    });
  });

  test("submitting the last word calls saveProgress then setLevel(1)", async () => {
    const {
      startLesson,
      typeWord,
      pressEnter,
      getTextarea,
      mockSetLevel,
      mockSaveProgress,
    } = renderLesson();

    startLesson();

    // Submit word 1
    typeWord("DID");
    pressEnter();
    await wait(() => expect(getTextarea().value).toBe(""));

    // Submit word 2 (last word in lesson)
    typeWord("PIT");
    pressEnter();

    await wait(() => {
      expect(mockSaveProgress).toHaveBeenCalled();
      expect(mockSetLevel).toHaveBeenCalledWith(1);
    });
  });

  test("after level advances the lesson auto-restarts word 1", async () => {
    const {
      startLesson,
      typeWord,
      pressEnter,
      getTextarea,
      mockSaveProgress,
      mockSetLevel,
    } = renderLesson();

    startLesson();

    typeWord("DID");
    pressEnter();
    await wait(() => expect(getTextarea().value).toBe(""));

    typeWord("PIT");
    pressEnter();

    await wait(() => {
      expect(mockSaveProgress).toHaveBeenCalled();
      expect(mockSetLevel).toHaveBeenCalledWith(1);
      // Textarea should be cleared and writable again (new level cue started)
      expect(getTextarea().value).toBe("");
      expect(getTextarea().readOnly).toBe(false);
    });
  });

  test("last word saves the updated progress snapshot", async () => {
    const updatedProgress = {
      0: { score: 0, completed_words: 0, high_score: 10, completed: true },
      1: { score: 0, completed_words: 0, high_score: 0, completed: false },
      2: { score: 0, completed_words: 0, high_score: 0, completed: false },
    };

    const injectedSetProgress = jest
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(updatedProgress);

    const { startLesson, typeWord, pressEnter, mockSaveProgress } =
      renderLesson({
        setProgress: injectedSetProgress,
      });

    startLesson();

    typeWord("DID");
    pressEnter();

    typeWord("PIT");
    pressEnter();

    await wait(() => {
      expect(injectedSetProgress).toHaveBeenLastCalledWith(2, 5);
      expect(mockSaveProgress).toHaveBeenCalledWith(updatedProgress);
    });
  });

  test("typing before cue completes has no effect on the answer field", () => {
    // Before startLesson, enableInput is false and processAnswerKey guards all keys.
    const { getTextarea } = renderLesson();
    // Do NOT call startLesson — lesson is not started, input must be blocked.
    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "DID" } });
    expect(textarea.value).toBe("");
  });
});
