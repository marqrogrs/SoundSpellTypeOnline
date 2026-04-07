import React from "react";
import { Switch, Route, Redirect } from "react-router-dom";
import Home from "../pages/Home";
import Error from "../pages/Error";
import Lesson from "../pages/Lesson";
import Progress from "../pages/Progress";
import Students from "../pages/Students";
import CreateLesson from "../pages/CreateLesson";
import WordFixAdmin from "../pages/WordFixAdmin";
import AppBar from "../components/AppBar";
import { LessonProvider } from "../providers/LessonProvider";
import UserProvider from "../providers/UserProvider";

export default function PrivateRoutes({ user, isEducator }) {
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
          {isEducator && (
            <Route exact path="/admin/word-fix">
              <WordFixAdmin />
            </Route>
          )}
          {/* <Route exact path='/contact-us'>
            <ContactUs />
          </Route> */}
          <Route children={<Error />} />
        </Switch>
      </LessonProvider>
    </UserProvider>
  );
}
