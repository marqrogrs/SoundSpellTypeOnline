/**
 * Management.js
 *
 * Unified management page for all staff roles.
 * Tabs and controls shown are scoped strictly to the logged-in user's role.
 *
 * Role → visible tabs:
 *   admin       – Users | Schools | Classes | Requests
 *   schoolAdmin – Users | Classes
 *   educator    – Students (roster view)
 *   parent      – My Students
 *   tutor       – My Students
 */
import React, {
  useState,
  useEffect,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useHistory } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { triggerErrorAlert } from "../util/alerts";
import {
  mgmtListData,
  mgmtCreateSchool,
  mgmtUpdateSchool,
  mgmtArchiveSchool,
  mgmtCreateClass,
  mgmtUpdateClass,
  mgmtArchiveClass,
  mgmtAssignSchoolAdmin,
  mgmtAssignEducatorToSchool,
  mgmtAssignStudentClasses,
  mgmtListAccountabilityQueue,
  mgmtRecordAccountabilityReminder,
  mgmtBootstrapParentHomeScope,
  mgmtParentCreateStudent,
  adminCreateUser,
  adminUpdateUser,
  adminDeleteUser,
  adminSendResetEmail,
  adminListSchoolAdminRequests,
  adminReviewSchoolAdminRequest,
  mgmtDebugUser,
  resolveMyRoleContext,
} from "../firebase";
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
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@material-ui/core";
import AddIcon from "@material-ui/icons/Add";
import EditIcon from "@material-ui/icons/Edit";
import DeleteIcon from "@material-ui/icons/Delete";
import LockIcon from "@material-ui/icons/Lock";
import RefreshIcon from "@material-ui/icons/Refresh";
import SchoolIcon from "@material-ui/icons/School";
import ClassIcon from "@material-ui/icons/Class";
import PeopleIcon from "@material-ui/icons/People";
import { LessonContext } from "../providers/LessonProvider";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true for Firebase "unauthenticated" errors that occur during sign-out. */
const isUnauthenticatedError = (err) =>
  err?.code === "functions/unauthenticated" ||
  err?.code === "unauthenticated" ||
  String(err?.message || "").toLowerCase() === "you must be signed in.";

const MGMT_CACHE_TTL_MS = 60 * 1000;

const getMgmtCacheKey = (uid, role) => `mgmt:list:${uid || "anon"}:${role}`;

const readMgmtCache = (key) => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (Date.now() - Number(parsed.cachedAt || 0) > MGMT_CACHE_TTL_MS) {
      return null;
    }
    return {
      schools: Array.isArray(parsed.schools) ? parsed.schools : [],
      classes: Array.isArray(parsed.classes) ? parsed.classes : [],
      users: Array.isArray(parsed.users) ? parsed.users : [],
    };
  } catch (_err) {
    return null;
  }
};

const writeMgmtCache = (key, data) => {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        cachedAt: Date.now(),
        schools: Array.isArray(data?.schools) ? data.schools : [],
        classes: Array.isArray(data?.classes) ? data.classes : [],
        users: Array.isArray(data?.users) ? data.users : [],
      }),
    );
  } catch (_err) {
    // Best-effort cache only.
  }
};

const normalizeText = (value) => String(value || "").trim();
const normalizeLowerEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const normalizeClassIds = (ids) =>
  [...new Set((Array.isArray(ids) ? ids : []).map(String))]
    .map((id) => id.trim())
    .filter(Boolean)
    .sort();

const parseDayKey = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parts = raw.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [year, month, day] = parts;
  return { year, month, day };
};

const diffDaysFromToday = (dayKey) => {
  const parsed = parseDayKey(dayKey);
  if (!parsed) return null;
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const keyUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  return Math.max(0, Math.round((todayUtc - keyUtc) / (24 * 60 * 60 * 1000)));
};

const getStudentAccountabilityStatus = (student) => {
  const hasFirstLessonAttempted = Boolean(
    student?.firstLessonAttemptedAt || student?.first_lesson_attempted_at,
  );
  const lastPracticeDay = String(
    student?.lastPracticeDay || student?.last_practice_day || "",
  ).trim();
  const daysSincePractice = diffDaysFromToday(lastPracticeDay);

  if (!hasFirstLessonAttempted) {
    return {
      label: "Needs First Win",
      color: "default",
    };
  }

  if (daysSincePractice === null) {
    return {
      label: "Needs Check-In",
      color: "default",
    };
  }

  if (daysSincePractice <= 1) {
    return {
      label: "On Track",
      color: "primary",
    };
  }

  if (daysSincePractice <= 3) {
    return {
      label: "Needs Nudge",
      color: "secondary",
    };
  }

  return {
    label: "Returning",
    color: "default",
  };
};

const formatManagedByLabel = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return raw;

  const match = raw.match(/^Managed\s+by\s+(Parent|Tutor)\s*:\s*(.+)$/i);
  if (!match) return raw;

  const role =
    String(match[1] || "")
      .trim()
      .toLowerCase() === "tutor"
      ? "Tutor"
      : "Parent";
  const managerName = String(match[2] || "").trim();
  return managerName ? `${managerName} (${role})` : `(${role})`;
};

const buildUserUpdates = (initial = {}, form = {}) => {
  const updates = {};

  if (normalizeText(form.role) !== normalizeText(initial.role)) {
    updates.role = form.role;
  }
  if (normalizeLowerEmail(form.email) !== normalizeLowerEmail(initial.email)) {
    updates.email = form.email;
  }
  if (normalizeText(form.username) !== normalizeText(initial.username)) {
    updates.username = form.username;
  }
  if (normalizeText(form.firstName) !== normalizeText(initial.firstName)) {
    updates.firstName = form.firstName;
  }
  if (normalizeText(form.lastName) !== normalizeText(initial.lastName)) {
    updates.lastName = form.lastName;
  }
  if (normalizeText(form.schoolId) !== normalizeText(initial.schoolId)) {
    updates.schoolId = form.schoolId;
  }

  const nextPassword = String(form.password || "").trim();
  if (nextPassword) {
    updates.password = nextPassword;
  }

  return updates;
};

const classIdsChanged = (initialClassIds = [], nextClassIds = []) => {
  const previousNormalized = normalizeClassIds(initialClassIds);
  const nextNormalized = normalizeClassIds(nextClassIds);

  return (
    previousNormalized.length !== nextNormalized.length ||
    previousNormalized.some((id, index) => id !== nextNormalized[index])
  );
};

// ─── Error boundary ─────────────────────────────────────────────────────────────

class ManagementErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <Box p={4} textAlign="center">
          <Typography variant="h6" color="error" gutterBottom>
            Something went wrong
          </Typography>
          <Typography variant="body2" style={{ marginBottom: 16 }}>
            {String(
              this.state.error?.message || this.state.error || "Unknown error",
            )}
          </Typography>
          <Button
            variant="outlined"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_ROLES = [
  "student",
  "educator",
  "parent",
  "tutor",
  "schoolAdmin",
  "admin",
];

const prettyRole = (role) => {
  const map = {
    admin: "Admin",
    schoolAdmin: "School Admin",
    educator: "Teacher",
    parent: "Home School Parent",
    tutor: "Tutor/Reading Specialist",
    student: "Student",
  };
  return map[role] || role || "—";
};

const formatDate = (v) => {
  if (!v) return "—";
  const d = v?.toDate ? v.toDate() : new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MANAGER_ROLE_ORDER = {
  admin: 0,
  schoolAdmin: 1,
  educator: 2,
  tutor: 3,
  parent: 4,
};

const normalizeMgmtRole = (value) => {
  const raw = String(value || "").trim();
  const compact = raw.toLowerCase().replace(/\s+/g, "");
  if (compact === "admin") return "admin";
  if (compact === "schooladmin" || compact === "school_admin") {
    return "schoolAdmin";
  }
  if (compact === "educator" || compact === "teacher") return "educator";
  if (
    compact === "parent" ||
    compact === "homeschoolparent" ||
    compact === "home_school_parent" ||
    compact === "homeschool_parent"
  ) {
    return "parent";
  }
  if (
    compact === "tutor" ||
    compact === "readingspecialist" ||
    compact === "reading_specialist" ||
    compact === "tutor/readingspecialist"
  ) {
    return "tutor";
  }
  if (compact === "student") return "student";
  if (raw === "schoolAdmin") return "schoolAdmin";
  return "";
};

// ─── Users tab ────────────────────────────────────────────────────────────────

const EMPTY_USER_FORM = {
  role: "student",
  usernameMode: "email",
  email: "",
  username: "",
  password: "",
  firstName: "",
  lastName: "",
  schoolId: "",
  educatorId: "",
  classIds: [],
};

function UserDialog({
  open,
  mode,
  callerRole,
  initial,
  schools,
  classes,
  users,
  onClose,
  onSubmit,
  saving,
}) {
  const [form, setForm] = useState(initial || EMPTY_USER_FORM);

  useEffect(() => {
    setForm(initial || { ...EMPTY_USER_FORM });
  }, [initial, open]);

  const canManageAdmin = callerRole === "admin";
  const visibleRoles = ALL_ROLES.filter((r) => {
    if (r === "admin" && !canManageAdmin) return false;
    if (r === "schoolAdmin" && callerRole === "schoolAdmin") return false; // schoolAdmin cannot create another schoolAdmin
    return true;
  });

  const isStudent = form.role === "student";
  const isParent = form.role === "parent";

  // Classes filtered to the selected schoolId (or all for admin without school filter).
  const availableClasses = classes.filter(
    (c) => !form.schoolId || c.schoolId === form.schoolId,
  );

  // Educators in the selected school (for class educator assignment shown in class tab, not here).
  const availableEducators = users.filter(
    (u) =>
      u.role === "educator" && (!form.schoolId || u.schoolId === form.schoolId),
  );

  const set = (field) => (e) => {
    const value = e.target ? e.target.value : e;
    setForm((p) => ({ ...p, [field]: value }));
  };

  const handleSave = () => {
    const normalizedFirstName = String(form.firstName || "").trim();
    const normalizedLastName = String(form.lastName || "").trim();
    const normalizedEmail = String(form.email || "")
      .trim()
      .toLowerCase();
    const studentMode =
      form.usernameMode === "generated" ? "generated" : "email";

    if (!normalizedFirstName) {
      triggerErrorAlert("First name is required.");
      return;
    }
    if (!normalizedLastName) {
      triggerErrorAlert("Last name is required.");
      return;
    }
    if (
      isStudent &&
      mode === "add" &&
      studentMode === "email" &&
      !normalizedEmail
    ) {
      triggerErrorAlert("Email is required when using email sign-in.");
      return;
    }
    if (
      isStudent &&
      mode === "add" &&
      studentMode === "email" &&
      !EMAIL_REGEX.test(normalizedEmail)
    ) {
      triggerErrorAlert("Enter a valid student email address.");
      return;
    }
    if (!isStudent && !normalizedEmail) {
      triggerErrorAlert("Email is required.");
      return;
    }
    const pw = String(form.password || "").trim();
    if (pw && pw.length < 6) {
      triggerErrorAlert("Password must be at least 6 characters.");
      return;
    }
    const payload = {
      ...form,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      usernameMode: studentMode,
    };

    if (isStudent && mode === "add") {
      if (studentMode === "email") {
        payload.email = normalizedEmail;
        payload.username = normalizedEmail;
      } else {
        payload.email = "";
        payload.username = "";
      }
    } else {
      payload.email = normalizedEmail;
    }

    onSubmit(payload);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{mode === "add" ? "Add User" : "Edit User"}</DialogTitle>
      <DialogContent>
        <Box mt={1} display="grid" gridGap={12}>
          {/* Role */}
          <FormControl variant="outlined" fullWidth>
            <InputLabel>Role</InputLabel>
            <Select value={form.role} onChange={set("role")} label="Role">
              {visibleRoles.map((r) => (
                <MenuItem key={r} value={r}>
                  {prettyRole(r)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {isStudent && mode === "add" && (
            <FormControl variant="outlined" fullWidth>
              <InputLabel>Student Sign-in</InputLabel>
              <Select
                value={form.usernameMode || "email"}
                onChange={set("usernameMode")}
                label="Student Sign-in"
              >
                <MenuItem value="email">Use real email address</MenuItem>
                <MenuItem value="generated">
                  Auto-generate username (first_last_1234)
                </MenuItem>
              </Select>
            </FormControl>
          )}

          {/* Email */}
          {(!isStudent || mode !== "add" || form.usernameMode === "email") && (
            <TextField
              label={
                isStudent && mode === "add"
                  ? "Student Email (used as username)"
                  : "Email"
              }
              value={form.email}
              onChange={set("email")}
              variant="outlined"
              fullWidth
              helperText={
                isStudent && mode === "add"
                  ? "Required for email sign-in"
                  : isStudent
                    ? "Optional — used for account recovery if provided"
                    : ""
              }
            />
          )}

          {/* Username */}
          {(!isStudent ||
            mode !== "add" ||
            form.usernameMode === "generated") && (
            <TextField
              label="Username"
              value={form.username}
              onChange={set("username")}
              variant="outlined"
              fullWidth
              InputProps={{ readOnly: isStudent }}
              helperText={
                isStudent && mode === "add"
                  ? "Generated on create from first and last name"
                  : isStudent
                    ? "Auto-generated (read-only)"
                    : "Optional display name"
              }
            />
          )}

          {/* Password */}
          <TextField
            label="Password"
            value={form.password}
            onChange={set("password")}
            variant="outlined"
            fullWidth
            type="password"
            helperText={
              mode === "edit"
                ? "Leave blank to keep current password"
                : "Set initial password (min 6 chars)"
            }
          />

          {/* First / Last name */}
          <Box display="grid" gridTemplateColumns="1fr 1fr" gridGap={12}>
            <TextField
              label="First Name"
              value={form.firstName}
              onChange={set("firstName")}
              variant="outlined"
              fullWidth
            />
            <TextField
              label="Last Name"
              value={form.lastName}
              onChange={set("lastName")}
              variant="outlined"
              fullWidth
            />
          </Box>

          {/* School assignment for school-scoped staff roles */}
          {callerRole === "admin" &&
            (form.role === "educator" || form.role === "schoolAdmin") && (
              <FormControl variant="outlined" fullWidth>
                <InputLabel>School</InputLabel>
                <Select
                  value={form.schoolId}
                  onChange={set("schoolId")}
                  label="School"
                >
                  <MenuItem value="">
                    <em>Unassigned</em>
                  </MenuItem>
                  {schools
                    .filter((s) => s.type === "regular")
                    .map((s) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.name}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            )}

          {/* Student: school + educator + multi-class */}
          {isStudent && (
            <>
              {callerRole === "admin" && (
                <FormControl variant="outlined" fullWidth>
                  <InputLabel>School</InputLabel>
                  <Select
                    value={form.schoolId}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        schoolId: e.target.value,
                        educatorId: "",
                        classIds: [],
                      }))
                    }
                    label="School"
                  >
                    <MenuItem value="">
                      <em>Unassigned</em>
                    </MenuItem>
                    {schools
                      .filter((s) => s.type === "regular")
                      .map((s) => (
                        <MenuItem key={s.id} value={s.id}>
                          {s.name}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
              )}

              <FormControl variant="outlined" fullWidth>
                <InputLabel>Educator (optional)</InputLabel>
                <Select
                  value={form.educatorId}
                  onChange={set("educatorId")}
                  label="Educator (optional)"
                >
                  <MenuItem value="">
                    <em>Unassigned</em>
                  </MenuItem>
                  {availableEducators.map((e) => (
                    <MenuItem key={e.id} value={e.id}>
                      {[e.firstName, e.lastName].filter(Boolean).join(" ") ||
                        e.email ||
                        e.username ||
                        e.id}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl variant="outlined" fullWidth>
                <InputLabel>Classes</InputLabel>
                <Select
                  multiple
                  value={form.classIds}
                  onChange={set("classIds")}
                  label="Classes"
                  renderValue={(sel) =>
                    sel
                      .map((id) => {
                        const c = availableClasses.find((x) => x.id === id);
                        return c ? c.name : id;
                      })
                      .join(", ")
                  }
                >
                  {availableClasses.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                      {c.educatorName ? ` (${c.educatorName})` : ""}
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

// ─── Schools tab ─────────────────────────────────────────────────────────────

function SchoolDialog({ open, mode, initial, onClose, onSubmit, saving }) {
  const [name, setName] = useState(initial?.name || "");
  useEffect(() => setName(initial?.name || ""), [initial, open]);

  const handleSave = () => {
    if (!name.trim()) {
      triggerErrorAlert("School name is required.");
      return;
    }
    onSubmit({ name: name.trim() });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{mode === "add" ? "New School" : "Edit School"}</DialogTitle>
      <DialogContent>
        <Box mt={1}>
          <TextField
            label="School Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            variant="outlined"
            fullWidth
            autoFocus
          />
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
          {saving ? <CircularProgress size={18} /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Classes tab ─────────────────────────────────────────────────────────────

function ClassDialog({
  open,
  mode,
  initial,
  schools,
  educators,
  onClose,
  onSubmit,
  saving,
}) {
  const [form, setForm] = useState({
    name: "",
    schoolId: "",
    educatorId: "",
    educatorName: "",
  });

  useEffect(() => {
    setForm({
      name: initial?.name || "",
      schoolId: initial?.schoolId || "",
      educatorId: initial?.educatorId || "",
      educatorName: initial?.educatorName || "",
    });
  }, [initial, open]);

  const set = (field) => (e) => {
    const value = e.target.value;
    setForm((p) => ({ ...p, [field]: value }));
  };

  const availableEducators = Array.isArray(educators)
    ? educators.filter((u) => !form.schoolId || u.schoolId === form.schoolId)
    : [];

  const handleSave = () => {
    if (!form.name.trim()) {
      triggerErrorAlert("Class name is required.");
      return;
    }
    if (!form.schoolId) {
      triggerErrorAlert("School is required.");
      return;
    }
    const ed = Array.isArray(educators)
      ? educators.find((e) => e.id === form.educatorId)
      : undefined;
    onSubmit({
      name: form.name.trim(),
      schoolId: form.schoolId,
      educatorId: form.educatorId || null,
      educatorName: ed
        ? [ed.firstName, ed.lastName].filter(Boolean).join(" ") ||
          ed.email ||
          ed.id
        : "",
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{mode === "add" ? "New Class" : "Edit Class"}</DialogTitle>
      <DialogContent>
        <Box mt={1} display="grid" gridGap={12}>
          <TextField
            label="Class Name"
            value={form.name}
            onChange={set("name")}
            variant="outlined"
            fullWidth
            autoFocus
          />
          <FormControl variant="outlined" fullWidth>
            <InputLabel>School</InputLabel>
            <Select
              value={form.schoolId}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  schoolId: e.target.value,
                  educatorId: "",
                }))
              }
              label="School"
              disabled={mode === "edit"}
            >
              {schools
                .filter((s) => s.isActive !== false)
                .map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>
          <FormControl variant="outlined" fullWidth>
            <InputLabel>Educator (optional)</InputLabel>
            <Select
              value={form.educatorId}
              onChange={set("educatorId")}
              label="Educator (optional)"
              disabled={!form.schoolId}
            >
              <MenuItem value="">
                <em>Unassigned</em>
              </MenuItem>
              {availableEducators.map((e) => (
                <MenuItem key={e.id} value={e.id}>
                  {[e.firstName, e.lastName].filter(Boolean).join(" ") ||
                    e.email ||
                    e.id}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
          {saving ? <CircularProgress size={18} /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Assign school admin dialog ───────────────────────────────────────────────

function AssignSchoolAdminDialog({
  open,
  users,
  schools,
  onClose,
  onSubmit,
  saving,
}) {
  const [userId, setUserId] = useState("");
  const [schoolId, setSchoolId] = useState("");

  useEffect(() => {
    setUserId("");
    setSchoolId("");
  }, [open]);

  const schoolAdmins = users.filter((u) => u.role === "schoolAdmin");

  const handleSave = () => {
    if (!userId || !schoolId) {
      triggerErrorAlert("User and school are required.");
      return;
    }
    onSubmit({ userId, schoolId });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Assign School Admin to School</DialogTitle>
      <DialogContent>
        <Box mt={1} display="grid" gridGap={12}>
          <FormControl variant="outlined" fullWidth>
            <InputLabel>School Admin</InputLabel>
            <Select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              label="School Admin"
            >
              {schoolAdmins.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {[u.firstName, u.lastName].filter(Boolean).join(" ") ||
                    u.email ||
                    u.id}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl variant="outlined" fullWidth>
            <InputLabel>School</InputLabel>
            <Select
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              label="School"
            >
              {schools
                .filter((s) => s.type === "regular")
                .map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>
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
          {saving ? <CircularProgress size={18} /> : "Assign"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Parent student form ──────────────────────────────────────────────────────

function ParentStudentDialog({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
  saving,
}) {
  const [form, setForm] = useState({
    password: "",
    firstName: "",
    lastName: "",
    accountabilityNote: "",
    nextCheckInDay: "",
  });

  useEffect(() => {
    setForm({
      password: "",
      firstName: initial?.firstName || "",
      lastName: initial?.lastName || "",
      accountabilityNote:
        initial?.accountabilityNote || initial?.accountability_note || "",
      nextCheckInDay:
        initial?.nextCheckInDay || initial?.next_check_in_day || "",
    });
  }, [initial, open]);

  const set = (field) => (e) => {
    const value =
      e &&
      typeof e === "object" &&
      Object.prototype.hasOwnProperty.call(e, "target")
        ? String(e.target?.value || "")
        : typeof e === "string"
          ? e
          : "";
    setForm((p) => ({ ...p, [field]: value }));
  };

  const handleSave = () => {
    const normalizedFirstName = String(form.firstName || "").trim();
    const normalizedLastName = String(form.lastName || "").trim();

    if (!normalizedFirstName) {
      triggerErrorAlert("First name is required.");
      return;
    }
    if (!normalizedLastName) {
      triggerErrorAlert("Last name is required.");
      return;
    }
    if (mode === "add" && String(form.password || "").trim().length < 6) {
      triggerErrorAlert("Password must be at least 6 characters.");
      return;
    }

    const payload = {
      password: String(form.password || ""),
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      accountabilityNote: String(form.accountabilityNote || "").trim(),
      nextCheckInDay: String(form.nextCheckInDay || "").trim(),
    };

    onSubmit(payload);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {mode === "add" ? "Add Student" : "Edit Student"}
      </DialogTitle>
      <DialogContent>
        <Box mt={1} display="grid" gridGap={12}>
          <TextField
            label="Password"
            value={form.password}
            onChange={set("password")}
            variant="outlined"
            fullWidth
            type="password"
            helperText={
              mode === "edit"
                ? "Leave blank to keep current"
                : "Min 6 characters"
            }
          />
          {mode === "add" && (
            <Typography variant="caption" color="textSecondary">
              Username is auto-generated from first and last name and emailed to
              you with the password.
            </Typography>
          )}
          <Box display="grid" gridTemplateColumns="1fr 1fr" gridGap={12}>
            <TextField
              label="First Name"
              value={form.firstName}
              onChange={set("firstName")}
              variant="outlined"
              fullWidth
            />
            <TextField
              label="Last Name"
              value={form.lastName}
              onChange={set("lastName")}
              variant="outlined"
              fullWidth
            />
          </Box>
          {mode === "edit" && (
            <>
              <TextField
                label="Coach Note"
                value={form.accountabilityNote}
                onChange={set("accountabilityNote")}
                variant="outlined"
                fullWidth
                multiline
                rows={2}
                helperText="Shown to student on their accountability panel."
              />
              <TextField
                label="Next Check-In Day"
                value={form.nextCheckInDay}
                onChange={set("nextCheckInDay")}
                variant="outlined"
                fullWidth
                type="date"
                InputLabelProps={{ shrink: true }}
                helperText="Optional target date for next manager check-in."
              />
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

// ─── Main page ────────────────────────────────────────────────────────────────

function ManagementInner() {
  const auth = useAuth();
  const history = useHistory();
  const { refreshRules, rulesLoading } = useContext(LessonContext);

  const [resolvedMgmtRole, setResolvedMgmtRole] = useState("");
  const [mgmtMeta, setMgmtMeta] = useState(null);

  useEffect(() => {
    let active = true;
    if (!auth.user) {
      setResolvedMgmtRole("");
      return () => {
        active = false;
      };
    }

    resolveMyRoleContext({})
      .then((result) => {
        if (!active) return;
        const role = String(result?.data?.role || "").trim();
        setResolvedMgmtRole(role);
      })
      .catch(() => {
        if (!active) return;
        setResolvedMgmtRole("");
      });

    return () => {
      active = false;
    };
  }, [auth.user]);

  const callerRoleFromAuth = auth.isAdmin
    ? "admin"
    : auth.isSchoolAdmin
      ? "schoolAdmin"
      : auth.role === "parent"
        ? "parent"
        : auth.role === "tutor"
          ? "tutor"
          : auth.role === "educator"
            ? "educator"
            : "student";

  const callerRoleFromServer =
    normalizeMgmtRole(resolvedMgmtRole) ||
    normalizeMgmtRole(mgmtMeta?.callerRole);

  const callerRole = callerRoleFromServer || callerRoleFromAuth;

  // ── Tabs ──
  const tabs = useMemo(() => {
    if (callerRole === "admin")
      return ["users", "schools", "classes", "requests"];
    if (callerRole === "schoolAdmin") return ["users", "classes"];
    if (callerRole === "parent" || callerRole === "tutor") return ["students"];
    if (callerRole === "educator") return ["students"];
    return [];
  }, [callerRole]);
  const [activeTab, setActiveTab] = useState(tabs[0]);

  useEffect(() => {
    if (!tabs.length) {
      if (activeTab) setActiveTab("");
      return;
    }
    if (!tabs.includes(activeTab)) {
      setActiveTab(tabs[0]);
    }
  }, [tabs, activeTab]);

  // ── Data ──
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schools, setSchools] = useState([]);
  const [classes, setClasses] = useState([]);
  const [users, setUsers] = useState([]);
  const [roleRequests, setRoleRequests] = useState([]);
  const [roleRequestsLoading, setRoleRequestsLoading] = useState(false);
  const [accountabilityQueue, setAccountabilityQueue] = useState([]);
  const [accountabilityLoading, setAccountabilityLoading] = useState(false);
  const [accountabilityFilters, setAccountabilityFilters] = useState({
    minInactiveDays: 2,
    includeNeedsFirstWin: true,
    includeOnTrack: false,
  });
  const [nudgingStudentId, setNudgingStudentId] = useState("");

  // ── Dialog state ──
  const [userDialog, setUserDialog] = useState({
    open: false,
    mode: "add",
    initial: null,
  });
  const [schoolDialog, setSchoolDialog] = useState({
    open: false,
    mode: "add",
    initial: null,
  });
  const [classDialog, setClassDialog] = useState({
    open: false,
    mode: "add",
    initial: null,
  });
  const [assignSADialog, setAssignSADialog] = useState(false);
  const [parentStudentDialog, setParentStudentDialog] = useState({
    open: false,
    mode: "add",
    initial: null,
  });

  // ── Parent bootstrap ──
  const [parentBootstrapped, setParentBootstrapped] = useState(false);

  // ── Load data ──
  const loadData = useCallback(
    async ({ force = false } = {}) => {
      const cacheKey = getMgmtCacheKey(auth.user?.uid, callerRole);
      const cached = force ? null : readMgmtCache(cacheKey);

      if (cached) {
        setSchools(cached.schools);
        setClasses(cached.classes);
        setUsers(cached.users);
        setLoading(false);
        // Cache is fresh — skip the network call entirely.
        if (!force) return;
      } else {
        setLoading(true);
      }

      try {
        // v2 data for all management roles.
        const result = await mgmtListData({});
        const d = result?.data || {};
        const payload = {
          schools: Array.isArray(d.schools) ? d.schools : [],
          classes: Array.isArray(d.classes) ? d.classes : [],
          users: Array.isArray(d.users) ? d.users : [],
        };
        setMgmtMeta(d.meta || null);
        setSchools(payload.schools);
        setClasses(payload.classes);
        setUsers(payload.users);
        writeMgmtCache(cacheKey, payload);
      } catch (err) {
        if (isUnauthenticatedError(err)) return;
        triggerErrorAlert(err?.message || "Could not load management data.");
      } finally {
        setLoading(false);
      }
    },
    [auth.user?.uid, callerRole],
  );

  // Bootstrap parent home scope once per load.
  useEffect(() => {
    if (
      auth.user &&
      (callerRole === "parent" || callerRole === "tutor") &&
      !parentBootstrapped
    ) {
      mgmtBootstrapParentHomeScope({})
        .then(() => setParentBootstrapped(true))
        .catch(() => setParentBootstrapped(true)); // non-fatal
    }
  }, [auth.user, callerRole, parentBootstrapped]);

  const loadRoleRequests = useCallback(async () => {
    if (callerRole !== "admin") {
      setRoleRequests([]);
      return;
    }

    setRoleRequestsLoading(true);
    try {
      const result = await adminListSchoolAdminRequests({
        status: "pending",
        limit: 200,
      });
      const list = Array.isArray(result?.data?.requests)
        ? result.data.requests
        : [];
      setRoleRequests(list);
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not load role requests.");
    } finally {
      setRoleRequestsLoading(false);
    }
  }, [callerRole]);

  useEffect(() => {
    loadRoleRequests();
  }, [loadRoleRequests]);

  useEffect(() => {
    if (auth.user) {
      loadData();
    }
  }, [auth.user, loadData]);

  // ── User CRUD ──
  const handleSaveUser = async (form) => {
    setSaving(true);
    try {
      const isEdit = userDialog.mode === "edit";
      if (isEdit) {
        const userId = userDialog.initial?.id;
        const initial = userDialog.initial || {};
        const updates = buildUserUpdates(initial, form);

        if (Object.keys(updates).length > 0) {
          await adminUpdateUser({ userId, updates });
        }

        // Only call class assignment when classIds actually changed. This
        // avoids unrelated edits (e.g., email) failing due to class-scope
        // constraints for legacy student records.
        const initialClassIds = Array.isArray(initial.classIds)
          ? initial.classIds
          : [];
        const nextClassIds = Array.isArray(form.classIds) ? form.classIds : [];
        const nextNormalized = normalizeClassIds(nextClassIds);

        if (
          form.role === "student" &&
          classIdsChanged(initialClassIds, nextClassIds)
        ) {
          await mgmtAssignStudentClasses({
            studentId: userId,
            classIds: nextNormalized,
          });
        }
      } else {
        const res = await adminCreateUser(form);
        const tmp = res?.data?.tempPassword;
        if (tmp) alert(`Student temp password: ${tmp}`);
        // Assign class membership for newly created students.
        if (
          form.role === "student" &&
          Array.isArray(form.classIds) &&
          form.classIds.length > 0
        ) {
          const newStudentId = res?.data?.userId;
          if (newStudentId) {
            await mgmtAssignStudentClasses({
              studentId: newStudentId,
              classIds: form.classIds,
            });
          }
        }
      }
      setUserDialog((p) => ({ ...p, open: false }));
      await loadData({ force: true });
      await loadAccountabilityQueue();
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not save user.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (user) => {
    if (!window.confirm(`Delete ${user.email || user.username}?`)) return;
    if (
      !window.confirm(
        "This will permanently delete the user, their lesson progress, and any custom lesson assignments. Continue?",
      )
    ) {
      return;
    }
    try {
      await adminDeleteUser({ userId: user.id });
      await loadData();
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not delete user.");
    }
  };

  const handleSendReset = async (user) => {
    try {
      await adminSendResetEmail({ userId: user.id });
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not send reset email.");
    }
  };

  // ── School CRUD ──
  const handleSaveSchool = async (form) => {
    setSaving(true);
    try {
      if (schoolDialog.mode === "add") {
        await mgmtCreateSchool({ name: form.name });
      } else {
        await mgmtUpdateSchool({
          schoolId: schoolDialog.initial.id,
          name: form.name,
        });
      }
      setSchoolDialog((p) => ({ ...p, open: false }));
      await loadData();
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not save school.");
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveSchool = async (school) => {
    if (
      !window.confirm(
        `Archive school "${school.name}"? Classes in this school will become inactive.`,
      )
    )
      return;
    try {
      await mgmtArchiveSchool({ schoolId: school.id });
      await loadData();
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not archive school.");
    }
  };

  // ── Class CRUD ──
  const handleSaveClass = async (form) => {
    setSaving(true);
    try {
      if (classDialog.mode === "add") {
        await mgmtCreateClass(form);
      } else {
        await mgmtUpdateClass({ classId: classDialog.initial.id, ...form });
      }
      setClassDialog((p) => ({ ...p, open: false }));
      await loadData();
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not save class.");
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveClass = async (cls) => {
    if (!window.confirm(`Archive class "${cls.name}"?`)) return;
    try {
      await mgmtArchiveClass({ classId: cls.id });
      await loadData();
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not archive class.");
    }
  };

  // ── Assign school admin ──
  const handleAssignSchoolAdmin = async ({ userId, schoolId }) => {
    setSaving(true);
    try {
      const res = await mgmtAssignSchoolAdmin({ userId, schoolId });
      const assignedId = String(res?.data?.verifiedSchoolId || schoolId || "");
      const assignedSchool = schools.find((s) => s.id === assignedId);

      // Immediate UI consistency while the fresh load is in-flight.
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                schoolId: assignedId,
                schoolName:
                  assignedSchool?.name ||
                  assignedSchool?.schoolName ||
                  assignedId,
              }
            : u,
        ),
      );

      setAssignSADialog(false);
      await loadData();
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not assign school admin.");
    } finally {
      setSaving(false);
    }
  };

  // ── Parent student CRUD ──
  const handleSaveParentStudent = async (form) => {
    setSaving(true);
    try {
      if (parentStudentDialog.mode === "add") {
        const res = await mgmtParentCreateStudent(form);
        const username = String(res?.data?.userId || "").trim();
        alert(
          `Sound Spell Type Online says You have created a student with the login username of (${username || "unknown"}). Please make a note of it.`,
        );
      } else {
        await adminUpdateUser({
          userId: parentStudentDialog.initial.id,
          updates: {
            firstName: form.firstName,
            lastName: form.lastName,
            accountabilityNote: form.accountabilityNote,
            accountability_note: form.accountabilityNote,
            nextCheckInDay: form.nextCheckInDay,
            next_check_in_day: form.nextCheckInDay,
            ...(form.password ? { password: form.password } : {}),
          },
        });
      }
      setParentStudentDialog((p) => ({ ...p, open: false }));
      await loadData({ force: true });
      await loadAccountabilityQueue();
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not save student.");
    } finally {
      setSaving(false);
    }
  };

  // ── Debug raw data ──
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState(null);
  const handleDebug = async () => {
    try {
      const result = await mgmtListData({});
      const d = result?.data || {};
      const staffUsers = (d.users || []).filter((u) => u.role !== "student");

      // For each schoolAdmin, fetch raw Firestore doc to see exactly what's stored
      const schoolAdmins = staffUsers.filter((u) => u.role === "schoolAdmin");
      const rawDocs = {};
      await Promise.all(
        schoolAdmins.map(async (u) => {
          try {
            const r = await mgmtDebugUser({ userId: u.id });
            rawDocs[u.id] = r?.data;
          } catch (e) {
            rawDocs[u.id] = { error: e.message };
          }
        }),
      );

      setDebugData({
        schools: (d.schools || []).map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          isActive: s.isActive,
        })),
        staffUsers: staffUsers.map((u) => ({
          id: u.id,
          role: u.role,
          email: u.email,
          schoolId: u.schoolId,
          schoolName: u.schoolName,
        })),
        rawFirestoreDocs: rawDocs,
        meta: d.meta,
      });
      setDebugOpen(true);
    } catch (err) {
      alert("Debug error: " + err.message);
    }
  };

  // ── Helpers ──
  const toSchoolId = (value) => {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object") {
      const direct = String(value.id || value.schoolId || "").trim();
      if (direct) return direct;
      const path = String(
        value.path || value._path?.canonicalString || "",
      ).trim();
      if (path) {
        const parts = path.split("/").filter(Boolean);
        return String(parts[parts.length - 1] || "").trim();
      }
      const segs = Array.isArray(value._path?.segments)
        ? value._path.segments
        : Array.isArray(value.segments)
          ? value.segments
          : null;
      if (segs && segs.length > 0) {
        return String(segs[segs.length - 1] || "").trim();
      }
    }
    return "";
  };

  const schoolName = (value) => {
    const id = toSchoolId(value);
    if (!id) return "—";
    const school = schoolById[id];
    if (school) {
      return (
        school.name ||
        school.schoolName ||
        school.title ||
        school.displayName ||
        school.id ||
        "—"
      );
    }
    return id || "—";
  };

  const schoolNameForUser = (u) => {
    const directName = String(u.schoolName || "").trim();
    if (directName) return formatManagedByLabel(directName);
    return schoolName(u.schoolId || u.school || u.homeSchoolId);
  };
  const canUseAccountabilityQueue =
    callerRole === "admin" ||
    callerRole === "schoolAdmin" ||
    callerRole === "educator" ||
    callerRole === "parent" ||
    callerRole === "tutor";
  const queueVisibleTab = activeTab === "users" || activeTab === "students";

  const userById = useMemo(() => {
    const map = new Map();
    users.forEach((u) => {
      const id = String(u?.id || "").trim();
      if (id) map.set(id, u);
    });
    return map;
  }, [users]);

  const loadAccountabilityQueue = useCallback(async () => {
    if (!canUseAccountabilityQueue || !auth.user) {
      setAccountabilityQueue([]);
      return;
    }

    setAccountabilityLoading(true);
    try {
      const result = await mgmtListAccountabilityQueue({
        minInactiveDays: accountabilityFilters.minInactiveDays,
        includeNeedsFirstWin: accountabilityFilters.includeNeedsFirstWin,
        includeOnTrack: accountabilityFilters.includeOnTrack,
        limit: 25,
      });
      const queue = Array.isArray(result?.data?.queue) ? result.data.queue : [];
      setAccountabilityQueue(queue);
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not load accountability queue.");
    } finally {
      setAccountabilityLoading(false);
    }
  }, [
    canUseAccountabilityQueue,
    auth.user,
    accountabilityFilters.minInactiveDays,
    accountabilityFilters.includeNeedsFirstWin,
    accountabilityFilters.includeOnTrack,
  ]);

  useEffect(() => {
    if (!queueVisibleTab) return;
    loadAccountabilityQueue();
  }, [queueVisibleTab, loadAccountabilityQueue, users.length]);

  const handleMarkNudgeSent = async (row) => {
    const studentId = String(row?.id || "").trim();
    if (!studentId) return;

    setNudgingStudentId(studentId);
    try {
      await mgmtRecordAccountabilityReminder({
        studentId,
        channel: "in_app",
        note: String(row?.accountabilityNote || "").trim(),
      });
      await loadAccountabilityQueue();
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not mark nudge as sent.");
    } finally {
      setNudgingStudentId("");
    }
  };

  const renderAccountabilityQueue = () => (
    <Paper style={{ marginBottom: 16, padding: 12 }}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={1}
      >
        <Typography variant="h6">Accountability Queue</Typography>
        <Button
          size="small"
          startIcon={<RefreshIcon />}
          onClick={loadAccountabilityQueue}
          disabled={accountabilityLoading}
        >
          Refresh Queue
        </Button>
      </Box>
      <Box display="flex" alignItems="center" style={{ gap: 8 }} mb={1}>
        <FormControl variant="outlined" size="small" style={{ minWidth: 180 }}>
          <InputLabel id="min-inactive-days-label">
            Inactive Threshold
          </InputLabel>
          <Select
            labelId="min-inactive-days-label"
            value={String(accountabilityFilters.minInactiveDays)}
            onChange={(e) =>
              setAccountabilityFilters((prev) => ({
                ...prev,
                minInactiveDays: Number(e.target.value),
              }))
            }
            label="Inactive Threshold"
          >
            <MenuItem value="0">0+ days</MenuItem>
            <MenuItem value="2">2+ days</MenuItem>
            <MenuItem value="3">3+ days</MenuItem>
            <MenuItem value="5">5+ days</MenuItem>
          </Select>
        </FormControl>
        <Button
          size="small"
          variant={
            accountabilityFilters.includeNeedsFirstWin
              ? "contained"
              : "outlined"
          }
          color="default"
          onClick={() =>
            setAccountabilityFilters((prev) => ({
              ...prev,
              includeNeedsFirstWin: !prev.includeNeedsFirstWin,
            }))
          }
        >
          Needs First Win
        </Button>
        <Button
          size="small"
          variant={
            accountabilityFilters.includeOnTrack ? "contained" : "outlined"
          }
          color="default"
          onClick={() =>
            setAccountabilityFilters((prev) => ({
              ...prev,
              includeOnTrack: !prev.includeOnTrack,
            }))
          }
        >
          Include On Track
        </Button>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Student</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Inactive Days</TableCell>
              <TableCell>Next Check-In</TableCell>
              <TableCell>Last Reminder</TableCell>
              <TableCell>Coach Note</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {accountabilityLoading ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            ) : accountabilityQueue.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  No students match these filters.
                </TableCell>
              </TableRow>
            ) : (
              accountabilityQueue.map((row) => {
                const mappedUser = userById.get(String(row.id || "").trim());
                const displayName =
                  [row.firstName, row.lastName].filter(Boolean).join(" ") ||
                  row.username ||
                  row.id ||
                  "—";

                return (
                  <TableRow key={row.id}>
                    <TableCell>{displayName}</TableCell>
                    <TableCell>
                      <Chip size="small" label={row?.status?.label || "—"} />
                    </TableCell>
                    <TableCell align="right">
                      {Number.isFinite(row.daysSincePractice)
                        ? row.daysSincePractice
                        : "—"}
                    </TableCell>
                    <TableCell>{row.nextCheckInDay || "—"}</TableCell>
                    <TableCell>
                      {row.lastReminder?.at ? (
                        <>
                          {formatDate(row.lastReminder.at)}
                          {row.lastReminder?.channel
                            ? ` (${String(row.lastReminder.channel)
                                .replace(/_/g, " ")
                                .toUpperCase()})`
                            : ""}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{row.accountabilityNote || "—"}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="primary"
                        onClick={() =>
                          history.push(
                            `/student-progress?student=${encodeURIComponent(String(row.username || row.id || ""))}`,
                          )
                        }
                      >
                        View
                      </Button>
                      <Button
                        size="small"
                        color="primary"
                        disabled={!mappedUser}
                        onClick={() =>
                          mappedUser &&
                          setParentStudentDialog({
                            open: true,
                            mode: "edit",
                            initial: mappedUser,
                          })
                        }
                      >
                        Set Check-In
                      </Button>
                      <Button
                        size="small"
                        color="secondary"
                        disabled={nudgingStudentId === row.id}
                        onClick={() => handleMarkNudgeSent(row)}
                      >
                        {nudgingStudentId === row.id
                          ? "Saving..."
                          : "Nudge Sent"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
  const getUserDisplayName = (u) => {
    const fullName = [u?.firstName, u?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (fullName) return fullName;

    const explicitName = String(u?.displayName || u?.name || "").trim();
    if (explicitName) return explicitName;

    const username = String(u?.username || "").trim();
    if (username) return username;

    return String(u?.email || "").trim() || "—";
  };

  const deriveFirstLastForUser = useCallback((u) => {
    const first = String(u?.firstName || "").trim();
    const last = String(u?.lastName || "").trim();
    if (first || last) return { first, last };

    const explicit = String(u?.displayName || u?.name || "").trim();
    if (!explicit) return { first: "", last: "" };

    const parts = explicit.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      return { first: explicit, last: "" };
    }

    return {
      first: parts.slice(0, -1).join(" "),
      last: parts[parts.length - 1],
    };
  }, []);

  const getUserLastFirstDisplay = useCallback(
    (u) => {
      const { first, last } = deriveFirstLastForUser(u);
      if (first && last) return `${last}, ${first}`;
      if (last) return last;
      if (first) return first;
      return getUserDisplayName(u);
    },
    [deriveFirstLastForUser],
  );

  const userNameSortKey = useCallback(
    (u) => {
      const derived = deriveFirstLastForUser(u);
      const last = String(derived.last || "")
        .trim()
        .toLowerCase();
      const first = String(derived.first || "")
        .trim()
        .toLowerCase();
      const display = getUserDisplayName(u).toLowerCase();
      const idKey = String(u?.username || u?.email || u?.id || "")
        .trim()
        .toLowerCase();
      return { last, first, display, idKey };
    },
    [deriveFirstLastForUser],
  );

  const compareUsersByName = useCallback(
    (a, b) => {
      const ak = userNameSortKey(a);
      const bk = userNameSortKey(b);
      return (
        ak.last.localeCompare(bk.last) ||
        ak.first.localeCompare(bk.first) ||
        ak.display.localeCompare(bk.display) ||
        ak.idKey.localeCompare(bk.idKey)
      );
    },
    [userNameSortKey],
  );
  const schoolById = useMemo(() => {
    const out = {};
    schools.forEach((s) => {
      const key = toSchoolId(s.id || s.schoolId);
      if (key) out[key] = s;
    });
    return out;
  }, [schools]);

  const classById = useMemo(() => {
    const out = {};
    classes.forEach((c) => {
      if (c?.id) out[c.id] = c;
    });
    return out;
  }, [classes]);

  const isHomeScopeManager = useMemo(() => {
    if (callerRole === "parent" || callerRole === "tutor") return true;
    if (callerRole !== "educator") return false;
    // Legacy parent/tutor accounts can sometimes resolve as educator but still
    // only own home-scope classes/students.
    if (classes.some((c) => c?.schoolType === "home")) return true;
    return users.some(
      (u) =>
        u?.role === "student" &&
        (u?.ownerId === auth.user?.uid || u?.parentOwnerId === auth.user?.uid),
    );
  }, [callerRole, classes, users, auth.user?.uid]);

  const className = (id) => classById[id]?.name || id || "—";
  const ownershipStats = useMemo(() => {
    const countByOwnerId = new Map();
    const roleByOwnerId = new Map();

    users.forEach((u) => {
      if (normalizeMgmtRole(u?.role) !== "student") return;
      const ownerId = String(u?.ownerId || u?.parentOwnerId || "").trim();
      if (!ownerId) return;

      countByOwnerId.set(ownerId, (countByOwnerId.get(ownerId) || 0) + 1);

      const ownerRole = normalizeMgmtRole(u?.ownerRole || "");
      if (ownerRole === "tutor") {
        roleByOwnerId.set(ownerId, "tutor");
      } else if (!roleByOwnerId.has(ownerId)) {
        roleByOwnerId.set(ownerId, "parent");
      }
    });

    return { countByOwnerId, roleByOwnerId };
  }, [users]);

  const effectiveRoleForUser = useCallback(
    (u) => {
      const normalized = normalizeMgmtRole(u?.role) || "student";
      if (normalized !== "student") return normalized;

      const userId = String(u?.id || "").trim();
      if (!userId) return normalized;

      const managedCount = ownershipStats.countByOwnerId.get(userId) || 0;
      if (managedCount <= 0) return normalized;

      return ownershipStats.roleByOwnerId.get(userId) || "parent";
    },
    [ownershipStats],
  );

  const educators = useMemo(
    () => users.filter((u) => effectiveRoleForUser(u) === "educator"),
    [users, effectiveRoleForUser],
  );
  const students = useMemo(
    () => users.filter((u) => effectiveRoleForUser(u) === "student"),
    [users, effectiveRoleForUser],
  );
  const visibleUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          effectiveRoleForUser(u) !== "student" || callerRole !== "educator",
      ),
    [users, callerRole, effectiveRoleForUser],
  );

  const sortedVisibleUsers = useMemo(() => {
    const base = [...visibleUsers];
    if (base.length <= 1) return base;

    // Educator view only contains non-student rows; simple name ordering is enough.
    if (callerRole === "educator") {
      return base.sort(compareUsersByName);
    }

    const managerById = new Map();
    const managers = [];
    const studentsOnly = [];

    base.forEach((u) => {
      if (effectiveRoleForUser(u) === "student") {
        studentsOnly.push(u);
      } else {
        managers.push(u);
        managerById.set(String(u.id || "").trim(), u);
      }
    });

    const managerComparator = (a, b) => {
      const aRank = MANAGER_ROLE_ORDER[effectiveRoleForUser(a)] ?? 99;
      const bRank = MANAGER_ROLE_ORDER[effectiveRoleForUser(b)] ?? 99;
      return aRank - bRank || compareUsersByName(a, b);
    };

    managers.sort(managerComparator);

    const studentsByManagerId = new Map();
    const unassignedStudents = [];
    studentsOnly.forEach((student) => {
      const ownerId = String(
        student?.ownerId || student?.parentOwnerId || "",
      ).trim();
      const educatorId = String(student?.educator || "").trim();
      const managerId = ownerId || educatorId;

      if (managerId && managerById.has(managerId)) {
        const existing = studentsByManagerId.get(managerId) || [];
        existing.push(student);
        studentsByManagerId.set(managerId, existing);
      } else {
        unassignedStudents.push(student);
      }
    });

    const ordered = [];
    managers.forEach((manager) => {
      ordered.push(manager);
      const managerId = String(manager?.id || "").trim();
      const managedStudents = [
        ...(studentsByManagerId.get(managerId) || []),
      ].sort(compareUsersByName);
      ordered.push(...managedStudents);
    });

    if (unassignedStudents.length > 0) {
      ordered.push(...unassignedStudents.sort(compareUsersByName));
    }

    return ordered;
  }, [visibleUsers, callerRole, effectiveRoleForUser, compareUsersByName]);

  const sortedParentStudents = useMemo(
    () =>
      users
        .filter((u) => effectiveRoleForUser(u) === "student")
        .sort(compareUsersByName),
    [users, effectiveRoleForUser, compareUsersByName],
  );
  const regularSchools = useMemo(
    () => schools.filter((s) => s.type === "regular"),
    [schools],
  );
  const nonHomeClasses = useMemo(
    () => classes.filter((c) => c.schoolType !== "home"),
    [classes],
  );

  const studentsByClassId = useMemo(() => {
    const acc = {};
    classes.forEach((c) => {
      acc[c.id] = Array.isArray(c.studentIds) ? c.studentIds : [];
    });
    return acc;
  }, [classes]);

  // Pre-compute student count per user so the render loop doesn't do repeated
  // O(N) filters per row.
  const studentCountByUserId = useMemo(() => {
    const map = new Map();
    const adminCount = students.length;

    // Build a map of schoolId → student count for schoolAdmins.
    const countBySchoolId = new Map();
    students.forEach((s) => {
      const sid = toSchoolId(s.schoolId || s.school || s.homeSchoolId);
      if (sid) countBySchoolId.set(sid, (countBySchoolId.get(sid) || 0) + 1);
    });

    // Build a map of ownerId/legacy parentOwnerId → student count.
    const countByOwnerId = new Map();
    students.forEach((s) => {
      const ownerId = String(s.ownerId || s.parentOwnerId || "");
      if (ownerId) {
        countByOwnerId.set(ownerId, (countByOwnerId.get(ownerId) || 0) + 1);
      }
    });

    users.forEach((u) => {
      if (!u?.id) return;
      const effectiveRole = effectiveRoleForUser(u);
      if (effectiveRole === "admin") {
        map.set(u.id, adminCount);
      } else if (effectiveRole === "schoolAdmin") {
        const sid = toSchoolId(u.schoolId || u.school || u.homeSchoolId);
        map.set(u.id, sid ? countBySchoolId.get(sid) || 0 : 0);
      } else if (effectiveRole === "educator") {
        const classIds = Array.isArray(u.classIds) ? u.classIds : [];
        const uniqueStudentIds = new Set();
        classIds.forEach((classId) => {
          (studentsByClassId[classId] || []).forEach((studentId) => {
            uniqueStudentIds.add(String(studentId));
          });
        });
        map.set(u.id, uniqueStudentIds.size);
      } else if (effectiveRole === "parent" || effectiveRole === "tutor") {
        map.set(u.id, countByOwnerId.get(u.id) || 0);
      } else {
        map.set(u.id, 0);
      }
    });
    return map;
  }, [users, students, studentsByClassId, effectiveRoleForUser]);

  const userStudentCount = (u) => studentCountByUserId.get(u?.id) ?? 0;

  // Pre-compute display school name per user so the render loop avoids
  // repeated toSchoolId / schoolById lookups on every row paint.
  const schoolNameByUserId = useMemo(() => {
    const map = new Map();
    users.forEach((u) => {
      if (!u?.id) return;
      const directName = String(u.schoolName || "").trim();
      if (directName) {
        map.set(u.id, formatManagedByLabel(directName));
        return;
      }
      const id = toSchoolId(u.schoolId || u.school || u.homeSchoolId);
      if (!id) {
        map.set(u.id, "—");
        return;
      }
      const school = schoolById[id];
      map.set(
        u.id,
        school
          ? school.name ||
              school.schoolName ||
              school.title ||
              school.displayName ||
              school.id ||
              "—"
          : id || "—",
      );
    });
    return map;
  }, [users, schoolById]);

  const isSelfManagedAdult = (u) => {
    const effectiveRole = effectiveRoleForUser(u);
    if (!u || (effectiveRole !== "parent" && effectiveRole !== "tutor")) {
      return false;
    }
    return userStudentCount(u) === 0;
  };

  const handleRoleRequestDecision = async (request, decision) => {
    if (!request?.id) return;
    const decisionNote =
      decision === "deny"
        ? window.prompt("Optional denial note:", "") || ""
        : "";
    setSaving(true);
    try {
      await adminReviewSchoolAdminRequest({
        requestId: request.id,
        decision,
        decisionNote,
      });
      await Promise.all([loadData({ force: true }), loadRoleRequests()]);
    } catch (err) {
      if (isUnauthenticatedError(err)) return;
      triggerErrorAlert(err?.message || "Could not review request.");
    } finally {
      setSaving(false);
    }
  };

  const renderRequests = () => (
    <>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h6">School Admin Requests</Typography>
        <Button
          startIcon={<RefreshIcon />}
          onClick={loadRoleRequests}
          disabled={roleRequestsLoading}
        >
          Refresh
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>School</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roleRequestsLoading ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : roleRequests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  No pending requests.
                </TableCell>
              </TableRow>
            ) : (
              roleRequests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell>{r.requesterEmail || "—"}</TableCell>
                  <TableCell>
                    {r.requestedSchoolName || r.requestedSchoolId || "—"}
                  </TableCell>
                  <TableCell>{r.reason || "—"}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="primary"
                      onClick={() => handleRoleRequestDecision(r, "approve")}
                      disabled={saving}
                    >
                      Approve
                    </Button>
                    <Button
                      size="small"
                      color="secondary"
                      onClick={() => handleRoleRequestDecision(r, "deny")}
                      disabled={saving}
                    >
                      Deny
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );

  // ─── Render tabs ──────────────────────────────────────────────────────────

  const renderUsers = () => (
    <>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h6">Users</Typography>
        <Box display="flex" style={{ gap: 8 }}>
          {callerRole === "admin" && (
            <Button
              variant="outlined"
              color="default"
              size="small"
              onClick={() => setAssignSADialog(true)}
            >
              Assign School Admin
            </Button>
          )}
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={() =>
              setUserDialog({ open: true, mode: "add", initial: null })
            }
          >
            Add User
          </Button>
        </Box>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email / Username</TableCell>
              <TableCell>Password</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Accountability</TableCell>
              <TableCell>School</TableCell>
              <TableCell>Classes</TableCell>
              <TableCell align="right">Students</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : sortedVisibleUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              sortedVisibleUsers.map((u) => {
                const effectiveRole = effectiveRoleForUser(u);
                const isStudent = effectiveRole === "student";
                const accountabilityStatus = isStudent
                  ? getStudentAccountabilityStatus(u)
                  : null;

                return (
                  <TableRow key={u.id}>
                    <TableCell>{getUserLastFirstDisplay(u)}</TableCell>
                    <TableCell>{u.email || u.username || "—"}</TableCell>
                    <TableCell>
                      {u.hasPassword === false ? "—" : "********"}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={prettyRole(effectiveRole)} />
                    </TableCell>
                    <TableCell>
                      {isStudent ? (
                        <Chip
                          size="small"
                          label={accountabilityStatus.label}
                          color={accountabilityStatus.color}
                        />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {isSelfManagedAdult(u)
                        ? "Self"
                        : (schoolNameByUserId.get(u.id) ?? "—")}
                    </TableCell>
                    <TableCell>
                      {isSelfManagedAdult(u) ? (
                        <Chip size="small" label="Self" />
                      ) : (
                        <>
                          {(u.classIds || []).slice(0, 3).map((id) => (
                            <Chip
                              key={id}
                              size="small"
                              label={className(id)}
                              style={{ marginRight: 4 }}
                            />
                          ))}
                          {(u.classIds || []).length > 3 && (
                            <Chip
                              size="small"
                              label={`+${u.classIds.length - 3}`}
                            />
                          )}
                          {(u.classIds || []).length === 0 && "—"}
                        </>
                      )}
                    </TableCell>
                    <TableCell align="right">{userStudentCount(u)}</TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() =>
                          setUserDialog({
                            open: true,
                            mode: "edit",
                            initial: {
                              id: u.id,
                              role: effectiveRole,
                              email: u.email,
                              username: u.username,
                              password: "",
                              firstName: u.firstName,
                              lastName: u.lastName,
                              schoolId: u.schoolId || "",
                              educatorId: u.educator || "",
                              classIds: u.classIds || [],
                            },
                          })
                        }
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      {isStudent && (
                        <Button
                          size="small"
                          color="primary"
                          onClick={() =>
                            setParentStudentDialog({
                              open: true,
                              mode: "edit",
                              initial: u,
                            })
                          }
                        >
                          Set Check-In
                        </Button>
                      )}
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteUser(u)}
                        disabled={callerRole !== "admin" && u.role === "admin"}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleSendReset(u)}
                        disabled={!u.email}
                      >
                        <LockIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );

  const renderSchools = () => (
    <>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h6">Schools</Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={() =>
            setSchoolDialog({ open: true, mode: "add", initial: null })
          }
        >
          Add School
        </Button>
      </Box>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : regularSchools.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  No schools yet.
                </TableCell>
              </TableRow>
            ) : (
              regularSchools.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>{s.type}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={s.isActive ? "Active" : "Archived"}
                      color={s.isActive ? "primary" : "default"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() =>
                        setSchoolDialog({
                          open: true,
                          mode: "edit",
                          initial: s,
                        })
                      }
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleArchiveSchool(s)}
                      disabled={!s.isActive}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );

  const renderClasses = () => (
    <>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h6">Classes</Typography>
        {(callerRole === "admin" || callerRole === "schoolAdmin") && (
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={() =>
              setClassDialog({ open: true, mode: "add", initial: null })
            }
          >
            Add Class
          </Button>
        )}
      </Box>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>School</TableCell>
              <TableCell>Educator</TableCell>
              <TableCell align="right">Students</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : nonHomeClasses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  No classes yet.
                </TableCell>
              </TableRow>
            ) : (
              nonHomeClasses.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{schoolName(c.schoolId)}</TableCell>
                  <TableCell>{c.educatorName || "Unassigned"}</TableCell>
                  <TableCell align="right">
                    {(c.studentIds || []).length}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={c.isActive ? "Active" : "Archived"}
                      color={c.isActive ? "primary" : "default"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {(callerRole === "admin" ||
                      callerRole === "schoolAdmin") && (
                      <>
                        <IconButton
                          size="small"
                          onClick={() =>
                            setClassDialog({
                              open: true,
                              mode: "edit",
                              initial: c,
                            })
                          }
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleArchiveClass(c)}
                          disabled={!c.isActive}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );

  const renderParentStudents = () => (
    <>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h6">My Students</Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={() =>
            setParentStudentDialog({ open: true, mode: "add", initial: null })
          }
        >
          Add Student
        </Button>
      </Box>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Username</TableCell>
              <TableCell>First Name</TableCell>
              <TableCell>Last Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Progress</TableCell>
              <TableCell align="right">Edit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : sortedParentStudents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  No students yet. Add your first student!
                </TableCell>
              </TableRow>
            ) : (
              sortedParentStudents.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.username}</TableCell>
                  <TableCell>{u.firstName || "—"}</TableCell>
                  <TableCell>{u.lastName || "—"}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={getStudentAccountabilityStatus(u).label}
                      color={getStudentAccountabilityStatus(u).color}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="primary"
                      onClick={() =>
                        history.push(
                          `/student-progress?student=${encodeURIComponent(String(u.username || u.id || ""))}`,
                        )
                      }
                    >
                      View
                    </Button>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() =>
                        setParentStudentDialog({
                          open: true,
                          mode: "edit",
                          initial: u,
                        })
                      }
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );

  // ─── Top bar buttons (admin only extras) ─────────────────────────────────

  const renderAdminToolbar = () =>
    callerRole === "admin" ? (
      <Box display="flex" style={{ gap: 8 }}>
        <Button
          variant="outlined"
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
      </Box>
    ) : null;

  // ─── Tab label helpers ────────────────────────────────────────────────────

  const tabLabel = (t) => {
    if (t === "users")
      return (
        <Box display="flex" alignItems="center" style={{ gap: 4 }}>
          <PeopleIcon fontSize="small" /> Users
        </Box>
      );
    if (t === "schools")
      return (
        <Box display="flex" alignItems="center" style={{ gap: 4 }}>
          <SchoolIcon fontSize="small" /> Schools
        </Box>
      );
    if (t === "classes")
      return (
        <Box display="flex" alignItems="center" style={{ gap: 4 }}>
          <ClassIcon fontSize="small" /> Classes
        </Box>
      );
    if (t === "requests")
      return (
        <Box display="flex" alignItems="center" style={{ gap: 4 }}>
          <PeopleIcon fontSize="small" /> Requests
        </Box>
      );
    return (
      <Box display="flex" alignItems="center" style={{ gap: 4 }}>
        <PeopleIcon fontSize="small" /> My Students
      </Box>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Container maxWidth="lg" style={{ marginTop: 24, marginBottom: 32 }}>
      {/* Page header */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h5">Management</Typography>
        <Box display="flex" alignItems="center" style={{ gap: 8 }}>
          {renderAdminToolbar()}
          <Button
            startIcon={<RefreshIcon />}
            onClick={() => loadData({ force: true })}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {/* Tabs */}
      {tabs.length > 1 && (
        <Paper style={{ marginBottom: 16 }}>
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            indicatorColor="primary"
            textColor="primary"
            variant="scrollable"
            scrollButtons="auto"
          >
            {tabs.map((t) => (
              <Tab key={t} value={t} label={tabLabel(t)} />
            ))}
          </Tabs>
        </Paper>
      )}

      {queueVisibleTab &&
        canUseAccountabilityQueue &&
        renderAccountabilityQueue()}

      {activeTab === "users" && renderUsers()}
      {activeTab === "schools" && renderSchools()}
      {activeTab === "classes" && renderClasses()}
      {activeTab === "requests" && renderRequests()}
      {activeTab === "students" &&
        (isHomeScopeManager ? renderParentStudents() : renderClasses())}

      {/* Dialogs */}
      <UserDialog
        open={userDialog.open}
        mode={userDialog.mode}
        callerRole={callerRole}
        initial={userDialog.initial}
        schools={schools}
        classes={classes}
        users={users}
        onClose={() => setUserDialog((p) => ({ ...p, open: false }))}
        onSubmit={handleSaveUser}
        saving={saving}
      />

      <SchoolDialog
        open={schoolDialog.open}
        mode={schoolDialog.mode}
        initial={schoolDialog.initial}
        onClose={() => setSchoolDialog((p) => ({ ...p, open: false }))}
        onSubmit={handleSaveSchool}
        saving={saving}
      />

      <ClassDialog
        open={classDialog.open}
        mode={classDialog.mode}
        initial={classDialog.initial}
        schools={schools}
        educators={educators}
        onClose={() => setClassDialog((p) => ({ ...p, open: false }))}
        onSubmit={handleSaveClass}
        saving={saving}
      />

      <AssignSchoolAdminDialog
        open={assignSADialog}
        users={users}
        schools={schools}
        onClose={() => setAssignSADialog(false)}
        onSubmit={handleAssignSchoolAdmin}
        saving={saving}
      />

      <ParentStudentDialog
        open={parentStudentDialog.open}
        mode={parentStudentDialog.mode}
        initial={parentStudentDialog.initial}
        onClose={() => setParentStudentDialog((p) => ({ ...p, open: false }))}
        onSubmit={handleSaveParentStudent}
        saving={saving}
      />

      {/* Temporary debug dialog — remove when school name issue is resolved */}
      {callerRole === "admin" && (
        <>
          <Box mt={3}>
            <Button size="small" variant="outlined" onClick={handleDebug}>
              Debug: Show Raw API Data
            </Button>
          </Box>
          <Dialog
            open={debugOpen}
            onClose={() => setDebugOpen(false)}
            fullWidth
            maxWidth="md"
          >
            <DialogTitle>Raw mgmtListData response</DialogTitle>
            <DialogContent>
              <pre
                style={{
                  fontSize: 11,
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {JSON.stringify(debugData, null, 2)}
              </pre>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDebugOpen(false)}>Close</Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Container>
  );
}

export default function Management() {
  return (
    <ManagementErrorBoundary>
      <ManagementInner />
    </ManagementErrorBoundary>
  );
}
