import React from "react";
import { Switch, Route, Redirect } from "react-router-dom";
import Home from "../pages/Home";
import Error from "../pages/Error";
import Lesson from "../pages/Lesson";
import Progress from "../pages/Progress";
import Students from "../pages/Students";
import CreateLesson from "../pages/CreateLesson";
import WordFixAdmin from "../pages/WordFixAdmin";
import ClassManagement from "../pages/ClassManagement";
import EducatorProgressDashboard from "../pages/EducatorProgressDashboard";
import CustomLessons from "../pages/CustomLessons";
import CreateCustomLesson from "../pages/CreateCustomLesson";
import About from "../pages/About";
import Admin from "../pages/Admin";
import AppBar from "../components/AppBar";
import { LessonProvider } from "../providers/LessonProvider";
import UserProvider from "../providers/UserProvider";

export default function PrivateRoutes({
  user,
  isEducator,
  isAdmin,
  isSchoolAdmin,
}) {
  return (
    <UserProvider>
      <LessonProvider>
        <AppBar user={user} />
        <Switch>
          <Route exact path="/">
            <Home />
          </Route>
          <Route exact path="/lessons">
            <Redirect to="/progress" />
          </Route>
          <Route exact path="/lessons/custom/:lessonId" children={<Lesson />} />
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
          {(isAdmin || isSchoolAdmin) && (
            <Route exact path="/admin">
              <Admin />
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
      </LessonProvider>
    </UserProvider>
  );
}
