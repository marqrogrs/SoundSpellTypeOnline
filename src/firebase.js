// Use compat API so existing namespaced calls continue to work on newer SDKs.
import firebase from "firebase/compat/app";

// Add the Firebase products that you want to use
import "firebase/compat/auth";
import "firebase/compat/firestore"; //database
import "firebase/compat/functions";
import { getCurrentPerfSessionId, setPerfMetric } from "./util/perfSession";

const firebaseConfig = {
  apiKey: "AIzaSyBC9FNI_d_Lse9Kw1u_1jbWUvqcHShHXZQ",
  authDomain: "soundspeller-c5e53.firebaseapp.com",
  databaseURL: "https://soundspeller-c5e53.firebaseio.com",
  projectId: "soundspeller-c5e53",
  storageBucket: "soundspeller-c5e53.appspot.com",
  messagingSenderId: "254713323790",
  appId: "1:254713323790:web:34db07de840605a21b375f",
  measurementId: "G-CMHKZ57DDP",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const inflightCallableRequests = new Map();

const stableStringify = (value) => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
};

const recordFirebaseMetric = (metricName, durationMs, details = {}) => {
  const roundedMs = Math.round(durationMs);
  const sessionId = getCurrentPerfSessionId();
  if (sessionId) {
    setPerfMetric(metricName, roundedMs, { sessionId });
  }

  console.info("[perf] firebase-client", {
    metric: metricName,
    ms: roundedMs,
    ...details,
  });
};

const timedCallable = (name, options = {}) => {
  const callable = firebase.functions().httpsCallable(name);
  const dedupeInFlight = Boolean(options.dedupeInFlight);
  return async (data) => {
    const requestKey = dedupeInFlight
      ? `${name}:${stableStringify(data ?? null)}`
      : "";

    if (dedupeInFlight && inflightCallableRequests.has(requestKey)) {
      return inflightCallableRequests.get(requestKey);
    }

    const startedAt = nowMs();
    const requestPromise = callable(data)
      .then((result) => {
        recordFirebaseMetric(`fn_${name}Ms`, nowMs() - startedAt, {
          callable: name,
          status: "ok",
          deduped: dedupeInFlight,
        });
        return result;
      })
      .catch((error) => {
        recordFirebaseMetric(`fn_${name}Ms`, nowMs() - startedAt, {
          callable: name,
          status: "error",
          code: String(error?.code || ""),
          deduped: dedupeInFlight,
        });
        throw error;
      })
      .finally(() => {
        if (dedupeInFlight) {
          inflightCallableRequests.delete(requestKey);
        }
      });

    if (dedupeInFlight) {
      inflightCallableRequests.set(requestKey, requestPromise);
    }

    return requestPromise;
  };
};

// Keep analytics out of the main bundle. It is not used directly by the app,
// so load it only in production and only after the browser bootstraps.
if (typeof window !== "undefined" && process.env.NODE_ENV === "production") {
  import("firebase/compat/analytics")
    .then(() => {
      try {
        if (typeof firebase.analytics === "function") {
          firebase.analytics();
        }
      } catch (error) {
        // Analytics is optional and can be unavailable in some browsers.
      }
    })
    .catch(() => {
      // Ignore analytics load failures.
    });
}

export const db = firebase.firestore();
export const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);

export const authenticateStudent = timedCallable("authenticateStudent");
export const createStudentAccount = timedCallable("createStudentAccount");
export const resetStudentPassword = timedCallable("resetStudentPassword");
export const synthesizeWordAudio = timedCallable("synthesizeWordAudio");
export const applyWordFix = timedCallable("applyWordFix");
export const ensureInitialAdmin = timedCallable("ensureInitialAdmin");
export const adminListUsers = timedCallable("adminListUsers");
export const adminCreateUser = timedCallable("adminCreateUser");
export const adminUpdateUser = timedCallable("adminUpdateUser");
export const adminDeleteUser = timedCallable("adminDeleteUser");
export const adminSendResetEmail = timedCallable("adminSendResetEmail");
export const adminListAuditLogs = timedCallable("adminListAuditLogs", {
  dedupeInFlight: true,
});
export const resolveMyRoleContext = timedCallable("resolveMyRoleContext", {
  dedupeInFlight: true,
});
export const requestSchoolAdminAccess = timedCallable(
  "requestSchoolAdminAccess",
);
export const adminListSchoolAdminRequests = timedCallable(
  "adminListSchoolAdminRequests",
  {
    dedupeInFlight: true,
  },
);
export const adminReviewSchoolAdminRequest = timedCallable(
  "adminReviewSchoolAdminRequest",
);

// ─── v2 Org Management callables ─────────────────────────────────────────────
export const mgmtListData = timedCallable("mgmtListData", {
  dedupeInFlight: true,
});
export const mgmtCreateSchool = timedCallable("mgmtCreateSchool");
export const mgmtUpdateSchool = timedCallable("mgmtUpdateSchool");
export const mgmtArchiveSchool = timedCallable("mgmtArchiveSchool");
export const mgmtCreateClass = timedCallable("mgmtCreateClass");
export const mgmtUpdateClass = timedCallable("mgmtUpdateClass");
export const mgmtArchiveClass = timedCallable("mgmtArchiveClass");
export const mgmtAssignStudentClasses = timedCallable(
  "mgmtAssignStudentClasses",
);
export const mgmtBootstrapParentHomeScope = timedCallable(
  "mgmtBootstrapParentHomeScope",
);
export const mgmtParentCreateStudent = timedCallable("mgmtParentCreateStudent");
export const mgmtAssignSchoolAdmin = timedCallable("mgmtAssignSchoolAdmin");
export const mgmtAssignEducatorToSchool = timedCallable(
  "mgmtAssignEducatorToSchool",
);
export const mgmtDebugUser = timedCallable("mgmtDebugUser", {
  dedupeInFlight: true,
});

export default firebase;
