import React, { useState, useContext } from "react";
import { UserContext } from "../providers/UserProvider";
import Modal from "@material-ui/core/Modal";
import Backdrop from "@material-ui/core/Backdrop";
import Fade from "@material-ui/core/Fade";
import Fab from "@material-ui/core/Fab";
import AddIcon from "@material-ui/icons/Add";
import FormControl from "@material-ui/core/FormControl";
import InputLabel from "@material-ui/core/InputLabel";
import MenuItem from "@material-ui/core/MenuItem";
import Select from "@material-ui/core/Select";
import Button from "@material-ui/core/Button";
import Add from "@material-ui/icons/Add";
import TextField from "@material-ui/core/TextField";

import { useStyles } from "../styles/material";
import { useFormik } from "formik";
import { triggerErrorAlert } from "../util/alerts";

export default function NewStudentForm({ fabBottom = 88 }) {
  const classes = useStyles();
  const [open, setOpen] = useState(false);
  const [addStudentLoading, setAddStudentLoading] = useState(false);
  const { addNewStudent, classrooms } = useContext(UserContext);

  const validate = (values) => {
    const errors = {};
    const { username, password, classroom, newClass, confirmPassword } = values;
    if (!username) {
      errors.username = "Required";
    } else if (!/^[a-z0-9]+$/gi.test(username)) {
      errors.username = "Username can only contain letters and numbers";
    }

    if (!classroom) {
      errors.classroom = "Required";
    }

    if (classroom === "newClass" && !newClass) {
      errors.newClass = "Required";
    } else if (newClass && !/^[a-z0-9]+$/gi.test(newClass)) {
      errors.newClass = "Class name can only contain letters and numbers";
    } else if (newClass === "newClass") {
      errors.newClass = "Invalid class name";
    }

    if (!password) {
      errors.password = "Required";
    }
    if (!confirmPassword) {
      errors.confirmPassword = "Required";
    } else if (password !== confirmPassword) {
      errors.confirmPassword = "Confirmation does not match";
    }
    // console.log(errors)
    return errors;
  };

  const formik = useFormik({
    initialValues: {
      username: "",
      classroom: "",
      newClass: "",
      password: "",
      confirmPassword: "",
    },
    validate,
    onSubmit: (values) => {
      setAddStudentLoading(true);
      const { classroom, newClass, username, password } = values;
      const studentClassroom = classroom === "newClass" ? newClass : classroom;
      addNewStudent({
        username,
        password,
        classroom: studentClassroom,
      })
        .then(() => {
          setAddStudentLoading(false);
          setOpen(false);
          formik.resetForm();
        })
        .catch((e) => {
          setAddStudentLoading(false);
          triggerErrorAlert(e.message || "Unable to add student");
        });
    },
  });

  return (
    <>
      <Fab
        color="primary"
        aria-label="add"
        style={{
          margin: 0,
          top: "auto",
          right: 20,
          bottom: fabBottom,
          left: "auto",
          position: "fixed",
        }}
        onClick={() => setOpen(true)}
      >
        <AddIcon />
      </Fab>
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
            <h2>Create new student</h2>
            <FormControl className={classes.formControl}>
              <InputLabel>Class</InputLabel>
              <Select
                name="classroom"
                label="Class"
                value={formik.values.classroom}
                onChange={formik.handleChange}
                error={Boolean(formik.errors.classroom)}
              >
                <MenuItem value="newClass" className={classes.selectConstant}>
                  + New Class
                </MenuItem>
                {classrooms &&
                  classrooms.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.id}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
            {formik.values.classroom === "newClass" && (
              <TextField
                name="newClass"
                label="New Classroom"
                variant="outlined"
                color="primary"
                margin="normal"
                error={formik.errors.newClass}
                helperText={formik.errors.newClass}
                value={formik.values.newClass}
                onChange={formik.handleChange}
              ></TextField>
            )}
            <TextField
              name="username"
              label="Username"
              variant="outlined"
              color="primary"
              margin="normal"
              error={formik.errors.username}
              helperText={formik.errors.username}
              value={formik.values.username}
              onChange={formik.handleChange}
            ></TextField>
            <TextField
              name="password"
              label="Password"
              variant="outlined"
              color="primary"
              type="password"
              margin="normal"
              error={formik.errors.password}
              helperText={formik.errors.password}
              value={formik.values.password}
              onChange={formik.handleChange}
            ></TextField>
            <TextField
              name="confirmPassword"
              label="Confirm Password"
              variant="outlined"
              color="primary"
              type="password"
              margin="normal"
              error={formik.errors.confirmPassword}
              helperText={formik.errors.confirmPassword}
              value={formik.values.confirmPassword}
              onChange={formik.handleChange}
            ></TextField>
            <Button
              variant="contained"
              color="secondary"
              onClick={formik.handleSubmit}
              disabled={
                Object.keys(formik.errors).length > 0 || addStudentLoading
              }
              startIcon={<Add />}
            >
              Add Student
            </Button>
          </div>
        </Fade>
      </Modal>
    </>
  );
}
