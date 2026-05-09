import React from "react";
import Container from "@material-ui/core/Container";
import Typography from "@material-ui/core/Typography";
import Box from "@material-ui/core/Box";

import ClassManagement from "./ClassManagement";
import NewStudentForm from "../components/NewStudentForm";

export default function Students() {
  return (
    <>
      <ClassManagement
        title="My Students"
        description="Manage classes, view student progress, reset passwords, and organize student rosters."
        fabBottom={20}
      />
      <Container maxWidth="md" style={{ marginTop: 24, marginBottom: 120 }}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Add Student
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Create a new student account and assign the student to a class.
          </Typography>
        </Box>
      </Container>
      <NewStudentForm fabBottom={88} />
    </>
  );
}
