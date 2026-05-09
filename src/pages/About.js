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
  partTitle: {
    color: "#0d47a1",
    fontWeight: 700,
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(0.5),
  },
}));

const sequenceParts = [
  {
    title: "Part 1 - Short Vowels",
    body: "Short Vowels starts with the Home Row keys within real words; phoneme by phoneme. The first digraph (ck) is introduced, as well as two syllable words with the suffixes s, es, ed, en and ic.",
  },
  {
    title: "Part 2 - Blends",
    body: "Blends introduces words with consonant blends such as st-, tr-, sm-, dr-, -nd, etc.",
  },
  {
    title: "Part 3 - Consonant Teams",
    body: "Consonant Teams introduces consonant teams such as sh, th, wh, ch, tch, dge, qu, x and ng, as well as introducing the prefixes mis-, in-, un- and double consonants before suffixes -ed and -ing (top / topped / topping).",
  },
  {
    title: "Part 4 - Vowel Teams",
    body: "Vowel Teams introduces short vowel teams such as au, aw, oi, oy, ou, ow, oo, as well as introducing the prefixes con-, dis-, ex-, ad-, an-, en-, em-, and the suffixes -ful, -less, -ness, -ess, -let, -ive.",
  },
  {
    title: "Part 5 - Mixed Teams",
    body: "Mixed Teams introduces vowel/consonant teams such as R-controlled vowels (er, ir, ur, ar, or), W-controlled (wa-, wor-, war-), and soft C and G, as well as introducing the prefix non- and the suffixes -er, -est, -ine.",
  },
  {
    title: "Part 6 - E Power",
    body: "E Power introduces the powers of the letter E to influence the sounds and use of other letters. Silent E makes a short vowel long (mat / mate), makes C and G soft (dance, change), and makes L and V endings legal (able and love).",
  },
  {
    title: "Part 7 - Long Vowels",
    body: "Long Vowels focuses on long vowel sounds mostly in multisyllabic words and includes long a, e, i, o, u and y (with long i or e sounds).",
  },
  {
    title: "Part 8 - Long Vowel Teams",
    body: "Long Vowel Teams introduces long vowel teams such as ai, ay, ee, ea, igh, ie, oe, ow, oa, ew, ue.",
  },
  {
    title: "Part 9 - Expert Vowels",
    body: "Expert Vowels focuses on the less common vowel sounds such as -a in mama, -i- in radio, -y in happy, -i-ne in examine and ai-n in certain.",
  },
  {
    title: "Part 10 - Expert Teams 1",
    body: "Expert Teams 1 focuses on both consonant and consonant-vowel teams found mostly in multisyllabic words such as -ti-, -si-, and ci with the sh sound.",
  },
  {
    title: "Part 11 - Expert Teams 2",
    body: "Expert Teams 2 focuses on both consonant and consonant-vowel teams found mostly in multisyllabic words such as -ti-, -si-, ci with the sh sound, tu- and -ti- with the ch sound, ph with the f sound and ch with the sh and k sounds.",
  },
  {
    title: "Part 12 - Silent Letter Teams",
    body: "Silent Letter Teams focuses on silent letter teams such as gh in ghost, gu in guard, bt in debt, and ps in psychology.",
  },
];

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
            Sound Spell Type Online teaches spelling and typing together
            phonetically as part of a Structured Literacy approach.
          </Typography>

          <Typography variant="body1" className={classes.paragraph}>
            Sound Spell Type Online is available free of charge.
          </Typography>

          <Typography variant="body1" className={classes.paragraph}>
            Sound Spell Type Online was designed by Dr. Mark Rogers Ed.D., a
            retired Special Education Teacher and Reading Therapist, and an
            adult dyslexic himself.
          </Typography>

          <Typography variant="body1" className={classes.paragraph}>
            The program was developed in Dr. Rogers&apos; Reading Therapy
            practice to focus on what he saw as two crucial, yet often
            neglected, needs of dyslexic children, not to mention all children
            and adults. The first is to have a firm grasp of English language
            orthographic spelling patterns at a sufficiently high level to
            easily use computer spell checking and autocorrect successfully. The
            second is having sufficient speed and accuracy in typing to enable
            the student to use a computer smoothly and proficiently.
          </Typography>

          <Typography variant="body1" className={classes.paragraph}>
            Sound Spell Type Online starts with simple Consonant Vowel Consonant
            pattern words, simultaneously focusing on the Home Row keys of the
            keyboard. The program then expands out systematically through
            multisyllable words on the entire letter keyboard.
          </Typography>

          <Typography variant="h6" className={classes.sectionTitle}>
            Sound Spell Type Online follows this sequence:
          </Typography>

          {sequenceParts.map((part) => (
            <Box key={part.title}>
              <Typography variant="subtitle1" className={classes.partTitle}>
                {part.title}
              </Typography>
              <Typography variant="body1" className={classes.paragraph}>
                {part.body}
              </Typography>
            </Box>
          ))}
        </Paper>
      </Container>
    </Box>
  );
}
