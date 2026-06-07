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
    body: "Starts first with the Home Row keys introducing short vowels in consonant-vowel-consonant closed syllable words.",
    examples: "Dad, Fog, Jack, Hug, Jet, Bid, Button.",
  },
  {
    title: "Part 2 - Blends",
    body: "Introduces words with consonant blends such as ST, TR, SM, SN, SK and -ND.",
    examples: "Stem, Traps, Smacks, Snob, Desk, Blend.",
  },
  {
    title: "Part 3 - Consonant Teams",
    body: "Introduces consonant teams such as SH, TH, WH, CH, -TCH, -DGE, QU, X, -NG and -LL, as well as introducing some prefixes and suffixes.",
    examples:
      "Finished, Thin, Whipped, Chickens, Match, Dodge, Quick, Foxes, Sang, Bell.",
  },
  {
    title: "Part 4 - Vowel Teams",
    body: "Introduces short vowel teams such as AU, -AW, OI, -OY, OU, -OW and OO.",
    examples: "August, Law, Soil, Employ, Sound, Allow, Unhook, Toothless.",
  },
  {
    title: "Part 5 - Mixed Teams",
    body: "Introduces vowel-consonant teams such as R-Controlled vowels (ER, IR, UR, AR, OR), W-Controlled (WA, WOR, WAR), and Soft C and G.",
    examples:
      "Batter, Bird, Turns, Embark, Scorch, Wanted, Worker, Inward, Central, General.",
  },
  {
    title: "Part 6 - E Power",
    body: "Introduces the powers of the letter E to influence the sounds of other letters. Silent E makes A short vowel long, makes C and G soft, and makes L and V endings legal.",
    examples: "Same, Chance, Change, Handle, Serve.",
  },
  {
    title: "Part 7 - Long Vowels",
    body: "Focuses on long vowel sounds mostly in multisyllabic words and includes long A, E, I, O, U and Y (with long I or E sounds).",
    examples: "Vacant, Recess, Item, Moment, Regulate, Supply, Unhappy.",
  },
  {
    title: "Part 8 - Long Vowel Teams",
    body: "Introduces long vowel teams such as AI, AY, EE, EA, IGH, IE, OE, OW, OA, EW and UE.",
    examples:
      "Strain, Display, Speech, Teach, Delight, Lied, Foe, Grow, Throat, Renewal, Clueless.",
  },
  {
    title: "Part 9 - Expert Vowels",
    body: "Focuses on the less common vowel sound patterns, such as the A in mama, the I in radio, the Y in happy, the I in the -INE ending (examine), and the AI in the -AIN ending (certain).",
    examples: "Retina, Period, History, Discipline, Fountain.",
  },
  {
    title: "Part 10 - Expert Teams 1",
    body: "Focuses on the consonant-vowel teams TI and SI, that have the /sh/ sound and are found mostly in multisyllabic words, TU with the /ch/ sound, PH with the /f/ sound, CH with the /sh/ sound, and CH with the /k/ sound.",
    examples: "Radiation, Division, Lecture, Photograph, Brochure, Chrome.",
  },
  {
    title: "Part 11 - Expert Teams 2",
    body: "Focuses on the letter teams CI with the /sh/ sound, TI with the /ch/ sound, and GE with the /zh/ sound.",
    examples: "Spacious, Electrician, Prejudicial, Influential, Collage.",
  },
  {
    title: "Part 12 - Silent Letter Teams",
    body: "Focuses on silent letter teams such as GH in ghost, GU in guard, BT in debt, and PS in psychology.",
    examples:
      "Gnat, Ghost, Guitar, Science, Limb, Column, Champagne, Glisten, Wrestle, Critique, Although, Enough.",
  },
];

export default function ScopeSequence() {
  const classes = useStyles();

  return (
    <Box className={classes.page}>
      <Container maxWidth="md">
        <Paper elevation={2} className={classes.card}>
          <Typography variant="h4" className={classes.title}>
            Scope & Sequence
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
              <Typography variant="body1" className={classes.paragraph}>
                <strong>Example Words:</strong> {part.examples}
              </Typography>
            </Box>
          ))}
        </Paper>
      </Container>
    </Box>
  );
}
