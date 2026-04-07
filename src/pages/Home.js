import * as React from "react";
import Container from "@material-ui/core/Container";
import Paper from "@material-ui/core/Paper";
import Typography from "@material-ui/core/Typography";

import Progress from "../pages/Progress";

import { useAuth } from "../hooks/useAuth";
import { useStyles } from "../styles/material";

const Home = () => {
  const { user } = useAuth();
  const classes = useStyles();
  const rawDisplayName = user.email
    ? user.email.slice(0, user.email.indexOf("@"))
    : user.uid;
  const displayName = rawDisplayName
    ? rawDisplayName.charAt(0).toUpperCase() + rawDisplayName.slice(1)
    : "";

  return (
    <Container maxWidth="md">
      <Paper className={classes.welcomeBanner}>
        <Typography variant="h3" className={classes.welcomeBannerText}>
          Welcome {displayName}!
        </Typography>
      </Paper>
      <Progress />
    </Container>
  );
};

export default Home;
