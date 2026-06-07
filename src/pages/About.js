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

export default function About() {
  const classes = useStyles();

  return (
    <Box className={classes.page}>
      <Container maxWidth="md">
        <Paper elevation={2} className={classes.card}>
          <Typography variant="h4" className={classes.title}>
            About Sound Spell Type Online
          </Typography>

          <Typography variant="body1" className={classes.paragraph}>
            Sound Spell Type Online teaches spelling and touch-typing together
            phonetically as part of a Structured Literacy approach.
          </Typography>

          <Typography variant="body1" className={classes.paragraph}>
            Sound Spell Type Online is available free of charge.
          </Typography>

          <Typography variant="body1" className={classes.paragraph}>
            Sound Spell Type Online was designed by Dr. Mark Rogers Ed.D., a
            retired Special Education Teacher and Reading Therapist, and an
            adult with dyslexia himself.
          </Typography>

          <Typography variant="body1" className={classes.paragraph}>
            The program was developed in Dr. Rogers&apos; Reading Therapy
            practice to focus on what he saw as two crucial, yet often
            neglected, needs of children with dyslexia. The first is to have a
            firm enough grasp of English spelling patterns to effectively use a
            computer to write without over-reliance on spell check. The second
            is having sufficient speed and accuracy in touch-typing to use a
            computer to write at a speed that does not slow down the writing
            process.
          </Typography>

          <Typography variant="body1" className={classes.paragraph}>
            Sound Spell Type Online starts by focusing on both simple spelling
            patterns (CVC) using real words and on the Home Row keys of the
            keyboard. The program then expands out systematically through
            multi-syllable words on the entire letter keyboard.
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
}
