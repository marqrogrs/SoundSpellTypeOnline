import React, { useState } from "react";
import Modal from "@material-ui/core/Modal";
import Backdrop from "@material-ui/core/Backdrop";
import Fade from "@material-ui/core/Fade";
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";

import { useStyles } from "../styles/material";
import { resetStudentPassword } from "../firebase";
import { triggerErrorAlert } from "../util/alerts";

export default function ResetPasswordForm({ student, open, setOpen }) {
  const classes = useStyles();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordsMatch =
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password === confirmPassword;

  const handleChange = (e) => {
    const { name, value } = e.target;
    switch (name) {
      case "password":
        setPassword(value);
        break;
      case "confirmPassword":
        setConfirmPassword(value);
        break;
      default:
        break;
    }
  };

  const handleResetPassword = async () => {
    if (!passwordsMatch) {
      return;
    }

    try {
      const res = await resetStudentPassword({ username: student, password });
      const payload = (res && res.data) || {};
      if (payload.error) {
        triggerErrorAlert(payload.error);
        return;
      }

      setOpen(false);
    } catch (error) {
      triggerErrorAlert(
        (error && error.message) || "Failed to reset password.",
      );
    }
  };

  return (
    <>
      <Modal
        className={classes.modal}
        open={open}
        onClose={() => setOpen(false)}
        closeAfterTransition
        BackdropComponent={Backdrop}
        BackdropProps={{
          timeout: 500,
        }}
      >
        <Fade in={open}>
          <div className={classes.modalPaper}>
            <h2>Reset Password</h2>
            <TextField
              name="password"
              label="Password"
              variant="outlined"
              color="primary"
              type="password"
              value={password}
              onChange={handleChange}
            ></TextField>
            <TextField
              name="confirmPassword"
              label="Confirm Password"
              variant="outlined"
              color="primary"
              type="password"
              error={confirmPassword.length > 0 && password !== confirmPassword}
              helperText={
                confirmPassword.length > 0 && password !== confirmPassword
                  ? "Confirmation does not match"
                  : ""
              }
              value={confirmPassword}
              onChange={handleChange}
            ></TextField>
            <Button
              variant="contained"
              color="secondary"
              onClick={handleResetPassword}
              disabled={!passwordsMatch}
            >
              Reset
            </Button>
          </div>
        </Fade>
      </Modal>
    </>
  );
}
