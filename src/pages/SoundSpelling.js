import React from "react";
import { Box, Container, Paper, Typography } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import sstoWordMismatchedVideo from "../media/SSTO - Word - mismatched.m4v";
import sstoWordMismatchedVideoMov from "../media/SSTO - Word - mismatched.mov";

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
  video: {
    width: "100%",
    maxWidth: 760,
    borderRadius: 12,
    marginBottom: theme.spacing(2),
    border: "1px solid rgba(13, 71, 161, 0.2)",
    backgroundColor: "#000",
  },
}));

const difficultyLevelOne = [
  "Spoken - First, one phoneme (speech sound) at a time, and then the whole word spoken as normal.",
  "Written - One grapheme (letter or group of letters) displayed at a time while its corresponding phoneme is spoken.",
  'Keyboard Animation Visual Aid - You see the keys "being pushed" on the on-screen keyboard that are used to type each grapheme.',
];

const difficultyLevelTwo = [
  "Spoken - First, one phoneme (speech sound) at a time, and then the whole word spoken as normal.",
  'Keyboard Animation Visual Aid - You see the keys "being pushed" on the on-screen keyboard that are used to type each grapheme.',
];

const difficultyLevelThree = [
  "Spoken - First, one phoneme (speech sound) at a time, and then the whole word spoken as normal.",
];

export default function SoundSpelling() {
  const classes = useStyles();

  return (
    <Box className={classes.page}>
      <Container maxWidth="md">
        <Paper elevation={2} className={classes.card}>
          <Typography variant="h4" className={classes.title}>
            Spelling Instruction
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Using Sound Spell Type Online for Spelling.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Where To Begin?
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Start at the Beginning:
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            If in doubt, start at the beginning and work your way up, even if
            the words in the first lesson are a review for you. This gives you a
            chance to learn how to use the program. It takes concentration and
            practice listening to words phoneme by phoneme (sound by sound) and
            then typing them. So this will give you a chance to get used to it.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Start Further Along:
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            If not using the program for Touch-Typing, and you have knowledge,
            or guidance, as to spelling level, then start further along in the
            program as appropriate.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Focus on Individual Lessons:
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            You may wish to focus on a Part (group of lessons) or an individual
            lesson, corresponding to the spelling patterns that you are
            currently working on in school or with a reading specialist.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Create Custom Lessons:
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            Create Custom Lessons from words directly from school lessons or
            from a reading specialist.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Doing the Lessons.
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            Each lesson is made up of words with targeted spelling patterns. The
            words are presented to you one at a time. You then type the word in
            response, remembering to use the correct finger for each letter key.
            Then simply press the Return / Enter key with your right pinky
            finger. Note that the Delete key (also pressed with the right pinky
            finger) works so that before you press Return / Enter you can fix
            any typing mistakes you may have made.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Extra Supports:
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            While doing the lesson you can Repeat, or even Skip, words you have
            difficulty with. And for more help, you can also have the word shown
            to you (Word button) again and even defined (click underlined word)
            and used in a sentence.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Lesson Difficulty Levels:
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            Learning to spell involves making the connection between individual
            speech sounds of words (phonemes) with the letter, or groups of
            letters (graphemes) that represent each sound. Sound Spell Type
            Online, unlike other programs designed for Touch-Typing instruction,
            lays out the word phoneme by phoneme and not just letter by letter.
            This is what is at the heart of the program.
          </Typography>
          <video className={classes.video} controls preload="metadata">
            <source src={sstoWordMismatchedVideo} type="video/mp4" />
            <source src={sstoWordMismatchedVideoMov} type="video/quicktime" />
            Your browser does not support the video tag.
          </video>

          <Typography variant="h6" className={classes.sectionTitle}>
            Difficulty Level 1
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            At difficulty Level 1, before asking you to type the word, the word
            is presented to you in three ways:
          </Typography>
          {difficultyLevelOne.map((line) => (
            <Typography
              key={line}
              variant="body1"
              className={classes.paragraph}
            >
              {line}
            </Typography>
          ))}

          <Typography variant="h6" className={classes.sectionTitle}>
            Difficulty Level 2
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            At difficulty Level 2, before asking you to type the word, the word
            is presented to you in two ways:
          </Typography>
          {difficultyLevelTwo.map((line) => (
            <Typography
              key={line}
              variant="body1"
              className={classes.paragraph}
            >
              {line}
            </Typography>
          ))}

          <Typography variant="h6" className={classes.sectionTitle}>
            Difficulty Level 3
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            At difficulty Level 3, before asking you to type the word, the word
            is presented to you in one way only:
          </Typography>
          {difficultyLevelThree.map((line) => (
            <Typography
              key={line}
              variant="body1"
              className={classes.paragraph}
            >
              {line}
            </Typography>
          ))}

          <Typography variant="h6" className={classes.sectionTitle}>
            Mastery:
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            Mastery of a lesson means successfully typing 90 percent of the
            words in the lesson correctly at Difficulty Level 3.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Choosing a Difficulty Level:
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            Please note that being successful at Level 3 can be challenging
            because you are being asked to listen to the individual speech
            sounds without any visual support. This can be difficult if you are
            not used to listening to words phoneme by phoneme. So, although, you
            can skip levels 1 and 2 and just go on to mastery at Level 3, it is
            usually a good idea, or even necessary, to start at Level 1.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Best Practice for Reinforcing Mastery.
          </Typography>
          <Typography variant="body1" className={classes.paragraph}>
            When you type in each word, say each phoneme (speech sound) aloud as
            you type the keys of each grapheme (letter or group of letters).
            This is great for reinforcing the connection.
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
}
