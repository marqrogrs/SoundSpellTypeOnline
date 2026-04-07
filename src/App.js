import "./App.css";
import React from "react";
import Auth, { useAuth } from "./hooks/useAuth";
import CssBaseline from "@material-ui/core/CssBaseline";
import { BrowserRouter as Router } from "react-router-dom";

import PublicRoutes from "./routes/PublicRoutes";
import PrivateRoutes from "./routes/PrivateRoutes";

import { createMuiTheme, ThemeProvider } from "@material-ui/core/styles";
import { SnackbarProvider } from "notistack";

const theme = createMuiTheme({
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
  if (!auth) {
    return <div>Loading</div>;
  }

  return (
    <>
      {auth.user ? (
        <PrivateRoutes user={auth.user} isEducator={auth.isEducator} />
      ) : (
        <PublicRoutes user={auth.user} />
      )}
    </>
  );
}
