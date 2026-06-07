import React, { useState } from "react";
import { useAuth } from "../hooks/useAuth";

import Grid from "@material-ui/core/Grid";
import TextField from "@material-ui/core/TextField";
import {
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@material-ui/core";
import Button from "@material-ui/core/Button";

import { useStyles } from "../styles/material";
import { useFormik } from "formik";

const ROLE_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "parent", label: "Home School Parent" },
  { value: "tutor", label: "Tutor/Reading Specialist" },
  { value: "educator", label: "Teacher" },
  { value: "schoolAdmin", label: "School Admin" },
];

export default function EducatorLogin() {
  const classes = useStyles();
  const [isSignUp, setIsSignUp] = useState(false);

  const auth = useAuth();

  const handleSignIn = () => {
    // swal({
    //   title: 'Donate',
    //   text: 'Would you like to donate before continuing?',
    //   buttons: ['Not today', true],
    // }).then((redirectToPaypal) => {
    //   if (redirectToPaypal) {
    //     window.open(PAYPAL_URL, '_blank')
    //   }
    auth.signInWithEmailAndPassword(
      formik.values.email,
      formik.values.password,
    );
    // })
  };

  const validate = (values) => {
    const errors = {};
    const { firstName, lastName, role, email, password, confirmPassword } =
      values;

    if (!email) {
      errors.email = "Required";
    }
    if (!password) {
      errors.password = "Required";
    } else if (isSignUp && password.length < 6) {
      errors.password = "Password must be 6+ characters";
    }
    if (isSignUp) {
      if (!firstName) {
        errors.firstName = "Required";
      }
      if (!lastName) {
        errors.lastName = "Required";
      }
      if (!role) {
        errors.role = "Required";
      }
      if (!confirmPassword) {
        errors.confirmPassword = "Required";
      } else if (password !== confirmPassword) {
        errors.confirmPassword = "Confirmation does not match";
      }
    }

    return errors;
  };

  const formik = useFormik({
    initialValues: {
      firstName: "",
      lastName: "",
      role: "student",
      email: "",
      password: "",
      confirmPassword: "",
    },
    validate,
    onSubmit: (values) => {
      const { firstName, lastName, role, email, password } = values;
      if (!isSignUp) {
        setIsSignUp(true);
      } else {
        auth.createUserWithEmailAndPassword(email, password, {
          firstName,
          lastName,
          role,
        });
      }
    },
  });

  return (
    <div id="landing-container" className="landing-only">
      <div className="right-panel">
        <form>
          <Grid
            container
            direction="column"
            alignItems="center"
            className={classes.signUpForm}
            spacing={2}
          >
            <Grid item>
              <Typography>Welcome to Sound Spell Type Online!</Typography>
            </Grid>
            {isSignUp && (
              <>
                <Grid item>
                  <TextField
                    name="firstName"
                    label="First Name"
                    variant="outlined"
                    color="primary"
                    value={formik.values.firstName}
                    error={Boolean(formik.errors.firstName)}
                    helperText={formik.errors.firstName}
                    onChange={formik.handleChange}
                  ></TextField>
                </Grid>
                <Grid item>
                  <TextField
                    name="lastName"
                    label="Last Name"
                    variant="outlined"
                    color="primary"
                    value={formik.values.lastName}
                    error={Boolean(formik.errors.lastName)}
                    helperText={formik.errors.lastName}
                    onChange={formik.handleChange}
                  ></TextField>
                </Grid>
                <Grid item style={{ minWidth: 240 }}>
                  <FormControl variant="outlined" fullWidth>
                    <InputLabel>Role</InputLabel>
                    <Select
                      name="role"
                      value={formik.values.role}
                      onChange={formik.handleChange}
                      label="Role"
                      error={Boolean(formik.errors.role)}
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </>
            )}
            <Grid item>
              <TextField
                name="email"
                label="Email / Username"
                variant="outlined"
                color="primary"
                value={formik.values.email}
                error={Boolean(formik.errors.email)}
                helperText={formik.errors.email}
                onChange={formik.handleChange}
              ></TextField>
            </Grid>
            <Grid item>
              <TextField
                name="password"
                label="Password"
                variant="outlined"
                color="primary"
                type="password"
                value={formik.values.password}
                error={Boolean(formik.errors.password)}
                helperText={formik.errors.password}
                onChange={formik.handleChange}
              ></TextField>
            </Grid>
            {isSignUp && (
              <Grid item>
                <TextField
                  name="confirmPassword"
                  label="Confirm Password"
                  variant="outlined"
                  color="primary"
                  type="password"
                  value={formik.values.confirmPassword}
                  error={Boolean(formik.errors.confirmPassword)}
                  helperText={formik.errors.confirmPassword}
                  onChange={formik.handleChange}
                ></TextField>
              </Grid>
            )}
            {!isSignUp && (
              <Grid item>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleSignIn}
                >
                  Sign In
                </Button>
              </Grid>
            )}

            <Grid item>
              <Button
                variant={isSignUp ? "contained" : "outlined"}
                color="primary"
                onClick={formik.handleSubmit}
                size="small"
              >
                {isSignUp ? "Create Account" : "Sign Up"}
              </Button>
            </Grid>
            {!isSignUp && (
              <Button color="primary" onClick={auth.resetPassword}>
                Reset Password
              </Button>
            )}

            {isSignUp && (
              <div
                className={classes.textButton}
                onClick={() => setIsSignUp(false)}
              >
                Return to Sign In
              </div>
            )}
          </Grid>
        </form>
      </div>
    </div>
  );
}
