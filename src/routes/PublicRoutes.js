import React from "react";
import { Switch, Route } from "react-router-dom";
import Landing from "../pages/Landing";
import Error from "../pages/Error";
import AppBar from "../components/AppBar";
import StudentLogin from "../pages/StudentLogin";
import EducatorLogin from "../pages/EducatorLogin";

export default function PublicRoutes({ user }) {
  return (
    <>
      <AppBar user={user} />
      <Switch>
        {/* <Route exact path='/contact-us'>
          <ContactUs />
        </Route> */}
        <Route exact path="/">
          <Landing />
        </Route>
        <Route exact path="/student">
          <StudentLogin />
        </Route>
        <Route exact path="/educator">
          <EducatorLogin />
        </Route>
        {/* <Route exact path='/lessons'>
          <Redirect to='/' />
        </Route>
        <Route path='/lessons/:lesson'>
          <Redirect to='/' />
        </Route>
        <Route exact path='/progress'>
          <Redirect to='/' />
        </Route>
        <Route exact path='/students'>
          <Redirect to='/' />
        </Route> */}
        <Route>
          <Error />
        </Route>
      </Switch>
    </>
  );
}
