import React from "react";
import { fireEvent, render } from "@testing-library/react";
import PlacementTest from "./PlacementTest";

jest.mock("notistack", () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}));

jest.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    role: null,
    authLoaded: true,
  }),
}));

jest.mock("../firebase", () => ({
  upsertPlacementReport: jest.fn(),
  submitPublicPlacementReport: jest.fn(),
  assignPlacementTest: jest.fn(),
  getPlacementReport: jest.fn(),
  getPlacementAssignmentStatus: jest.fn(),
  getPlacementWordOverrides: jest.fn(() =>
    Promise.resolve({ data: { overrides: {} } }),
  ),
  mgmtListData: jest.fn(),
}));

jest.mock("../styles/material", () => ({
  useStyles: () => ({ textbox: "" }),
}));

jest.mock("../components/PlacementOutputWord", () => () => null);

jest.mock("../util/Audio", () => ({
  primeAudioPlayback: jest.fn(() => Promise.resolve(true)),
  playPlacementWordSequence: jest.fn(() => Promise.resolve()),
}));

jest.mock("../util/placementStorage", () => ({
  clearPendingPlacementReport: jest.fn(),
  readPendingPlacementReport: jest.fn(() => null),
  writePendingPlacementReport: jest.fn(),
}));

describe("PlacementTest", () => {
  test("does not render the answer textarea before the test starts", () => {
    const { container, getAllByText } = render(<PlacementTest />);

    // MUI v4 TextField renders the label text in both a <label> and the notched
    // <legend>, so getAllByText is used instead of getByText to avoid the
    // "multiple elements" error.  We just need to confirm the text is present.
    expect(getAllByText("Student First Name").length).toBeGreaterThan(0);
    expect(getAllByText("Proctor First Name").length).toBeGreaterThan(0);
    expect(getAllByText("Proctor Last Name").length).toBeGreaterThan(0);
    expect(getAllByText("Proctor Email").length).toBeGreaterThan(0);
    expect(container.querySelector("#placement-answer-input")).toBeNull();
  });

  test("allows typing Student First Name without pooled-event crash", () => {
    const { container } = render(<PlacementTest />);

    // Select the first visible (non-aria-hidden) input — that is the
    // Student First Name field in the public intake form.
    const visibleInputs = container.querySelectorAll(
      'input:not([aria-hidden="true"])',
    );
    const firstNameInput = visibleInputs[0];

    fireEvent.change(firstNameInput, { target: { value: "Alex" } });

    expect(firstNameInput.value).toBe("Alex");
  });
});
