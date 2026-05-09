import React, { useContext, useEffect, useState, useCallback } from "react";
import { useHistory } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { UserContext } from "../providers/UserProvider";
import { triggerErrorAlert } from "../util/alerts";
import {
  subscribeToEducatorClasses,
  createClass,
  updateClass,
  deleteClass,
  addStudentToClass,
  removeStudentFromClass,
  searchStudentsByUsername,
} from "../util/customLessonHelpers";

import Container from "@material-ui/core/Container";
import Typography from "@material-ui/core/Typography";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";
import TextField from "@material-ui/core/TextField";
import Paper from "@material-ui/core/Paper";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableContainer from "@material-ui/core/TableContainer";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Collapse from "@material-ui/core/Collapse";
import Box from "@material-ui/core/Box";
import Modal from "@material-ui/core/Modal";
import Backdrop from "@material-ui/core/Backdrop";
import Fade from "@material-ui/core/Fade";
import CircularProgress from "@material-ui/core/CircularProgress";
import Chip from "@material-ui/core/Chip";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import ListItemText from "@material-ui/core/ListItemText";
import Divider from "@material-ui/core/Divider";

import AddIcon from "@material-ui/icons/Add";
import EditIcon from "@material-ui/icons/Edit";
import DeleteIcon from "@material-ui/icons/Delete";
import KeyboardArrowDownIcon from "@material-ui/icons/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@material-ui/icons/KeyboardArrowUp";
import PersonAddIcon from "@material-ui/icons/PersonAdd";
import CloseIcon from "@material-ui/icons/Close";
import Fab from "@material-ui/core/Fab";
import VisibilityIcon from "@material-ui/icons/Visibility";

import { useStyles } from "../styles/material";
import ResetPasswordForm from "../components/ResetPasswordForm";

// ─── Class row with collapsible student roster ────────────────────────────────

function ClassRow({ cls, educatorId, educatorName, onEdit, onDelete }) {
  const classes = useStyles();
  const history = useHistory();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingStudent, setAddingStudent] = useState(false);
  const [openResetPasswordForm, setOpenResetPasswordForm] = useState(false);
  const [studentToUpdate, setStudentToUpdate] = useState(null);

  const students = cls.students ? Object.values(cls.students) : [];

  const handleViewProgress = (username) => {
    history.push(`/students/${username}`);
  };

  const handleResetPassword = (username) => {
    setStudentToUpdate(username);
    setOpenResetPasswordForm(true);
  };

  const handleSearch = useCallback(async (query) => {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchStudentsByUsername(query.trim());
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleAddStudent = async (student) => {
    setAddingStudent(true);
    try {
      await addStudentToClass(cls.id, student.username, student.name);
      setSearchQuery("");
      setSearchResults([]);
    } catch (e) {
      triggerErrorAlert(e.message || "Could not add student.");
    } finally {
      setAddingStudent(false);
    }
  };

  const handleRemoveStudent = async (username) => {
    try {
      await removeStudentFromClass(cls.id, username);
    } catch (e) {
      triggerErrorAlert(e.message || "Could not remove student.");
    }
  };

  return (
    <>
      <TableRow className={classes.progressList}>
        <TableCell>
          <IconButton size="small" onClick={() => setOpen((o) => !o)}>
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell component="th" scope="row">
          <strong>{cls.className}</strong>
          {cls.description ? (
            <Typography variant="body2" color="textSecondary">
              {cls.description}
            </Typography>
          ) : null}
        </TableCell>
        <TableCell align="right">{students.length}</TableCell>
        <TableCell align="right">
          <IconButton size="small" onClick={() => onEdit(cls)}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => onDelete(cls)}
            style={{ marginLeft: 4 }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </TableCell>
      </TableRow>

      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={4}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box margin={2}>
              {/* Add student search */}
              <Typography variant="subtitle2" gutterBottom>
                Add Student
              </Typography>
              <Box display="flex" alignItems="center" mb={1}>
                <TextField
                  size="small"
                  variant="outlined"
                  label="Search by username"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  style={{ width: 240 }}
                />
                {searching && (
                  <CircularProgress size={20} style={{ marginLeft: 8 }} />
                )}
              </Box>
              {searchResults.length > 0 && (
                <Paper
                  variant="outlined"
                  style={{ maxHeight: 180, overflowY: "auto", width: 240 }}
                >
                  <List dense>
                    {searchResults.map((s) => (
                      <ListItem
                        key={s.username}
                        button
                        disabled={
                          addingStudent ||
                          Boolean(cls.students && cls.students[s.username])
                        }
                        onClick={() => handleAddStudent(s)}
                      >
                        <ListItemText
                          primary={s.username}
                          secondary={
                            cls.students && cls.students[s.username]
                              ? "Already in class"
                              : null
                          }
                        />
                        <PersonAddIcon fontSize="small" color="action" />
                      </ListItem>
                    ))}
                  </List>
                </Paper>
              )}

              {/* Student roster */}
              <Typography variant="subtitle2" style={{ marginTop: 16 }}>
                Students ({students.length})
              </Typography>
              {students.length === 0 ? (
                <Typography variant="body2" color="textSecondary">
                  No students yet.
                </Typography>
              ) : (
                <Box mt={1}>
                  <Table size="small" aria-label="student roster">
                    <TableHead>
                      <TableRow>
                        <TableCell>Username</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell align="right">View Progress</TableCell>
                        <TableCell align="right">Reset Password</TableCell>
                        <TableCell align="right">Remove</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {students.map((s) => (
                        <TableRow key={s.username}>
                          <TableCell>{s.username}</TableCell>
                          <TableCell>{s.name || s.username}</TableCell>
                          <TableCell align="right">
                            <IconButton
                              size="small"
                              onClick={() => handleViewProgress(s.username)}
                            >
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              color="primary"
                              size="small"
                              onClick={() => handleResetPassword(s.username)}
                            >
                              Reset Password
                            </Button>
                          </TableCell>
                          <TableCell align="right">
                            <Chip
                              label="Remove"
                              onDelete={() => handleRemoveStudent(s.username)}
                              deleteIcon={<CloseIcon />}
                              variant="outlined"
                              size="small"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
      <ResetPasswordForm
        open={openResetPasswordForm}
        setOpen={setOpenResetPasswordForm}
        student={studentToUpdate}
      />
    </>
  );
}

// ─── Create / Edit class modal ────────────────────────────────────────────────

function ClassFormModal({ open, onClose, existing, educatorId, educatorName }) {
  const classes = useStyles();
  const [className, setClassName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (existing) {
      setClassName(existing.className || "");
      setDescription(existing.description || "");
    } else {
      setClassName("");
      setDescription("");
    }
    setError("");
  }, [existing, open]);

  const handleSave = async () => {
    if (!className.trim()) {
      setError("Class name is required.");
      return;
    }
    setSaving(true);
    try {
      if (existing) {
        await updateClass(existing.id, {
          className: className.trim(),
          description: description.trim(),
        });
      } else {
        await createClass(
          educatorId,
          educatorName,
          className.trim(),
          description.trim(),
        );
      }
      onClose();
    } catch (e) {
      setError(e.message || "Could not save class.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      className={classes.modal}
      open={open}
      onClose={onClose}
      closeAfterTransition
      BackdropComponent={Backdrop}
      BackdropProps={{ timeout: 500 }}
    >
      <Fade in={open}>
        <div className={classes.modalPaper}>
          <Typography variant="h6">
            {existing ? "Edit Class" : "New Class"}
          </Typography>
          <TextField
            label="Class Name"
            variant="outlined"
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            error={Boolean(error)}
            helperText={error}
            autoFocus
          />
          <TextField
            label="Description (optional)"
            variant="outlined"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            rows={2}
          />
          <Box display="flex" justifyContent="flex-end" style={{ gap: 8 }}>
            <Button onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <CircularProgress size={20} /> : "Save"}
            </Button>
          </Box>
        </div>
      </Fade>
    </Modal>
  );
}

// ─── Delete confirmation modal ────────────────────────────────────────────────

function DeleteClassModal({ open, onClose, cls, onConfirm, deleting }) {
  const classes = useStyles();
  return (
    <Modal
      className={classes.modal}
      open={open}
      onClose={onClose}
      closeAfterTransition
      BackdropComponent={Backdrop}
      BackdropProps={{ timeout: 500 }}
    >
      <Fade in={open}>
        <div className={classes.modalPaper}>
          <Typography variant="h6">Delete Class?</Typography>
          <Typography>
            Delete <strong>{cls?.className}</strong>? This cannot be undone.
            Custom lessons assigned to this class will become inaccessible to
            students.
          </Typography>
          <Box display="flex" justifyContent="flex-end" style={{ gap: 8 }}>
            <Button onClick={onClose} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="contained"
              style={{ backgroundColor: "#d32f2f", color: "#fff" }}
              onClick={onConfirm}
              disabled={deleting}
            >
              {deleting ? <CircularProgress size={20} /> : "Delete"}
            </Button>
          </Box>
        </div>
      </Fade>
    </Modal>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ClassManagement({
  title = "Class Management",
  description = "Create classes, add students, and assign custom lessons to your classes.",
  fabBottom = 20,
}) {
  const classes = useStyles();
  const auth = useAuth();
  const { userData } = useContext(UserContext);

  const educatorId = auth.user?.uid || "";
  const educatorName = userData?.displayName || userData?.email || educatorId;

  const [classList, setClassList] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!educatorId) return;
    const unsub = subscribeToEducatorClasses(educatorId, setClassList);
    return unsub;
  }, [educatorId]);

  const handleEdit = (cls) => {
    setEditTarget(cls);
    setFormOpen(true);
  };

  const handleDelete = (cls) => {
    setDeleteTarget(cls);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteClass(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      triggerErrorAlert(e.message || "Could not delete class.");
    } finally {
      setDeleting(false);
    }
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setEditTarget(null);
  };

  return (
    <Container maxWidth="md" style={{ marginTop: 24 }}>
      <Typography variant="h5" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        {description}
      </Typography>

      <TableContainer
        component={Paper}
        className={classes.table}
        style={{ marginTop: 16 }}
      >
        <Table aria-label="classes table">
          <TableHead>
            <TableRow>
              <TableCell style={{ width: 40 }} />
              <TableCell>Class Name</TableCell>
              <TableCell align="right">Students</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {classList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    style={{ padding: "24px 0" }}
                  >
                    No classes yet. Use the + button to create one.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              classList.map((cls) => (
                <ClassRow
                  key={cls.id}
                  cls={cls}
                  educatorId={educatorId}
                  educatorName={educatorName}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* FAB to create a new class */}
      <Fab
        color="primary"
        aria-label="add class"
        style={{ position: "fixed", bottom: fabBottom, right: 20 }}
        onClick={() => {
          setEditTarget(null);
          setFormOpen(true);
        }}
      >
        <AddIcon />
      </Fab>

      <ClassFormModal
        open={formOpen}
        onClose={handleFormClose}
        existing={editTarget}
        educatorId={educatorId}
        educatorName={educatorName}
      />

      <DeleteClassModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        cls={deleteTarget}
        onConfirm={handleConfirmDelete}
        deleting={deleting}
      />
    </Container>
  );
}
