import "./App.css";
import React from "react";
import Auth, { useAuth } from "./hooks/useAuth";
import CssBaseline from "@material-ui/core/CssBaseline";
import Button from "@material-ui/core/Button";
import { BrowserRouter as Router, useHistory } from "react-router-dom";

import PublicRoutes from "./routes/PublicRoutes";
import PrivateRoutes from "./routes/PrivateRoutes";
import PerfDebugPanel from "./components/PerfDebugPanel";
import { getPlacementAdminAlerts } from "./firebase";

import { createTheme, ThemeProvider } from "@material-ui/core/styles";
import { SnackbarProvider, useSnackbar } from "notistack";

const theme = createTheme({
  palette: {
    primary: {
      light: "#5472d3",
      main: "#0d47a1",
      dark: "#002171",
      contrastText: "#fff",
    },
    secondary: {
      light: "#fbfffc",
      main: "#c8e6c9",
      dark: "#97b498",
      contrastText: "#000",
    },
  },
});
const App = (props) => {
  return (
    <>
      <ThemeProvider theme={theme}>
        <SnackbarProvider maxSnack={3}>
          <CssBaseline />
          <Router>
            <Auth>
              <RequireAuthentication />
              <AdminPlacementAlertGate />
              <AdminPerfDebugPanelGate />
            </Auth>
          </Router>
        </SnackbarProvider>
      </ThemeProvider>
    </>
  );
};
export default App;

function RequireAuthentication() {
  const auth = useAuth();
  if (!auth || !auth.authLoaded) {
    return <div>Loading</div>;
  }

  return (
    <>
      {auth.user ? (
        <PrivateRoutes
          user={auth.user}
          isEducator={auth.isEducator}
          isAdmin={auth.isAdmin}
          isSchoolAdmin={auth.isSchoolAdmin}
          isParent={auth.isParent}
          isTutor={auth.isTutor}
        />
      ) : (
        <PublicRoutes user={auth.user} />
      )}
    </>
  );
}

function AdminPerfDebugPanelGate() {
  const auth = useAuth();
  const showPerfDebugPanel =
    process.env.NODE_ENV !== "production" && Boolean(auth?.isAdmin);

  if (!showPerfDebugPanel) {
    return null;
  }

  return <PerfDebugPanel />;
}

function AdminPlacementAlertGate() {
  const auth = useAuth();
  const history = useHistory();
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  React.useEffect(() => {
    let isMounted = true;
    if (!auth?.authLoaded || !auth?.user || !auth?.isAdmin) {
      return () => {
        isMounted = false;
      };
    }

    const sessionKey = `placement-admin-alert-shown:${String(
      auth.user.uid || "",
    )}`;
    try {
      if (window.sessionStorage.getItem(sessionKey) === "1") {
        return () => {
          isMounted = false;
        };
      }
    } catch (_error) {
      // Ignore sessionStorage failures.
    }

    const run = async () => {
      try {
        const result = await getPlacementAdminAlerts({});
        if (!isMounted) return;
        const data = result?.data || {};
        const newCount = Number(data?.newCount || 0);
        if (newCount <= 0) {
          return;
        }

        enqueueSnackbar(`There are ${newCount} new Placement Test reports.`, {
          variant: "info",
          persist: true,
          action: (key) => (
            <Button
              color="secondary"
              size="small"
              onClick={() => {
                closeSnackbar(key);
                history.push("/placement-reports");
              }}
            >
              View Reports
            </Button>
          ),
        });

        try {
          window.sessionStorage.setItem(sessionKey, "1");
        } catch (_error) {
          // Ignore sessionStorage failures.
        }
      } catch (_error) {
        // Silent fail; admin can still open reports manually.
      }
    };

    run();

    return () => {
      isMounted = false;
    };
  }, [
    auth?.authLoaded,
    auth?.isAdmin,
    auth?.user,
    closeSnackbar,
    enqueueSnackbar,
    history,
  ]);

  return null;
}
