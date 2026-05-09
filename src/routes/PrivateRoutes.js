import React, { Suspense } from "react";
import { Switch, Route, Redirect } from "react-router-dom";
import AppBar from "../components/AppBar";
import { LessonProvider } from "../providers/LessonProvider";
import UserProvider from "../providers/UserProvider";

const Home = React.lazy(() => import("../pages/Home"));
const Error = React.lazy(() => import("../pages/Error"));
const Lesson = React.lazy(() => import("../pages/Lesson"));
const Progress = React.lazy(() => import("../pages/Progress"));
const Students = React.lazy(() => import("../pages/Students"));
const CreateLesson = React.lazy(() => import("../pages/CreateLesson"));
const WordFixAdmin = React.lazy(() => import("../pages/WordFixAdmin"));
const CustomLessons = React.lazy(() => import("../pages/CustomLessons"));
const CreateCustomLesson = React.lazy(
  () => import("../pages/CreateCustomLesson"),
);
const About = React.lazy(() => import("../pages/About"));
const Management = React.lazy(() => import("../pages/Management"));
const StudentProgressDashboard = React.lazy(
  () => import("../pages/StudentProgressDashboard"),
);

export default function PrivateRoutes({
  user,
  isEducator,
  isAdmin,
  isSchoolAdmin,
  isParent,
}) {
  return (
    <UserProvider>
      <LessonProvider>
        <AppBar user={user} />
        <Suspense fallback={<div>Loading page...</div>}>
          <Switch>
            <Route exact path="/">
              <Home />
            </Route>
            <Route exact path="/lessons">
              <Redirect to="/progress" />
            </Route>
            <Route
              exact
              path="/lessons/custom/:lessonId"
              children={<Lesson />}
            />
            <Route exact path="/lessons/:lesson" children={<Lesson />} />
            <Route exact path="/progress">
              <Progress />
            </Route>
            {isEducator && (
              <Route exact path="/students">
                <Students />
              </Route>
            )}
            {isEducator && (
              <Route exact path="/students/:student" children={<Progress />} />
            )}
            <Route exact path="/create-lesson">
              <CreateLesson />
            </Route>
            {isAdmin && (
              <Route exact path="/admin/word-fix">
                <WordFixAdmin />
              </Route>
            )}
            {(isAdmin || isSchoolAdmin || isEducator || isParent) && (
              <Route exact path="/management">
                <Management />
              </Route>
            )}
            {(isAdmin || isSchoolAdmin || isEducator || isParent) && (
              <Route exact path="/student-progress">
                <StudentProgressDashboard />
              </Route>
            )}
            {isEducator && (
              <Route exact path="/class-management">
                <Redirect to="/students" />
              </Route>
            )}
            {isEducator && (
              <Route exact path="/educator-progress">
                <Redirect to="/custom-lessons" />
              </Route>
            )}
            <Route exact path="/custom-lessons">
              <CustomLessons />
            </Route>
            <Route exact path="/create-custom-lesson">
              <CreateCustomLesson />
            </Route>
            <Route exact path="/about">
              <About />
            </Route>
            <Route
              exact
              path="/lesson/custom/:lessonId"
              render={({ match }) => (
                <Redirect to={`/lessons/custom/${match.params.lessonId}`} />
              )}
            />
            {/* <Route exact path='/contact-us'>
              <ContactUs />
            </Route> */}
            <Route children={<Error />} />
          </Switch>
        </Suspense>
      </LessonProvider>
    </UserProvider>
  );
}
