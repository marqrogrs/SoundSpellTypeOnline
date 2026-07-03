import React from "react";
import {
  Box,
  Button,
  Container,
  Divider,
  Paper,
  Typography,
} from "@material-ui/core";
import { useHistory } from "react-router-dom";

export default function ContactUs() {
  const history = useHistory();

  return (
    <Container maxWidth="md" style={{ marginTop: 24, marginBottom: 24 }}>
      <Paper style={{ padding: 24, borderRadius: 14 }}>
        <Typography variant="h4" gutterBottom>
          Support Center
        </Typography>
        <Typography variant="body1" color="textSecondary">
          We are here to help you get up and running quickly. If you are unsure
          where to start, use the checklist below and then contact us.
        </Typography>

        <Box mt={3}>
          <Typography variant="h6">Quick Help Checklist</Typography>
          <Typography variant="body2" color="textSecondary">
            1. Students: use Student Sign In from the home page.
          </Typography>
          <Typography variant="body2" color="textSecondary">
            2. Adults: teachers, admins, tutors, and parents use Adult Sign In.
          </Typography>
          <Typography variant="body2" color="textSecondary">
            3. If login fails, use Reset Password by Email from the Adult
            Portal.
          </Typography>
          <Typography variant="body2" color="textSecondary">
            4. New students should complete Placement Test if assigned.
          </Typography>
        </Box>

        <Divider style={{ marginTop: 20, marginBottom: 20 }} />

        <Typography variant="h6">Contact</Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Email support: mark@birdhaven.us
        </Typography>

        <Box display="flex" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <Button
            variant="contained"
            color="primary"
            onClick={() => window.location.assign("mailto:mark@birdhaven.us")}
          >
            Email Support
          </Button>
          <Button variant="outlined" onClick={() => history.push("/")}>
            Return Home
          </Button>
        </Box>
      </Paper>
    </Container>
  );
}
