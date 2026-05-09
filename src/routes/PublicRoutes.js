import React, { Suspense } from "react";
import { Switch, Route, Redirect } from "react-router-dom";
import AppBar from "../components/AppBar";

const Landing = React.lazy(() => import("../pages/Landing"));
const StudentLogin = React.lazy(() => import("../pages/StudentLogin"));
const EducatorLogin = React.lazy(() => import("../pages/EducatorLogin"));
const About = React.lazy(() => import("../pages/About"));

export default function PublicRoutes({ user }) {
  return (
    <>
      <AppBar user={user} />
      <Suspense fallback={<div>Loading page...</div>}>
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
          <Route exact path="/about">
            <About />
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
            <Redirect to="/educator" />
          </Route>
        </Switch>
      </Suspense>
    </>
  );
}
