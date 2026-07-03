import React from "react";
import { useHistory } from "react-router-dom";

//Material UI
import { Box, Button, Paper, Typography } from "@material-ui/core";
// var Landing = require('../img/Landing.png')

const Landing = () => {
  const history = useHistory();

  return (
    <div id="landing-container" className="landing-only">
      <Paper className="landing-trust-card" elevation={0}>
        <Typography variant="overline" className="landing-kicker">
          Structured Literacy Practice
        </Typography>
        <Typography variant="h3" className="landing-title">
          Sound Spell Type Online
        </Typography>
        <Typography variant="body1" className="landing-subtitle">
          Build momentum with short, guided spelling practice and clear progress
          you can see every day.
        </Typography>

        <Box className="landing-role-grid">
          <Paper className="landing-role-card" elevation={1}>
            <Typography variant="h6">Student</Typography>
            <Typography variant="body2" color="textSecondary">
              Jump into your lesson path, continue where you left off, and keep
              building mastery.
            </Typography>
            <Button
              className="landing-role-action"
              color="primary"
              variant="contained"
              onClick={() => history.push("/student")}
            >
              Student Sign In
            </Button>
          </Paper>

          <Paper className="landing-role-card" elevation={1}>
            <Typography variant="h6">
              Teacher / Parent / Tutor / Admin
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Manage students, monitor progress, and launch targeted support.
            </Typography>
            <Button
              className="landing-role-action"
              color="primary"
              variant="outlined"
              onClick={() => history.push("/educator")}
            >
              Adult Sign In
            </Button>
          </Paper>
        </Box>

        <Box className="landing-secondary-actions">
          <Button size="small" onClick={() => history.push("/placement-test")}>
            Take Placement Test
          </Button>
          <Button size="small" onClick={() => history.push("/contact-us")}>
            Contact Support
          </Button>
        </Box>
      </Paper>
    </div>
  );
};

export default Landing;
