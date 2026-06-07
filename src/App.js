import "./App.css";
import React from "react";
import Auth, { useAuth } from "./hooks/useAuth";
import CssBaseline from "@material-ui/core/CssBaseline";
import { BrowserRouter as Router } from "react-router-dom";

import PublicRoutes from "./routes/PublicRoutes";
import PrivateRoutes from "./routes/PrivateRoutes";
import PerfDebugPanel from "./components/PerfDebugPanel";

import { createTheme, ThemeProvider } from "@material-ui/core/styles";
import { SnackbarProvider } from "notistack";

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
