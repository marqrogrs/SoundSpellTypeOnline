import React, { useMemo, useState, useContext } from "react";
import { useHistory } from "react-router-dom";
import {
  adminCreateUser,
  adminDeleteUser,
  adminListUsers,
  adminSendResetEmail,
  adminUpdateUser,
} from "../firebase";
import { db } from "../firebase";
import { useAuth } from "../hooks/useAuth";
import { triggerErrorAlert } from "../util/alerts";
import { LessonContext } from "../providers/LessonProvider";
import { getLatestPerfSessionSummary } from "../util/perfSession";
import { LESSON_SECTION_OVERRIDES } from "../util/constants";

import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@material-ui/core";
import EditIcon from "@material-ui/icons/Edit";
import DeleteIcon from "@material-ui/icons/Delete";
import LockIcon from "@material-ui/icons/Lock";
import RefreshIcon from "@material-ui/icons/Refresh";

const ROLE_OPTIONS = [
  "student",
  "educator",
  "parent",
  "tutor",
  "schoolAdmin",
  "admin",
];

const prettyRole = (role) => {
  if (role === "schoolAdmin") return "School Admin";
  if (role === "admin") return "Admin";
  if (role === "educator") return "Teacher";
  if (role === "parent") return "Home School Parent";
  if (role === "tutor") return "Tutor/Reading Specialist";
  return "Student";
};

const formatCreated = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
};

function UserDialog({
  open,
  mode,
  currentUserRole,
  initialValue,
  onClose,
  onSubmit,
  saving,
  educators,
  classesByEducator,
}) {
  const [form, setForm] = useState(
    initialValue || {
      role: "educator",
      email: "",
      username: "",
      password: "",
      firstName: "",
      lastName: "",
      educator: "",
      classroom: "",
    },
  );

  React.useEffect(() => {
    setForm(
      initialValue || {
        role: "educator",
        email: "",
        username: "",
        password: "",
        firstName: "",
        lastName: "",
        educator: "",
        classroom: "",
      },
    );
  }, [initialValue]);

  const canManageAdmin = currentUserRole === "admin";
  const visibleRoles = canManageAdmin
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((role) => role !== "admin");

  const isStudent = form.role === "student";
  const selectedEducator = String(form.educator || "");
  const classOptions = classesByEducator[selectedEducator] || [];

  const handleChange = (field) => (event) => {
    const { value } = event.target;
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSave = () => {
    if (!String(form.firstName || "").trim()) {
      triggerErrorAlert("First name is required.");
      return;
    }
    if (!String(form.lastName || "").trim()) {
      triggerErrorAlert("Last name is required.");
      return;
    }
    if (!isStudent && !String(form.email || "").trim()) {
      triggerErrorAlert("Email is required for email-based users.");
      return;
    }
    if (String(form.password || "").trim().length > 0) {
      if (String(form.password || "").trim().length < 6) {
        triggerErrorAlert("Password must be at least 6 characters.");
        return;
      }
    }
    onSubmit(form);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{mode === "add" ? "Add User" : "Edit User"}</DialogTitle>
      <DialogContent>
        <Box mt={1} display="grid" gridGap={12}>
          <FormControl variant="outlined" fullWidth>
            <InputLabel>Role</InputLabel>
            <Select
              value={form.role}
              onChange={handleChange("role")}
              label="Role"
              disabled={
                mode === "edit" &&
                initialValue?.role === "admin" &&
                !canManageAdmin
              }
            >
              {visibleRoles.map((role) => (
                <MenuItem key={role} value={role}>
                  {prettyRole(role)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Email"
            value={form.email}
            onChange={handleChange("email")}
            variant="outlined"
            fullWidth
            helperText={
              isStudent
                ? "Optional — used for account recovery if provided"
                : "Invite/reset email will be sent"
            }
          />

          <TextField
            label="Username"
            value={form.username}
            onChange={handleChange("username")}
            variant="outlined"
            fullWidth
            InputProps={{ readOnly: isStudent }}
            helperText={
              isStudent && mode === "add"
                ? "Auto-generated from first and last name"
                : isStudent
                  ? "Auto-generated (read-only)"
                  : "Optional display username"
            }
          />

          <TextField
            label="Password"
            value={form.password}
            onChange={handleChange("password")}
            variant="outlined"
            fullWidth
            type="password"
            helperText={
              mode === "edit"
                ? "Leave blank to keep current password"
                : "Set initial password (min 6 characters)"
            }
          />

          <TextField
            label="First Name"
            value={form.firstName}
            onChange={handleChange("firstName")}
            variant="outlined"
            fullWidth
          />

          <TextField
            label="Last Name"
            value={form.lastName}
            onChange={handleChange("lastName")}
            variant="outlined"
            fullWidth
          />

          {isStudent && (
            <>
              <FormControl variant="outlined" fullWidth>
                <InputLabel>Educator</InputLabel>
                <Select
                  value={form.educator}
                  onChange={handleChange("educator")}
                  label="Educator"
                >
                  <MenuItem value="">
                    <em>Unassigned</em>
                  </MenuItem>
                  {educators.map((educator) => (
                    <MenuItem key={educator.id} value={educator.id}>
                      {educator.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl variant="outlined" fullWidth>
                <InputLabel>Classroom</InputLabel>
                <Select
                  value={form.classroom}
                  onChange={handleChange("classroom")}
                  label="Classroom"
                  disabled={!selectedEducator}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {classOptions.map((classroom) => (
                    <MenuItem key={classroom} value={classroom}>
                      {classroom}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <CircularProgress size={18} />
          ) : mode === "add" ? (
            "Create"
          ) : (
            "Save"
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const SECTION_KEYS = Object.keys(LESSON_SECTION_OVERRIDES).sort(
  (a, b) => Number(a) - Number(b),
);

function SectionDescriptionsDialog({ open, onClose }) {
  const [descriptions, setDescriptions] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    const defaults = {};
    SECTION_KEYS.forEach((key) => {
      defaults[key] = LESSON_SECTION_OVERRIDES[key].description || "";
    });
    db.collection("lessonSection")
      .get()
      .then((snap) => {
        snap.docs.forEach((doc) => {
          const data = doc.data() || {};
          if (typeof data.description === "string") {
            defaults[doc.id] = data.description;
          }
        });
        setDescriptions(defaults);
      })
      .catch(() => {
        setDescriptions(defaults);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const handleChange = (key, value) => {
    setDescriptions((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const batch = db.batch();
      SECTION_KEYS.forEach((key) => {
        const ref = db.collection("lessonSection").doc(key);
        batch.set(
          ref,
          { description: descriptions[key] || "" },
          { merge: true },
        );
      });
      await batch.commit();
      onClose();
    } catch (error) {
      triggerErrorAlert(error?.message || "Could not save descriptions.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Edit Section Descriptions</DialogTitle>
      <DialogContent>
        {loading ? (
          <Box display="flex" justifyContent="center" py={3}>
            <CircularProgress />
          </Box>
        ) : (
          <Box mt={1} display="grid" gridGap={16}>
            {SECTION_KEYS.map((key) => (
              <Box key={key}>
                <Typography variant="subtitle2" gutterBottom>
                  Part {key} — {LESSON_SECTION_OVERRIDES[key].title}
                </Typography>
                <TextField
                  value={descriptions[key] || ""}
                  onChange={(e) => handleChange(key, e.target.value)}
                  variant="outlined"
                  fullWidth
                  multiline
                  rows={3}
                />
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSave}
          disabled={saving || loading}
        >
          {saving ? <CircularProgress size={18} /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Admin() {
  const history = useHistory();
  const auth = useAuth();
  const { refreshRules, rulesLoading } = useContext(LessonContext);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState("add");
  const [selectedUser, setSelectedUser] = useState(null);
  const [educators, setEducators] = useState([]);
  const [classesByEducator, setClassesByEducator] = useState({});
  const [copyPerfLabel, setCopyPerfLabel] = useState("Copy Login Perf");
  const [descriptionsDialogOpen, setDescriptionsDialogOpen] = useState(false);

  const currentUserRole = auth.isAdmin
    ? "admin"
    : auth.isSchoolAdmin
      ? "schoolAdmin"
      : "educator";

  const loadUsers = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminListUsers({});
      setUsers(Array.isArray(result?.data?.users) ? result.data.users : []);
      setEducators(
        Array.isArray(result?.data?.educators) ? result.data.educators : [],
      );
      setClassesByEducator(
        result?.data?.classesByEducator &&
          typeof result.data.classesByEducator === "object"
          ? result.data.classesByEducator
          : {},
      );
    } catch (error) {
      triggerErrorAlert(error?.message || "Could not load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const q = String(query || "")
      .trim()
      .toLowerCase();
    if (!q) return users;
    return users.filter((user) =>
      [user.email, user.username, user.firstName, user.lastName, user.role]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [users, query]);

  const openAdd = () => {
    setDialogMode("add");
    setSelectedUser(null);
    setDialogOpen(true);
  };

  const openEdit = (user) => {
    setDialogMode("edit");
    setSelectedUser(user);
    setDialogOpen(true);
  };

  const handleSaveUser = async (formData) => {
    setSaving(true);
    try {
      if (dialogMode === "add") {
        const result = await adminCreateUser(formData);
        const tempPassword = result?.data?.tempPassword;
        if (tempPassword) {
          alert(`Student temp password: ${tempPassword}`);
        }
      } else {
        await adminUpdateUser({
          userId: selectedUser.id,
          updates: formData,
        });
      }
      setDialogOpen(false);
      await loadUsers();
    } catch (error) {
      triggerErrorAlert(error?.message || "Could not save user.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user) => {
    const confirmed = window.confirm(`Delete ${user.email || user.username}?`);
    if (!confirmed) return;
    try {
      await adminDeleteUser({ userId: user.id });
      await loadUsers();
    } catch (error) {
      triggerErrorAlert(error?.message || "Could not delete user.");
    }
  };

  const handleSendReset = async (user) => {
    try {
      await adminSendResetEmail({ userId: user.id });
    } catch (error) {
      triggerErrorAlert(error?.message || "Could not send reset email.");
    }
  };

  const handleCopyLoginPerf = async () => {
    const summary = getLatestPerfSessionSummary();
    if (!summary) {
      triggerErrorAlert(
        "No login performance summary is available yet. Log in and wait for [perf] login-session-summary in the console.",
      );
      return;
    }

    const payload = JSON.stringify(summary, null, 2);

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        throw new Error("Clipboard API not available");
      }
      setCopyPerfLabel("Copied");
      window.setTimeout(() => setCopyPerfLabel("Copy Login Perf"), 1500);
    } catch (error) {
      triggerErrorAlert(
        "Could not copy to clipboard. Open DevTools and copy the [perf] login-session-summary entry manually.",
      );
    }
  };

  return (
    <Container maxWidth="lg" style={{ marginTop: 24, marginBottom: 32 }}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h5">Admin</Typography>
        <Box display="flex" style={{ gap: 8 }}>
          <Button
            variant="outlined"
            color="primary"
            onClick={() => history.push("/admin/word-fix")}
          >
            Word Fix Admin
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            onClick={refreshRules}
            disabled={rulesLoading}
          >
            Update Pattern Buttons
          </Button>
          <Button variant="outlined" onClick={handleCopyLoginPerf}>
            {copyPerfLabel}
          </Button>
          <Button
            variant="outlined"
            color="primary"
            onClick={() => setDescriptionsDialogOpen(true)}
          >
            Edit Section Descriptions
          </Button>
          <Button variant="contained" color="primary" onClick={openAdd}>
            Add User
          </Button>
        </Box>
      </Box>

      <Paper style={{ padding: 16, marginBottom: 16 }}>
        <Box display="flex" alignItems="center" style={{ gap: 12 }}>
          <TextField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            variant="outlined"
            label="Search users"
            size="small"
            style={{ minWidth: 280 }}
          />
          <Button
            startIcon={<RefreshIcon />}
            onClick={loadUsers}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Email</TableCell>
              <TableCell>Username</TableCell>
              <TableCell>Password</TableCell>
              <TableCell>First</TableCell>
              <TableCell>Last</TableCell>
              <TableCell>Role</TableCell>
              <TableCell align="right">Assigned Students</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Box py={2}>
                    <CircularProgress size={24} />
                  </Box>
                </TableCell>
              </TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.email || "-"}</TableCell>
                  <TableCell>{user.username || "-"}</TableCell>
                  <TableCell>{user.hasPassword ? "********" : "-"}</TableCell>
                  <TableCell>{user.firstName || "-"}</TableCell>
                  <TableCell>{user.lastName || "-"}</TableCell>
                  <TableCell>
                    <Chip size="small" label={prettyRole(user.role)} />
                  </TableCell>
                  <TableCell align="right">
                    {user.assignedStudentCount || 0}
                  </TableCell>
                  <TableCell>{formatCreated(user.createdAt)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => openEdit(user)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(user)}
                      disabled={
                        currentUserRole !== "admin" && user.role === "admin"
                      }
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleSendReset(user)}
                      disabled={!user.email}
                    >
                      <LockIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <UserDialog
        open={dialogOpen}
        mode={dialogMode}
        currentUserRole={currentUserRole}
        educators={educators}
        classesByEducator={classesByEducator}
        initialValue={
          selectedUser
            ? {
                role: selectedUser.role || "educator",
                email: selectedUser.email || "",
                username: selectedUser.username || "",
                password: "",
                firstName: selectedUser.firstName || "",
                lastName: selectedUser.lastName || "",
                educator: selectedUser.educator || "",
                classroom: selectedUser.classroom || "",
              }
            : null
        }
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSaveUser}
        saving={saving}
      />
      <SectionDescriptionsDialog
        open={descriptionsDialogOpen}
        onClose={() => setDescriptionsDialogOpen(false)}
      />
    </Container>
  );
}
