import * as React from "react";
import { useContext, useEffect } from "react";
import Container from "@material-ui/core/Container";
import Paper from "@material-ui/core/Paper";
import Typography from "@material-ui/core/Typography";
import Box from "@material-ui/core/Box";
import Button from "@material-ui/core/Button";
import { useHistory } from "react-router-dom";

import Progress from "../pages/Progress";

import { useAuth } from "../hooks/useAuth";
import { UserContext } from "../providers/UserProvider";
import { useStyles } from "../styles/material";
import { getCurrentPerfSessionId, setPerfMetric } from "../util/perfSession";

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const Home = () => {
  const { user, isAdmin, isSchoolAdmin } = useAuth();
  const { userData } = useContext(UserContext);
  const history = useHistory();
  const classes = useStyles();
  const isAdminHome = isAdmin || isSchoolAdmin;

  useEffect(() => {
    const mountedAt = nowMs();
    const rafId = window.requestAnimationFrame(() => {
      const totalMs = Math.round(nowMs() - mountedAt);
      const perfSessionId = getCurrentPerfSessionId();
      if (perfSessionId) {
        setPerfMetric("homeFirstPaintMs", totalMs, {
          sessionId: perfSessionId,
        });
        setPerfMetric("adminHome", isAdminHome, { sessionId: perfSessionId });
      }
      console.info("[perf] home-first-paint", {
        adminHome: isAdminHome,
        ms: totalMs,
      });
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [isAdminHome]);

  const firstName = userData?.firstName;
  const displayName = firstName
    ? firstName
    : user.email
      ? (() => {
          const raw = user.email.slice(0, user.email.indexOf("@"));
          return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
        })()
      : user.uid;

  return (
    <Container maxWidth="md">
      <Paper className={classes.welcomeBanner}>
        <Typography variant="h3" className={classes.welcomeBannerText}>
          Welcome {displayName}!
        </Typography>
      </Paper>
      {isAdminHome ? (
        <Paper style={{ padding: 16, marginTop: 16 }}>
          <Typography variant="body1" style={{ marginBottom: 12 }}>
            Admin tools are ready.
          </Typography>
          <Box display="flex" style={{ gap: 8, flexWrap: "wrap" }}>
            <Button
              variant="contained"
              color="primary"
              onClick={() => history.push("/admin")}
            >
              Open Admin Panel
            </Button>
            <Button
              variant="outlined"
              color="primary"
              onClick={() => history.push("/students")}
            >
              Manage Students
            </Button>
          </Box>
        </Paper>
      ) : (
        <Progress />
      )}
    </Container>
  );
};

export default Home;
