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
import { auth, authenticateStudent, db, ensureInitialAdmin } from "../firebase";

const AuthContext = React.createContext();
const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const Auth = ({ children }) => {
  const [authLoaded, setIsLoaded] = React.useState(false);
  const [user, setUser] = React.useState(auth.currentUser);
  const [isEducator, setIsEducator] = React.useState(false);
  const [isParent, setIsParent] = React.useState(false);
  const [role, setRole] = React.useState("student");
  const [isSchoolAdmin, setIsSchoolAdmin] = React.useState(false);
  const [isAdmin, setIsAdmin] = React.useState(false);

  const history = useHistory();

  const signOut = React.useCallback(async () => {
    return auth
      .signOut()
      .then(() => {
        console.log("Signed out");
        history.push("/");
      })
      .catch((error) => {
        console.log(error);
      });
  }, [history]);

  React.useEffect(() => {
    const observerStartedAt = nowMs();
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      const callbackStartedAt = nowMs();
      let resolvedRole = "student";

      if (user) {
        const normalizedEmail = String(user.email || "")
          .trim()
          .toLowerCase();
        const isBootstrapAdminEmail = normalizedEmail === "mark@birdhaven.us";

        let tokenRole = user.email ? "educator" : "student";
        let tokenIsAdmin = false;
        let tokenIsSchoolAdmin = false;

        try {
          const tokenResult = await user.getIdTokenResult();
          const claims = tokenResult?.claims || {};
          tokenIsAdmin = Boolean(claims.admin);
          tokenIsSchoolAdmin = Boolean(claims.schoolAdmin);
          tokenRole =
            claims.role ||
            (tokenIsAdmin
              ? "admin"
              : tokenIsSchoolAdmin
                ? "schoolAdmin"
                : user.email
                  ? "educator"
                  : "student");
        } catch (error) {
          console.error("Failed to read auth claims", error);
        }

        setRole(tokenRole);
        resolvedRole = tokenRole;
        setIsAdmin(tokenIsAdmin || tokenRole === "admin");
        setIsSchoolAdmin(
          tokenIsSchoolAdmin ||
            tokenRole === "schoolAdmin" ||
            tokenRole === "admin",
        );

        setIsParent(tokenRole === "parent");

        // Keep legacy educator behavior while allowing admin/schoolAdmin accounts.
        setIsEducator(
          user.email !== null ||
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

        // console.log('User signed in: ', user.metadata)
        //do things
        const firstSignIn =
          user.metadata.creationTime === user.metadata.lastSignInTime;
        if (user.email !== null && !user.emailVerified) {
          const sessionId = startPerfSession({
            uid: user.uid,
            role: resolvedRole,
            hasEmailUser: Boolean(user.email),
          });
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
            console.log("First sign in!");
            auth.currentUser
              .sendEmailVerification()
              .then(() => triggerEmailVerificationAlert(user.email))
              .then(signOut);
          } else {
            console.log("nope!");
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

  const createUserWithEmailAndPassword = (email, password) => {
    // TODO: Register a new user with the specified email and password
    // if (
    //   email.toLowerCase() === 'mark@birdhaven.us' ||
    //   email.toLowerCase() === 'aprilpolubiec@gmail.com'
    // ) {
    return auth
      .createUserWithEmailAndPassword(email, password)
      .then((userCred) =>
        db
          .collection("users")
          .doc(userCred.user.uid)
          .set({ email: userCred.user.email, progress: {} }),
      )
      .catch((error) => {
        console.log(error);
        triggerErrorAlert(error.message || error);
      });
    // }
  };

  // Let registered users log in
  const signInWithEmailAndPassword = (email, password) => {
    return auth
      .signInWithEmailAndPassword(email, password)
      .then(() => {
        console.log("Signed in");
        history.push("/student-progress");
      })
      .catch((error) => {
        console.log(error);
        triggerErrorAlert(error.message || error);
      });
  };

  // Let registered users log in
  const signInStudent = (name, password) => {
    return authenticateStudent({ username: name, password }).then((result) => {
      console.log(result);
      const { token, error } = result.data;
      if (error) {
        throw new Error(error);
      } else {
        return auth.signInWithCustomToken(token).then((u_name) => {
          history.push("/");
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
  if (claims?.role) return claims.role;
  return user?.email ? "educator" : "student";
}

export default Auth;

export const useAuth = () => {
  const auth = React.useContext(AuthContext);
  if (!auth) {
    throw new Error("You must call useAuth() inside of a <Auth />.");
  }
  return auth;
};
