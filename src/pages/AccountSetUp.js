import React from "react";
import { Box, Container, Paper, Typography } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";

const useStyles = makeStyles((theme) => ({
  page: {
    minHeight: "calc(100vh - 64px)",
    background:
      "linear-gradient(180deg, rgba(13,71,161,0.08) 0%, rgba(25,118,210,0.04) 100%)",
    paddingTop: theme.spacing(4),
    paddingBottom: theme.spacing(6),
  },
  card: {
    padding: theme.spacing(4),
    borderRadius: 16,
    border: "1px solid rgba(13, 71, 161, 0.15)",
  },
  title: {
    color: "#002ca0",
    fontWeight: 700,
    marginBottom: theme.spacing(1.5),
  },
  paragraph: {
    color: "#1b1b1b",
    marginBottom: theme.spacing(2),
    lineHeight: 1.7,
  },
  sectionTitle: {
    color: "#0d47a1",
    fontWeight: 700,
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(1),
  },
}));

export default function AccountSetUp() {
  const classes = useStyles();

  return (
    <Box className={classes.page}>
      <Container maxWidth="md">
        <Paper elevation={2} className={classes.card}>
          <Typography variant="h4" className={classes.title}>
            Setting Up Sound Spell Type Online:
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Sign up as a Student yourself.
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            This is designed for adults with dyslexia or adult English Language
            Learners who want to learn English spelling.
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            Simply create an account choosing the Role - Student. Next, verify
            your email (in your email inbox) and then login.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Sign up as a Parent, Tutor/Reading Specialist, Teacher, School
            Admin.
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            First make an account for yourself, choosing a Role (Parent,
            Teacher, etc.). Verify your email (in your email inbox) and then
            login.
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            Once in the program, use the &ldquo;Add Student&rdquo; button and
            create an account for each of your Children / Students. The student
            then logs in with their generated Username (firstname_lastname####)
            and the Password that you set.
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
}
