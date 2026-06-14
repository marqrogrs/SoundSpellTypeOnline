import React, { useState, useContext, useEffect, useMemo } from "react";
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
import { getPlacementAssignmentStatus } from "../firebase";
import { UserContext } from "../providers/UserProvider";
import { getCustomLesson } from "../util/customLessonHelpers";

export default function AppBar({ user }) {
  const classes = useStyles();
  const auth = useAuth();
  const { pathname } = useLocation();
  const history = useHistory();
  const [leftAnchorEl, setLeftAnchorEl] = useState(null);
  const [rightAnchorEl, setRightAnchorEl] = useState(null);

  const rightMenuOpen = Boolean(rightAnchorEl);
  const leftMenuOpen = Boolean(leftAnchorEl);
  const [studentHasPlacementAssignment, setStudentHasPlacementAssignment] =
    useState(false);

  const { wordsMasteredTotal, userData } = useContext(UserContext);
  const isManagerRole =
    auth.isAdmin ||
    auth.isSchoolAdmin ||
    auth.isEducator ||
    auth.isParent ||
    auth.isTutor;
  const showInternalPlacementTest =
    isManagerRole || studentHasPlacementAssignment;
  const hasFirstLessonAttempted = Boolean(
    userData?.firstLessonAttemptedAt || userData?.first_lesson_attempted_at,
  );
  const pathSegments = useMemo(() => pathname.split("/"), [pathname]);
  const customLessonId = useMemo(() => {
    if (
      pathSegments[1] === "lessons" &&
      pathSegments[2] === "custom" &&
      pathSegments[3]
    ) {
      return pathSegments[3];
    }
    if (
      pathSegments[1] === "lesson" &&
      pathSegments[2] === "custom" &&
      pathSegments[3]
    ) {
      return pathSegments[3];
    }
    return "";
  }, [pathSegments]);
  const [customLessonName, setCustomLessonName] = useState("");

  useEffect(() => {
    let isActive = true;

    if (!customLessonId) {
      setCustomLessonName("");
      return () => {
        isActive = false;
      };
    }

    getCustomLesson(customLessonId)
      .then((lesson) => {
        if (!isActive) return;
        setCustomLessonName(String(lesson?.name || ""));
      })
      .catch(() => {
        if (!isActive) return;
        setCustomLessonName("");
      });

    return () => {
      isActive = false;
    };
  }, [customLessonId]);

  useEffect(() => {
    let isMounted = true;

    if (!auth.user) {
      setStudentHasPlacementAssignment(false);
      return () => {
        isMounted = false;
      };
    }

    if (isManagerRole) {
      setStudentHasPlacementAssignment(false);
      return () => {
        isMounted = false;
      };
    }

    const checkAssignment = async () => {
      try {
        const result = await getPlacementAssignmentStatus({});
        if (!isMounted) return;
        const data = result?.data || {};
        setStudentHasPlacementAssignment(Boolean(data.assigned));
      } catch (_error) {
        if (!isMounted) return;
        setStudentHasPlacementAssignment(false);
      }
    };

    checkAssignment();

    return () => {
      isMounted = false;
    };
  }, [auth.user, isManagerRole]);

  const formatBreadcrumbLabel = (segment, index) => {
    if (
      customLessonName &&
      pathSegments[1] === "lessons" &&
      pathSegments[2] === "custom" &&
      index === 3
    ) {
      return customLessonName;
    }

    if (
      customLessonName &&
      pathSegments[1] === "lesson" &&
      pathSegments[2] === "custom" &&
      index === 3
    ) {
      return customLessonName;
    }

    if (typeof segment !== "string") return segment;

    return segment
      .split("-")
      .map((part) =>
        part ? part.charAt(0).toUpperCase() + part.slice(1) : part,
      )
      .join(" ");
  };

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

  const handleMenuMouseLeave = (menu) => {
    handleClose(menu);
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

  const handleViewCustomLessons = () => {
    history.push("/custom-lessons");
  };

  const handleViewManagement = () => {
    history.push("/management");
  };

  const handleViewPlacementReports = () => {
    history.push("/placement-reports");
    setRightAnchorEl(null);
  };

  const handleViewStudentProgress = () => {
    history.push("/student-progress");
    setRightAnchorEl(null);
  };

  const handleViewAbout = () => {
    history.push("/about");
    setLeftAnchorEl(null);
  };

  const handleViewScopeSequence = () => {
    history.push("/scope-sequence");
    setLeftAnchorEl(null);
  };

  const handleViewTouchTyping = () => {
    history.push("/touch-typing");
    setLeftAnchorEl(null);
  };

  const handleViewSoundSpelling = () => {
    history.push("/sound-spelling");
    setLeftAnchorEl(null);
  };

  const handleViewAccountSetUp = () => {
    history.push("/account-set-up");
    setLeftAnchorEl(null);
  };

  const handleViewContactUs = () => {
    window.location.assign("mailto:mark@birdhaven.us");
    setLeftAnchorEl(null);
  };

  const handleViewPlacementTest = () => {
    history.push("/placement-test");
    setLeftAnchorEl(null);
    setRightAnchorEl(null);
  };

  const handleViewHome = () => {
    history.push("/");
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
            PaperProps={{
              onMouseLeave: () => handleMenuMouseLeave("left"),
            }}
            MenuListProps={{
              onMouseLeave: () => handleMenuMouseLeave("left"),
            }}
          >
            {!user && <MenuItem onClick={handleViewHome}>Home</MenuItem>}
            {!user && (
              <MenuItem onClick={handleViewPlacementTest}>
                Placement Test
              </MenuItem>
            )}
            <MenuItem onClick={handleViewAbout}>About</MenuItem>
            <MenuItem onClick={handleViewScopeSequence}>
              Scope & Sequence
            </MenuItem>
            <MenuItem onClick={handleViewTouchTyping}>Touch Typing</MenuItem>
            <MenuItem onClick={handleViewSoundSpelling}>
              Sound Spelling
            </MenuItem>
            <MenuItem onClick={handleViewAccountSetUp}>Account Set Up</MenuItem>
            {/* <MenuItem onClick={() => window.open(PAYPAL_URL, '_blank')}>
              Donate
            </MenuItem> */}
            <MenuItem onClick={handleViewContactUs}>Contact Us</MenuItem>
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
                PaperProps={{
                  onMouseLeave: () => handleMenuMouseLeave("right"),
                }}
                MenuListProps={{
                  onMouseLeave: () => handleMenuMouseLeave("right"),
                }}
              >
                {showInternalPlacementTest && (
                  <MenuItem onClick={handleViewPlacementTest}>
                    Placement Test
                  </MenuItem>
                )}
                <MenuItem onClick={handleViewLessons}>My Progress</MenuItem>
                {(auth.isAdmin ||
                  auth.isSchoolAdmin ||
                  auth.isEducator ||
                  auth.isParent ||
                  auth.isTutor) && (
                  <MenuItem onClick={handleViewStudentProgress}>
                    Student Progress
                  </MenuItem>
                )}
                <MenuItem onClick={handleViewCustomLessons}>
                  Custom Lessons
                </MenuItem>
                {(auth.isAdmin ||
                  auth.isSchoolAdmin ||
                  auth.isEducator ||
                  auth.isParent ||
                  auth.isTutor) && (
                  <MenuItem onClick={handleViewManagement}>Management</MenuItem>
                )}
                {auth.isAdmin && (
                  <MenuItem onClick={handleViewPlacementReports}>
                    Placement Reports
                  </MenuItem>
                )}
                <MenuItem onClick={handleSignOut}>Sign Out</MenuItem>
                {/* <MenuItem onClick={() => history.push('/contact-us')}>
                  Contact Us
                </MenuItem> */}
              </Menu>
              {Number(wordsMasteredTotal || 0) > 0 && (
                <Typography>Words Mastered: {wordsMasteredTotal}</Typography>
              )}
            </>
          )}
        </Toolbar>
      </MaterialAppBar>
      {user && (
        <Box className={classes.breadcrumbBar}>
          <Breadcrumbs aria-label="breadcrumb" className={classes.breadcrumbs}>
            {pathSegments.map((path, index) => {
              const last = pathSegments.length - 1;
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
              if (index === last) {
                return (
                  <Typography
                    color="textPrimary"
                    aria-current="page"
                    key={`${path}-${index}`}
                  >
                    {formatBreadcrumbLabel(path, index)}
                  </Typography>
                );
              }
              return (
                <Link
                  color="inherit"
                  onClick={() =>
                    history.push(pathSegments.slice(0, index + 1).join("/"))
                  }
                  key={`${path}-${index}`}
                  style={{ cursor: "pointer" }}
                >
                  {formatBreadcrumbLabel(path, index)}
                </Link>
              );
            })}
          </Breadcrumbs>
        </Box>
      )}
    </div>
  );
}
