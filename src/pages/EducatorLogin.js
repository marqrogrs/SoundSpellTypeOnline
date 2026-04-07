import React, { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useHistory } from "react-router-dom";

import Grid from "@material-ui/core/Grid";
import TextField from "@material-ui/core/TextField";
import { Typography } from "@material-ui/core";
import Button from "@material-ui/core/Button";

import { useStyles } from "../styles/material";
import { useFormik } from "formik";

export default function EducatorLogin() {
  const classes = useStyles();
  const history = useHistory();
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
    auth
      .signInWithEmailAndPassword(formik.values.email, formik.values.password)
      .then(() => history.push("/"));
    // })
  };

  const validate = (values) => {
    const errors = {};
    const { email, password, confirmPassword } = values;

    if (!email) {
      errors.email = "Required";
    }
    if (!password) {
      errors.password = "Required";
    } else if (isSignUp && password.length < 6) {
      errors.password = "Password must be 6+ characters";
    }
    if (isSignUp) {
      if (!confirmPassword) {
        errors.confirmPassword = "Required";
      } else if (password !== confirmPassword) {
        errors.confirmPassword = "Confirmation does not match";
      }
    }

    // console.log(errors)
    return errors;
  };

  const formik = useFormik({
    initialValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
    validate,
    onSubmit: (values) => {
      const { email, password } = values;
      if (!isSignUp) {
        setIsSignUp(true);
      } else {
        console.log("Creating user");
        auth.createUserWithEmailAndPassword(email, password);
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
            <Grid item>
              <TextField
                name="email"
                label="Email"
                variant="outlined"
                color="primary"
                value={formik.values.email}
                error={formik.errors.email}
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
                error={formik.errors.password}
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
                  error={formik.errors.confirmPassword}
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
                variant="contained"
                color="primary"
                onClick={formik.handleSubmit}
              >
                Sign Up
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
            <Button color="primary" onClick={() => history.push("/")}>
              Go Back
            </Button>
          </Grid>
        </form>
      </div>
    </div>
  );
}
