import React from "react";
import { render, wait } from "@testing-library/react";
import App from "./App";

// Mock Firebase to prevent it from running in the test environment.
jest.mock("./firebase", () => {
  const onAuthStateChangedMock = jest.fn((callback) => {
    // Simulate unauthenticated state synchronously
    callback(null);
    return jest.fn(); // unsubscribe
  });
  return {
    db: {},
    auth: {
      currentUser: null,
      onAuthStateChanged: onAuthStateChangedMock,
      signOut: jest.fn(() => Promise.resolve()),
      setPersistence: jest.fn(() => Promise.resolve()),
    },
    authenticateStudent: jest.fn(),
    createStudentAccount: jest.fn(),
    resetStudentPassword: jest.fn(),
  };
});

// Mock SweetAlert used in alerts utility
jest.mock("sweetalert", () => jest.fn(() => Promise.resolve()));

test("renders without crashing", () => {
  const { container } = render(<App />);
  expect(container).toBeTruthy();
});

test("shows the landing page for unauthenticated users", async () => {
  const { container } = render(<App />);
  await wait(() => {
    expect(container.querySelector("#landing-container")).toBeInTheDocument();
  });
});

test("shows Sound Spell Type Online branding on the landing page", async () => {
  const { getAllByText } = render(<App />);
  await wait(() => {
    expect(getAllByText(/Sound Spell Type Online/i).length).toBeGreaterThan(0);
  });
});

test("shows login options on the landing page", async () => {
  const { getByText } = render(<App />);
  await wait(() => {
    expect(getByText(/Kid/i)).toBeInTheDocument();
    expect(getByText(/Adult/i)).toBeInTheDocument();
  });
});

test("shows WELCOME TO text on the landing page", async () => {
  const { getByText } = render(<App />);
  await wait(() => {
    expect(getByText(/WELCOME TO/i)).toBeInTheDocument();
  });
});
