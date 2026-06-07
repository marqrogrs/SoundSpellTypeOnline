import * as React from "react";
import { useHistory } from "react-router-dom";
import {
  triggerErrorAlert,
  triggerEmailVerificationAlert,
  triggerEmailVerificationAlert2,
  triggerResetPasswordAlert,
} from "../util/alerts";
import {
  clearCurrentPerfSession,
  setPerfMetric,
  startPerfSession,
} from "../util/perfSession";
import {
  auth,
  authenticateStudent,
  db,
  ensureInitialAdmin,
  resolveMyRoleContext,
  requestSchoolAdminAccess,
} from "../firebase";

const AuthContext = React.createContext();
const ROLE_CONTEXT_CACHE_TTL_MS = 120000;
const roleContextCache = new Map();
const ROLE_CONTEXT_SESSION_CACHE_KEY = "auth:role-context";
const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const cloneRoleContextValue = (
  value,
  { cached = false, source = "memory" } = {},
) => ({
  role: value?.role || "student",
  claims: { ...(value?.claims || {}) },
  userDoc: value?.userDoc ? { ...value.userDoc } : null,
  perf: value?.perf
    ? {
        ...value.perf,
        resolveRoleContextMs: cached ? 0 : value.perf.resolveRoleContextMs,
        tokenClaimsFetchMs: cached ? 0 : value.perf.tokenClaimsFetchMs,
        userDocFetchMs: cached ? 0 : value.perf.userDocFetchMs,
        cached,
        source,
      }
    : {
        resolveRoleContextMs: 0,
        tokenClaimsFetchMs: 0,
        userDocFetchMs: 0,
        cached,
        source,
      },
});

const readSessionRoleContextCache = (uid) => {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return null;
    }

    const normalizedUid = String(uid || "").trim();
    if (!normalizedUid) {
      return null;
    }

    const raw = window.sessionStorage.getItem(
      `${ROLE_CONTEXT_SESSION_CACHE_KEY}:${normalizedUid}`,
    );
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || Number(parsed.expiresAt || 0) <= Date.now()) {
      window.sessionStorage.removeItem(
        `${ROLE_CONTEXT_SESSION_CACHE_KEY}:${normalizedUid}`,
      );
      return null;
    }

    return cloneRoleContextValue(parsed.value, {
      cached: true,
      source: "session",
    });
  } catch (_error) {
    return null;
  }
};

const writeSessionRoleContextCache = (uid, value, expiresAt) => {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return;
    }

    const normalizedUid = String(uid || "").trim();
    if (!normalizedUid) {
      return;
    }

    window.sessionStorage.setItem(
      `${ROLE_CONTEXT_SESSION_CACHE_KEY}:${normalizedUid}`,
      JSON.stringify({
        expiresAt,
        value: {
          role: value?.role || "student",
          claims: { ...(value?.claims || {}) },
          userDoc: value?.userDoc ? { ...value.userDoc } : null,
          perf: value?.perf ? { ...value.perf } : null,
        },
      }),
    );
  } catch (_error) {
    // Best-effort cache only.
  }
};

const normalizeRole = (value, fallback = "student") => {
  const raw = String(value || "").trim();
  const v = raw.toLowerCase().replace(/\s+/g, "");
  if (!raw) return fallback;
  if (v === "admin") return "admin";
  if (v === "schooladmin" || v === "school_admin") return "schoolAdmin";
  if (v === "teacher" || v === "educator") return "educator";
  if (
    v === "parent" ||
    v === "homeschoolparent" ||
    v === "home_school_parent" ||
    v === "homeschool_parent"
  )
    return "parent";
  if (
    v === "tutor" ||
    v === "readingspecialist" ||
    v === "reading_specialist" ||
    v === "tutor/readingspecialist"
  )
    return "tutor";
  if (v === "student") return "student";
  if (raw === "schoolAdmin") return "schoolAdmin";
  return fallback;
};

const resolveClaimsRole = (user, claims = {}) => {
  if (claims?.admin) return "admin";
  if (claims?.schoolAdmin) return "schoolAdmin";
  if (claims?.parent) return "parent";
  if (claims?.tutor) return "tutor";
  if (claims?.role) return normalizeRole(claims.role, "student");
  return "student";
};

const pickEffectiveRole = (claimsRole, docRole) => {
  if (claimsRole === "admin" || claimsRole === "schoolAdmin") {
    return claimsRole;
  }
  if (
    docRole === "admin" ||
    docRole === "schoolAdmin" ||
    docRole === "student" ||
    docRole === "parent" ||
    docRole === "tutor" ||
    docRole === "educator"
  ) {
    return docRole;
  }
  return claimsRole || docRole || "student";
};

const getPostLoginPath = async ({ user, role, userDoc }) => {
  if (!user) return "/";
  if (role === "student") return "/progress";

  const uid = String(user?.uid || "").trim();
  const normalizedEmail = String(user?.email || "")
    .trim()
    .toLowerCase();
  const userDocUsername = String(userDoc?.username || "").trim();
  const ownerIdentifiers = [...new Set([uid, userDocUsername, normalizedEmail])]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 10);
  if (!uid) {
    return "/management";
  }

  const hasManagedStudents = async () => {
    if (role === "admin") {
      const snap = await db
        .collection("users")
        .where("role", "==", "student")
        .limit(1)
        .get();
      return !snap.empty;
    }

    if (role === "schoolAdmin") {
      let schoolId = String(
        userDoc?.schoolId || userDoc?.school || userDoc?.homeSchoolId || "",
      ).trim();
      if (!schoolId) {
        const assignmentSnap = await db
          .collection("schoolAdminAssignments")
          .doc(uid)
          .get();
        if (assignmentSnap.exists) {
          const assignment = assignmentSnap.data() || {};
          schoolId = String(
            assignment.schoolId || assignment.school || "",
          ).trim();
        }
      }
      if (!schoolId) return false;
      const snap = await db
        .collection("users")
        .where("schoolId", "==", schoolId)
        .limit(25)
        .get();
      return snap.docs.some(
        (doc) => normalizeRole(doc.data()?.role) === "student",
      );
    }

    if (role === "educator") {
      if (!ownerIdentifiers.length) return false;
      const hasStudentsByClassAssignment = async () => {
        const classQuery =
          ownerIdentifiers.length === 1
            ? db
                .collection("classes")
                .where("educatorId", "==", ownerIdentifiers[0])
                .limit(25)
                .get()
            : db
                .collection("classes")
                .where("educatorId", "in", ownerIdentifiers)
                .limit(25)
                .get();
        const classSnap = await classQuery;
        return classSnap.docs.some(
          (doc) =>
            Array.isArray(doc.data()?.studentIds) &&
            doc.data().studentIds.length > 0,
        );
      };

      if (ownerIdentifiers.length === 1) {
        const snap = await db
          .collection("users")
          .where("educator", "==", ownerIdentifiers[0])
          .limit(1)
          .get();
        if (!snap.empty) return true;
        return hasStudentsByClassAssignment();
      }
      const [legacyEducatorSnap, hasClassStudents] = await Promise.all([
        db
          .collection("users")
          .where("educator", "in", ownerIdentifiers)
          .limit(1)
          .get(),
        hasStudentsByClassAssignment(),
      ]);
      return !legacyEducatorSnap.empty || hasClassStudents;
    }

    if (role === "parent" || role === "tutor") {
      if (!ownerIdentifiers.length) return false;
      const queryByOwnerField = (field) => {
        if (ownerIdentifiers.length === 1) {
          return db
            .collection("users")
            .where(field, "==", ownerIdentifiers[0])
            .limit(1)
            .get();
        }
        return db
          .collection("users")
          .where(field, "in", ownerIdentifiers)
          .limit(1)
          .get();
      };
      const [ownerSnap, legacyParentSnap] = await Promise.all([
        queryByOwnerField("ownerId"),
        queryByOwnerField("parentOwnerId"),
      ]);
      return !ownerSnap.empty || !legacyParentSnap.empty;
    }

    return false;
  };

  try {
    const hasStudents = await hasManagedStudents();
    if (hasStudents) {
      return "/student-progress";
    }
    const firstSignIn =
      user?.metadata?.creationTime === user?.metadata?.lastSignInTime;
    if (firstSignIn) {
      return "/management";
    }
    return "/management";
  } catch (_err) {
    return "/management";
  }
};

const resolveUserRoleContext = async (user) => {
  if (!user) {
    return {
      role: "student",
      claims: {},
      userDoc: null,
      perf: {
        resolveRoleContextMs: 0,
        tokenClaimsFetchMs: 0,
        userDocFetchMs: 0,
      },
    };
  }

  const cacheKey = String(user.uid || "").trim();
  if (cacheKey) {
    const cached = roleContextCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cloneRoleContextValue(cached.value, {
        cached: true,
        source: "memory",
      });
    }

    const sessionCached = readSessionRoleContextCache(cacheKey);
    if (sessionCached) {
      roleContextCache.set(cacheKey, {
        expiresAt: Date.now() + ROLE_CONTEXT_CACHE_TTL_MS,
        value: {
          role: sessionCached.role,
          claims: { ...(sessionCached.claims || {}) },
          userDoc: sessionCached.userDoc ? { ...sessionCached.userDoc } : null,
          perf: sessionCached.perf ? { ...sessionCached.perf } : null,
        },
      });
      return sessionCached;
    }
  }

  const resolveStartedAt = nowMs();
  let claims = {};
  let tokenClaimsFetchMs = 0;
  try {
    const tokenStartedAt = nowMs();
    const tokenResult = await user.getIdTokenResult();
    tokenClaimsFetchMs = nowMs() - tokenStartedAt;
    claims = tokenResult?.claims || {};
  } catch (_err) {
    tokenClaimsFetchMs = 0;
    claims = {};
  }

  let userDoc = null;
  let userDocFetchMs = 0;
  try {
    const userDocStartedAt = nowMs();
    let userDocSnap = await db.collection("users").doc(user.uid).get();
    if (!userDocSnap.exists) {
      const normalizedEmail = String(user?.email || "")
        .trim()
        .toLowerCase();

      if (normalizedEmail) {
        const [emailDocSnap, emailQuerySnap] = await Promise.all([
          db.collection("users").doc(normalizedEmail).get(),
          db
            .collection("users")
            .where("email", "==", normalizedEmail)
            .limit(1)
            .get(),
        ]);

        if (emailDocSnap.exists) {
          userDocSnap = emailDocSnap;
        } else if (!emailQuerySnap.empty) {
          userDocSnap = emailQuerySnap.docs[0];
        }
      }
    }
    userDocFetchMs = nowMs() - userDocStartedAt;
    userDoc = userDocSnap.exists ? userDocSnap.data() || {} : null;
  } catch (_err) {
    userDocFetchMs = 0;
    userDoc = null;
  }

  const claimsRole = resolveClaimsRole(user, claims);
  const docRole = normalizeRole(userDoc?.role || "", "student");
  const resolveRoleContextMs = nowMs() - resolveStartedAt;
  const resolvedContext = {
    role: pickEffectiveRole(claimsRole, userDoc?.role ? docRole : null),
    claims,
    userDoc,
    perf: {
      resolveRoleContextMs: Math.round(resolveRoleContextMs),
      tokenClaimsFetchMs: Math.round(tokenClaimsFetchMs),
      userDocFetchMs: Math.round(userDocFetchMs),
      cached: false,
    },
  };

  // If client-side Firestore cannot read legacy user docs (for example docs
  // keyed by email), ask the server to resolve caller role/doc via Admin SDK.
  if (resolvedContext.role === "student" && String(user?.email || "").trim()) {
    try {
      const serverStartedAt = nowMs();
      const serverResult = await resolveMyRoleContext({});
      const serverData = serverResult?.data || {};
      const serverUserDoc =
        serverData && typeof serverData.userDoc === "object"
          ? serverData.userDoc
          : null;
      const serverRole = normalizeRole(serverData?.role || "", "student");
      const serverDocRole = normalizeRole(serverUserDoc?.role || "", "student");
      const effectiveServerRole = pickEffectiveRole(
        serverRole,
        serverUserDoc?.role ? serverDocRole : null,
      );

      if (effectiveServerRole !== "student") {
        resolvedContext.role = effectiveServerRole;
      }
      if (!resolvedContext.userDoc && serverUserDoc) {
        resolvedContext.userDoc = serverUserDoc;
      }
      resolvedContext.perf.serverRoleContextFetchMs = Math.round(
        nowMs() - serverStartedAt,
      );
    } catch (_err) {
      // Keep client-resolved context as best-effort fallback.
    }
  }

  if (cacheKey) {
    const expiresAt = Date.now() + ROLE_CONTEXT_CACHE_TTL_MS;
    roleContextCache.set(cacheKey, {
      expiresAt,
      value: {
        role: resolvedContext.role,
        claims: { ...resolvedContext.claims },
        userDoc: resolvedContext.userDoc
          ? { ...resolvedContext.userDoc }
          : null,
        perf: { ...resolvedContext.perf },
      },
    });
    writeSessionRoleContextCache(cacheKey, resolvedContext, expiresAt);
  }

  console.info("[perf] firebase-auth-context", {
    tokenClaimsFetchMs: Math.round(tokenClaimsFetchMs),
    userDocFetchMs: Math.round(userDocFetchMs),
    resolveRoleContextMs: Math.round(resolveRoleContextMs),
    cached: false,
    uid: String(user?.uid || ""),
  });

  return resolvedContext;
};

const Auth = ({ children }) => {
  // If no user is already signed in we can mark auth as loaded immediately
  // (the onAuthStateChanged null callback is redundant in that case) so the
  // login page renders without a "Loading" flash.
  const [authLoaded, setIsLoaded] = React.useState(auth.currentUser === null);
  const [user, setUser] = React.useState(auth.currentUser);
  const [isEducator, setIsEducator] = React.useState(false);
  const [isParent, setIsParent] = React.useState(false);
  const [isTutor, setIsTutor] = React.useState(false);
  const [role, setRole] = React.useState("student");
  const [isSchoolAdmin, setIsSchoolAdmin] = React.useState(false);
  const [isAdmin, setIsAdmin] = React.useState(false);

  const history = useHistory();

  const signOut = React.useCallback(async () => {
    return auth
      .signOut()
      .then(() => {
        history.push("/");
      })
      .catch((error) => {
        console.error("signOut error:", error);
      });
  }, [history]);

  React.useEffect(() => {
    const observerStartedAt = nowMs();
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      const callbackStartedAt = nowMs();
      let resolvedRole = "student";
      let roleContextPerf = null;

      if (user) {
        const normalizedEmail = String(user.email || "")
          .trim()
          .toLowerCase();
        const isBootstrapAdminEmail = normalizedEmail === "mark@birdhaven.us";

        const roleContext = await resolveUserRoleContext(user);
        roleContextPerf = roleContext?.perf || null;
        let tokenRole = roleContext.role;
        let tokenIsAdmin =
          tokenRole === "admin" || Boolean(roleContext.claims?.admin);
        let tokenIsSchoolAdmin =
          tokenRole === "schoolAdmin" ||
          Boolean(roleContext.claims?.schoolAdmin);

        setRole(tokenRole);
        resolvedRole = tokenRole;
        setIsAdmin(tokenIsAdmin || tokenRole === "admin");
        setIsSchoolAdmin(
          tokenIsSchoolAdmin ||
            tokenRole === "schoolAdmin" ||
            tokenRole === "admin",
        );

        setIsParent(tokenRole === "parent");
        setIsTutor(tokenRole === "tutor");

        // Keep legacy educator behavior while excluding parent/student roles.
        setIsEducator(
          tokenRole === "educator" ||
            tokenRole === "admin" ||
            tokenRole === "schoolAdmin",
        );

        // Safe bootstrap: mark@birdhaven.us becomes initial top-level admin.
        // Only call this when the admin claim is missing to avoid a slow
        // network roundtrip (and token refresh) on every sign-in.
        if (isBootstrapAdminEmail && !tokenIsAdmin) {
          try {
            const seedResult = await ensureInitialAdmin({});
            if (seedResult?.data?.role === "admin") {
              const refreshedToken = await user.getIdTokenResult(true);
              const refreshedClaims = refreshedToken?.claims || {};
              setRole(deriveRoleFromClaims(user, refreshedClaims));
              setIsAdmin(Boolean(refreshedClaims.admin));
              setIsSchoolAdmin(
                Boolean(refreshedClaims.schoolAdmin || refreshedClaims.admin),
              );
            }
          } catch (error) {
            // Ignore permission-denied once already seeded; log unexpected issues.
            if (String(error?.code || "") !== "permission-denied") {
              console.warn("ensureInitialAdmin failed", error);
            }
          }
        }

        //do things
        const firstSignIn =
          user.metadata.creationTime === user.metadata.lastSignInTime;
        if (user.email !== null && !user.emailVerified) {
          const sessionId = startPerfSession({
            uid: user.uid,
            role: resolvedRole,
            hasEmailUser: Boolean(user.email),
          });
          if (roleContextPerf) {
            setPerfMetric(
              "firebaseTokenClaimsFetchMs",
              roleContextPerf.tokenClaimsFetchMs,
              { sessionId },
            );
            setPerfMetric(
              "firebaseUserDocFetchMs",
              roleContextPerf.userDocFetchMs,
              {
                sessionId,
              },
            );
            setPerfMetric(
              "firebaseResolveRoleContextMs",
              roleContextPerf.resolveRoleContextMs,
              { sessionId },
            );
            setPerfMetric(
              "firebaseRoleContextCached",
              Boolean(roleContextPerf.cached),
              { sessionId },
            );
            setPerfMetric(
              "firebaseRoleContextSource",
              String(roleContextPerf.source || "network"),
              { sessionId },
            );
          }
          setPerfMetric(
            "authCallbackMs",
            Math.round(nowMs() - callbackStartedAt),
            {
              sessionId,
            },
          );
          setPerfMetric(
            "timeSinceAppOpenMs",
            Math.round(nowMs() - observerStartedAt),
            {
              sessionId,
            },
          );
          console.info("[perf] auth-blocked-unverified", {
            callbackMs: Math.round(nowMs() - callbackStartedAt),
            role: resolvedRole,
            email: user.email || "",
          });
          if (firstSignIn) {
            auth.currentUser
              .sendEmailVerification()
              .then(() => triggerEmailVerificationAlert(user.email))
              .then(signOut);
          } else {
            triggerEmailVerificationAlert2(user.email).then(signOut);
          }
          return;
        }
      } else {
        setRole("student");
        setIsAdmin(false);
        setIsSchoolAdmin(false);
        setIsEducator(false);
        setIsParent(false);
        setIsTutor(false);
        clearCurrentPerfSession();
        // do other things
      }
      setUser(user);
      setIsLoaded(true);
      const sessionId = user
        ? startPerfSession({
            uid: user.uid,
            role: resolvedRole,
            hasEmailUser: Boolean(user.email),
          })
        : null;
      if (sessionId) {
        if (roleContextPerf) {
          setPerfMetric(
            "firebaseTokenClaimsFetchMs",
            roleContextPerf.tokenClaimsFetchMs,
            { sessionId },
          );
          setPerfMetric(
            "firebaseUserDocFetchMs",
            roleContextPerf.userDocFetchMs,
            {
              sessionId,
            },
          );
          setPerfMetric(
            "firebaseResolveRoleContextMs",
            roleContextPerf.resolveRoleContextMs,
            { sessionId },
          );
          setPerfMetric(
            "firebaseRoleContextCached",
            Boolean(roleContextPerf.cached),
            { sessionId },
          );
          setPerfMetric(
            "firebaseRoleContextSource",
            String(roleContextPerf.source || "network"),
            { sessionId },
          );
        }
        setPerfMetric(
          "authCallbackMs",
          Math.round(nowMs() - callbackStartedAt),
          {
            sessionId,
          },
        );
        setPerfMetric(
          "timeSinceAppOpenMs",
          Math.round(nowMs() - observerStartedAt),
          {
            sessionId,
          },
        );
      }
      console.info("[perf] auth-ready", {
        callbackMs: Math.round(nowMs() - callbackStartedAt),
        timeSinceAppOpenMs: Math.round(nowMs() - observerStartedAt),
        role: resolvedRole,
        hasEmailUser: Boolean(user?.email),
      });
    });

    return unsubscribe;
  }, [signOut]);

  const createUserWithEmailAndPassword = (email, password, profile = {}) => {
    return auth
      .createUserWithEmailAndPassword(email, password)
      .then((userCred) => {
        const selectedRole = normalizeRole(
          profile?.role || "student",
          "student",
        );
        const isSchoolAdminRequest = selectedRole === "schoolAdmin";
        const persistedRole = isSchoolAdminRequest ? "educator" : selectedRole;
        const firstName = String(profile?.firstName || "").trim();
        const lastName = String(profile?.lastName || "").trim();
        const displayName = [firstName, lastName].filter(Boolean).join(" ");

        // Set Auth displayName so the backend can use it as a fallback even if
        // the Firestore write below fails or is delayed.
        const profileUpdate = displayName
          ? userCred.user.updateProfile({ displayName }).catch(() => {})
          : Promise.resolve();

        return profileUpdate.then(() =>
          db
            .collection("users")
            .doc(userCred.user.uid)
            .set(
              {
                email: String(userCred.user.email || "").toLowerCase(),
                firstName,
                lastName,
                role: persistedRole,
                ...(isSchoolAdminRequest
                  ? {
                      requestedRole: "schoolAdmin",
                      schoolAdminRequestStatus: "pending",
                    }
                  : {}),
                progress: {},
              },
              { merge: true },
            )
            .then(async () => {
              if (isSchoolAdminRequest) {
                try {
                  await requestSchoolAdminAccess({
                    schoolId: String(profile?.schoolId || "").trim(),
                    schoolName: String(profile?.schoolName || "").trim(),
                    reason: String(profile?.requestReason || "").trim(),
                  });
                } catch (requestError) {
                  console.warn(
                    "School admin request submission failed",
                    requestError,
                  );
                }
              }
              const path = await getPostLoginPath({
                user: userCred.user,
                role: persistedRole,
                userDoc: { role: persistedRole },
              });
              history.push(path);
            }),
        );
      })
      .catch((error) => {
        console.error("createUserWithEmailAndPassword error:", error);
        triggerErrorAlert(error.message || error);
      });
  };

  // Let registered users log in
  const signInWithEmailAndPassword = (email, password) => {
    const identifier = String(email || "").trim();
    const isEmailIdentifier = identifier.includes("@");

    if (!isEmailIdentifier) {
      return signInStudent(identifier, password).catch((error) => {
        console.error("signInStudent error:", error);
        triggerErrorAlert(error.message || error);
      });
    }

    return auth
      .signInWithEmailAndPassword(identifier, password)
      .then(async (credential) => {
        const signedInUser = credential?.user || auth.currentUser;
        const { role, userDoc } = await resolveUserRoleContext(signedInUser);
        const path = await getPostLoginPath({
          user: signedInUser,
          role,
          userDoc,
        });
        history.push(path);
      })
      .catch((error) => {
        console.error("signInWithEmailAndPassword error:", error);
        triggerErrorAlert(error.message || error);
      });
  };

  // Let registered users log in
  const signInStudent = (name, password) => {
    return authenticateStudent({ username: name, password }).then((result) => {
      const { token, error } = result.data;
      if (error) {
        throw new Error(error);
      } else {
        return auth.signInWithCustomToken(token).then((u_name) => {
          history.push("/progress");
        });
      }
    });
  };

  // Let logged in users log out
  const resetPassword = () => {
    triggerResetPasswordAlert();
  };

  const context = {
    user,
    isEducator,
    isParent,
    isTutor,
    role,
    isAdmin,
    isSchoolAdmin,
    authLoaded,
    resetPassword,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInStudent,
    signOut,
  };
  return (
    <AuthContext.Provider value={context}>{children}</AuthContext.Provider>
  );
};

function deriveRoleFromClaims(user, claims) {
  if (claims?.admin) return "admin";
  if (claims?.schoolAdmin) return "schoolAdmin";
  if (claims?.parent) return "parent";
  if (claims?.tutor) return "tutor";
  if (claims?.role) return normalizeRole(claims.role, "student");
  return "student";
}

export default Auth;

export const useAuth = () => {
  const auth = React.useContext(AuthContext);
  if (!auth) {
    throw new Error("You must call useAuth() inside of a <Auth />.");
  }
  return auth;
};
