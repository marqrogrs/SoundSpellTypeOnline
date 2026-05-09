// Use compat API so existing namespaced calls continue to work on newer SDKs.
import firebase from "firebase/compat/app";

// Add the Firebase products that you want to use
import "firebase/compat/auth";
import "firebase/compat/firestore"; //database
import "firebase/compat/functions";

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

export const authenticateStudent = firebase
  .functions()
  .httpsCallable("authenticateStudent");
export const createStudentAccount = firebase
  .functions()
  .httpsCallable("createStudentAccount");
export const resetStudentPassword = firebase
  .functions()
  .httpsCallable("resetStudentPassword");
export const synthesizeWordAudio = firebase
  .functions()
  .httpsCallable("synthesizeWordAudio");
export const applyWordFix = firebase.functions().httpsCallable("applyWordFix");
export const ensureInitialAdmin = firebase
  .functions()
  .httpsCallable("ensureInitialAdmin");
export const adminListUsers = firebase
  .functions()
  .httpsCallable("adminListUsers");
export const adminCreateUser = firebase
  .functions()
  .httpsCallable("adminCreateUser");
export const adminUpdateUser = firebase
  .functions()
  .httpsCallable("adminUpdateUser");
export const adminDeleteUser = firebase
  .functions()
  .httpsCallable("adminDeleteUser");
export const adminSendResetEmail = firebase
  .functions()
  .httpsCallable("adminSendResetEmail");
export const adminListAuditLogs = firebase
  .functions()
  .httpsCallable("adminListAuditLogs");

// ─── v2 Org Management callables ─────────────────────────────────────────────
export const mgmtListData = firebase.functions().httpsCallable("mgmtListData");
export const mgmtCreateSchool = firebase
  .functions()
  .httpsCallable("mgmtCreateSchool");
export const mgmtUpdateSchool = firebase
  .functions()
  .httpsCallable("mgmtUpdateSchool");
export const mgmtArchiveSchool = firebase
  .functions()
  .httpsCallable("mgmtArchiveSchool");
export const mgmtCreateClass = firebase
  .functions()
  .httpsCallable("mgmtCreateClass");
export const mgmtUpdateClass = firebase
  .functions()
  .httpsCallable("mgmtUpdateClass");
export const mgmtArchiveClass = firebase
  .functions()
  .httpsCallable("mgmtArchiveClass");
export const mgmtAssignStudentClasses = firebase
  .functions()
  .httpsCallable("mgmtAssignStudentClasses");
export const mgmtBootstrapParentHomeScope = firebase
  .functions()
  .httpsCallable("mgmtBootstrapParentHomeScope");
export const mgmtParentCreateStudent = firebase
  .functions()
  .httpsCallable("mgmtParentCreateStudent");
export const mgmtAssignSchoolAdmin = firebase
  .functions()
  .httpsCallable("mgmtAssignSchoolAdmin");
export const mgmtAssignEducatorToSchool = firebase
  .functions()
  .httpsCallable("mgmtAssignEducatorToSchool");
export const mgmtDebugUser = firebase
  .functions()
  .httpsCallable("mgmtDebugUser");

export default firebase;
