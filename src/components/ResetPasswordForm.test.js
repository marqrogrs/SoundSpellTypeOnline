import React from "react";
import { render, fireEvent, wait } from "@testing-library/react";
import ResetPasswordForm from "./ResetPasswordForm";

const mockResetStudentPassword = jest.fn();
const mockTriggerErrorAlert = jest.fn();

jest.mock("../firebase", () => ({
  resetStudentPassword: (...args) => mockResetStudentPassword(...args),
}));

jest.mock("../util/alerts", () => ({
  triggerErrorAlert: (...args) => mockTriggerErrorAlert(...args),
}));

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    mockResetStudentPassword.mockReset();
    mockTriggerErrorAlert.mockReset();
    mockResetStudentPassword.mockResolvedValue({ data: { status: "success" } });
  });

  test("does not submit when confirmation does not match", async () => {
    const setOpen = jest.fn();
    const { getByText } = render(
      <ResetPasswordForm student="alice" open={true} setOpen={setOpen} />,
    );

    const passwordInput = document.querySelector('input[name="password"]');
    const confirmInput = document.querySelector(
      'input[name="confirmPassword"]',
    );

    fireEvent.change(passwordInput, {
      target: { name: "password", value: "abc123" },
    });
    fireEvent.change(confirmInput, {
      target: { name: "confirmPassword", value: "different" },
    });

    const resetButton = getByText("Reset").closest("button");
    expect(resetButton).toBeDisabled();
    fireEvent.click(resetButton);

    await wait(() => {
      expect(mockResetStudentPassword).not.toHaveBeenCalled();
    });
  });

  test("submits when password and confirmation match", async () => {
    const setOpen = jest.fn();
    const { getByText } = render(
      <ResetPasswordForm student="alice" open={true} setOpen={setOpen} />,
    );

    const passwordInput = document.querySelector('input[name="password"]');
    const confirmInput = document.querySelector(
      'input[name="confirmPassword"]',
    );

    fireEvent.change(passwordInput, {
      target: { name: "password", value: "abc123" },
    });
    fireEvent.change(confirmInput, {
      target: { name: "confirmPassword", value: "abc123" },
    });

    fireEvent.click(getByText("Reset").closest("button"));

    await wait(() => {
      expect(mockResetStudentPassword).toHaveBeenCalledWith({
        username: "alice",
        password: "abc123",
      });
      expect(setOpen).toHaveBeenCalledWith(false);
      expect(mockTriggerErrorAlert).not.toHaveBeenCalled();
    });
  });

  test("does not close modal and shows alert when API returns error payload", async () => {
    mockResetStudentPassword.mockResolvedValue({
      data: { error: "You may only reset passwords for your own students." },
    });
    const setOpen = jest.fn();
    const { getByText } = render(
      <ResetPasswordForm student="alice" open={true} setOpen={setOpen} />,
    );

    const passwordInput = document.querySelector('input[name="password"]');
    const confirmInput = document.querySelector(
      'input[name="confirmPassword"]',
    );

    fireEvent.change(passwordInput, {
      target: { name: "password", value: "abc123" },
    });
    fireEvent.change(confirmInput, {
      target: { name: "confirmPassword", value: "abc123" },
    });

    fireEvent.click(getByText("Reset").closest("button"));

    await wait(() => {
      expect(setOpen).not.toHaveBeenCalled();
      expect(mockTriggerErrorAlert).toHaveBeenCalledWith(
        "You may only reset passwords for your own students.",
      );
    });
  });

  test("does not close modal and shows alert when API request rejects", async () => {
    mockResetStudentPassword.mockRejectedValue(new Error("network down"));
    const setOpen = jest.fn();
    const { getByText } = render(
      <ResetPasswordForm student="alice" open={true} setOpen={setOpen} />,
    );

    const passwordInput = document.querySelector('input[name="password"]');
    const confirmInput = document.querySelector(
      'input[name="confirmPassword"]',
    );

    fireEvent.change(passwordInput, {
      target: { name: "password", value: "abc123" },
    });
    fireEvent.change(confirmInput, {
      target: { name: "confirmPassword", value: "abc123" },
    });

    fireEvent.click(getByText("Reset").closest("button"));

    await wait(() => {
      expect(setOpen).not.toHaveBeenCalled();
      expect(mockTriggerErrorAlert).toHaveBeenCalledWith("network down");
    });
  });
});
