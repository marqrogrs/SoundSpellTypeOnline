import React from "react";
import { render, fireEvent, wait, cleanup } from "@testing-library/react";
import CustomLesson from "./CustomLesson";
import { UserContext } from "../providers/UserProvider";

jest.setTimeout(15000);

afterEach(() => {
  window.localStorage.removeItem("soundspeller.wordInfoTalkEnabled");
  window.onbeforeunload = null;
  jest.clearAllMocks();
  cleanup();
});

jest.mock("react-router-dom", () => ({
  useParams: () => ({ lessonId: "custom-1" }),
  useHistory: () => ({ push: jest.fn() }),
  Prompt: () => null,
}));

jest.mock("notistack", () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}));

jest.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    user: { uid: "student-1" },
    isEducator: false,
  }),
}));

jest.mock("../util/customLessonHelpers", () => ({
  getCustomLesson: jest.fn().mockResolvedValue({
    id: "custom-1",
    name: "Mock Custom Lesson",
    words: ["DID", "PIT"],
    difficultyLevels: [1, 2, 3],
  }),
  startCustomLessonAttempt: jest.fn().mockResolvedValue("progress-doc-1"),
  updateCustomLessonProgress: jest.fn().mockResolvedValue(undefined),
  completeCustomLessonAttempt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../firebase", () => ({
  firestore: {
    FieldValue: {
      arrayUnion: jest.fn((value) => value),
    },
  },
}));

jest.mock("../util/Audio", () => ({
  primeAudioPlayback: jest.fn().mockResolvedValue(true),
  speakText: jest.fn().mockResolvedValue(true),
  stopSpeaking: jest.fn(),
  setPlayAudio: jest.fn(),
}));

jest.mock("../util/wordDefinitionLookup", () => ({
  lookupWordDefinition: jest.fn().mockResolvedValue({
    definition: "A mock definition.",
    exampleSentence: "A mock example sentence.",
    partOfSpeech: "noun",
  }),
}));

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

function renderCustomLesson() {
  return render(
    <UserContext.Provider
      value={{ userData: { email: "student@example.com" } }}
    >
      <CustomLesson />
    </UserContext.Provider>,
  );
}

describe("CustomLesson Talk popup", () => {
  test("popup Talk uses speech and Repeat stops it safely", async () => {
    const utils = renderCustomLesson();
    const { speakText, stopSpeaking, setPlayAudio } = require("../util/Audio");

    fireEvent.click(await utils.findByText(/start lesson/i));

    const showButton = await utils.findByRole("button", { name: /^show$/i });
    fireEvent.click(showButton);

    const wordPeek = await utils.findByRole("button", {
      name: /show definition and sentence/i,
    });
    fireEvent.click(wordPeek);

    await utils.findByText(/Definition:/i);

    speakText.mockClear();
    stopSpeaking.mockClear();
    setPlayAudio.mockClear();

    fireEvent.click(utils.getByRole("button", { name: /^Talk$/i }));

    await wait(() => {
      expect(setPlayAudio).toHaveBeenCalledWith(true);
      expect(speakText).toHaveBeenCalledTimes(1);
      expect(String(speakText.mock.calls[0][0] || "")).toContain("Word: DID");
      expect(stopSpeaking).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(utils.getByRole("button", { name: /repeat/i }));

    await wait(() => {
      expect(stopSpeaking).toHaveBeenCalledTimes(2);
    });
  });

  test("popup Talk is hidden when kill switch is disabled", async () => {
    window.localStorage.setItem("soundspeller.wordInfoTalkEnabled", "false");
    try {
      const utils = renderCustomLesson();

      fireEvent.click(await utils.findByText(/start lesson/i));

      const showButton = await utils.findByRole("button", { name: /^show$/i });
      fireEvent.click(showButton);

      const wordPeek = await utils.findByRole("button", {
        name: /show definition and sentence/i,
      });
      fireEvent.click(wordPeek);

      await utils.findByText(/Definition:/i);
      expect(utils.queryByRole("button", { name: /^Talk$/i })).toBeNull();
    } finally {
      window.localStorage.removeItem("soundspeller.wordInfoTalkEnabled");
    }
  });
});
