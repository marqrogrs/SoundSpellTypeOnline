import React, { useState, useContext } from "react";
import { useLocation, useHistory } from "react-router-dom";

import { useStyles } from "../styles/material";

import { default as MaterialAppBar } from "@material-ui/core/AppBar";
import MenuIcon from "@material-ui/icons/Menu";
import {
  Box,
  Breadcrumbs,
  Link,
  Menu,
  MenuItem,
  Typography,
  Toolbar,
} from "@material-ui/core";
import IconButton from "@material-ui/core/IconButton";
import AccountCircle from "@material-ui/icons/AccountCircle";

import { useAuth } from "../hooks/useAuth";
import { UserContext } from "../providers/UserProvider";

export default function AppBar({ user }) {
  const classes = useStyles();
  const auth = useAuth();
  const { pathname } = useLocation();
  const history = useHistory();
  const [leftAnchorEl, setLeftAnchorEl] = useState(null);
  const [rightAnchorEl, setRightAnchorEl] = useState(null);

  const rightMenuOpen = Boolean(rightAnchorEl);
  const leftMenuOpen = Boolean(leftAnchorEl);

  const { wordsMasteredTotal } = useContext(UserContext);

  const handleLeftMenu = (e) => {
    setLeftAnchorEl(e.currentTarget);
  };

  const handleRightMenu = (e) => {
    setRightAnchorEl(e.currentTarget);
  };

  const handleClose = (menu) => {
    switch (menu) {
      case "left":
        setLeftAnchorEl(null);
        break;
      case "right":
        setRightAnchorEl(null);
        break;
      default:
        return;
    }
  };

  const handleSignOut = () => {
    auth.signOut();
  };

  const handleViewLessons = () => {
    history.push("/progress");
  };

  const handleViewStudents = () => {
    history.push("/students");
  };

  const handleViewWordFixAdmin = () => {
    history.push("/admin/word-fix");
  };

  const handleViewCustomLessons = () => {
    history.push("/custom-lessons");
  };

  const handleViewAdmin = () => {
    history.push("/admin");
  };

  const handleViewAbout = () => {
    history.push("/about");
    setLeftAnchorEl(null);
  };

  const handleRedirectToHome = () => {
    history.push("/");
  };

  return (
    <div>
      <MaterialAppBar position="static">
        <Toolbar>
          <IconButton
            edge="start"
            className={classes.menuButton}
            color="inherit"
            aria-label="menu"
            onClick={handleLeftMenu}
          >
            <MenuIcon />
          </IconButton>
          <Menu
            id="menu-appbar"
            anchorEl={leftAnchorEl}
            anchorOrigin={{
              vertical: "top",
              horizontal: "right",
            }}
            keepMounted
            transformOrigin={{
              vertical: "top",
              horizontal: "right",
            }}
            open={leftMenuOpen}
            onClose={() => handleClose("left")}
          >
            <MenuItem onClick={handleViewAbout}>About</MenuItem>
            {/* <MenuItem onClick={() => window.open(PAYPAL_URL, '_blank')}>
              Donate
            </MenuItem> */}
            <MenuItem
              onClick={() => window.location.assign("mailto:mark@birdhaven.us")}
            >
              Contact Us
            </MenuItem>
          </Menu>
          <Typography
            variant="h6"
            className={classes.menuTitle}
            onClick={handleRedirectToHome}
          >
            Sound Spell Type Online
          </Typography>
          {user && (
            <>
              <IconButton
                aria-label="account of current user"
                aria-controls="menu-appbar"
                aria-haspopup="true"
                onClick={handleRightMenu}
                color="inherit"
              >
                <AccountCircle />
              </IconButton>
              <Menu
                id="menu-appbar"
                anchorEl={rightAnchorEl}
                anchorOrigin={{
                  vertical: "top",
                  horizontal: "right",
                }}
                keepMounted
                transformOrigin={{
                  vertical: "top",
                  horizontal: "right",
                }}
                open={rightMenuOpen}
                onClose={() => handleClose("right")}
              >
                <MenuItem onClick={handleViewLessons}>My Progress</MenuItem>
                {auth.isEducator && (
                  <MenuItem onClick={handleViewStudents}>My Students</MenuItem>
                )}
                <MenuItem onClick={handleViewCustomLessons}>
                  Custom Lessons
                </MenuItem>
                {(auth.isAdmin || auth.isSchoolAdmin) && (
                  <MenuItem onClick={handleViewAdmin}>Admin</MenuItem>
                )}
                {auth.isAdmin && (
                  <MenuItem onClick={handleViewWordFixAdmin}>
                    Word Fix Admin
                  </MenuItem>
                )}
                <MenuItem onClick={handleSignOut}>Sign Out</MenuItem>
                {/* <MenuItem onClick={() => history.push('/contact-us')}>
                  Contact Us
                </MenuItem> */}
              </Menu>
              <Typography>Words Mastered: {wordsMasteredTotal}</Typography>
            </>
          )}
        </Toolbar>
      </MaterialAppBar>
      {user && (
        <Box className={classes.breadcrumbBar}>
          <Breadcrumbs aria-label="breadcrumb" className={classes.breadcrumbs}>
            {pathname.split("/").map((path, index) => {
              const last = pathname.split("/").length - 1;
              if (index === 0) {
                return (
                  <Link
                    color="inherit"
                    onClick={() => history.push("/")}
                    key={path}
                  >
                    Sound Spell Type Online
                  </Link>
                );
              }
              return (
                <Link
                  color={index === last ? "textPrimary" : "textSecondary"}
                  onClick={() =>
                    history.push(
                      pathname
                        .split("/")
                        .slice(0, index + 1)
                        .join("/"),
                    )
                  }
                  aria-current="page"
                  key={path}
                >
                  {typeof path === "string"
                    ? path.charAt(0).toUpperCase() + path.slice(1)
                    : path}
                </Link>
              );
            })}
          </Breadcrumbs>
        </Box>
      )}
    </div>
  );
}
