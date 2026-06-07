import React from "react";
import { Box, Container, Paper, Typography } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import sstoKeyboardImg from "../img/SSTO Keyboard.png";
import fingerPositionsImg from "../img/fingerpositions.png";

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
  image: {
    width: "100%",
    height: "auto",
    display: "block",
    borderRadius: 12,
    border: "1px solid rgba(13, 71, 161, 0.2)",
    marginBottom: theme.spacing(2),
  },
}));

export default function TouchTyping() {
  const classes = useStyles();

  return (
    <Box className={classes.page}>
      <Container maxWidth="md">
        <Paper elevation={2} className={classes.card}>
          <Typography variant="h4" className={classes.title}>
            Typing Instruction
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Using Sound Spell Type Online for Typing:
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            First Note: When in a lesson, you will see the above on-screen
            keyboard layout. It is not meant to be typed on. It is meant to show
            what letter keys match which speech sounds (phonemes) while doing a
            lesson. Use your real keyboard to type your responses. When the word
            to spell is presented to you, you hear the word&apos;s phonemes and
            see an animation of their corresponding keys &ldquo;being
            pushed&rdquo; on the on-screen keyboard layout.
          </Typography>
          <img
            src={sstoKeyboardImg}
            alt="Sound Spell Type Online keyboard layout"
            className={classes.image}
          />

          <Typography variant="h6" className={classes.sectionTitle}>
            Best Practice for Touch-Typing:
          </Typography>
          <Typography variant="h6" className={classes.sectionTitle}>
            The Home Row:
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            The Home Row means the &ldquo;home&rdquo;, or resting, positions for
            your fingers while typing. Always have your fingers on the Home Row
            while you look at the screen; not your fingers! The Home Row keys
            for the Left Hand are the keys A, S, D, F. For the Right Hand they
            are J, K, L, ;.
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            When typing, always have your Pinky, Ring, Middle and Index finger
            on the Home Row of the keyboard. Move only the finger you are typing
            with at that moment, as shown on the Finger Positions drawing above.
            To type the letter C, for example, move only your left middle finger
            off of the D key (home) and move it down to the C key, type the C
            and return your finger to the D key again.
          </Typography>
          <img
            src={fingerPositionsImg}
            alt="Finger positions for touch typing"
            className={classes.image}
          />

          <Typography variant="h6" className={classes.sectionTitle}>
            Touch-Typing and Sound Spell Type Online:
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            Touch-Typing means typing without looking at your fingers and
            keeping resting fingers on the Home Row.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Where To Begin?
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            If you are new to Touch-Typing then start at the beginning of the
            lessons (Part 1, Lesson 1.1.). The lessons in Part 1 target, not
            only short vowel words, they start with Home Row only words and
            branch out from there. For example, the words Sad, Dad and Fad all
            appear in the first lesson. These are words with the short A sound
            and are made up of letters on the left hand Home Row. So a student,
            who has mastered short vowels but is new to Touch-Typing, should
            start at the beginning.
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
}
