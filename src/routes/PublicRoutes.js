import React, { Suspense } from "react";
import { Switch, Route, Redirect } from "react-router-dom";
import AppBar from "../components/AppBar";

const StudentLogin = React.lazy(() => import("../pages/StudentLogin"));
const EducatorLogin = React.lazy(() => import("../pages/EducatorLogin"));
const About = React.lazy(() => import("../pages/About"));
const ScopeSequence = React.lazy(() => import("../pages/ScopeSequence"));
const TouchTyping = React.lazy(() => import("../pages/TouchTyping"));
const SoundSpelling = React.lazy(() => import("../pages/SoundSpelling"));
const AccountSetUp = React.lazy(() => import("../pages/AccountSetUp"));
const ContactUs = React.lazy(() => import("../pages/ContactUs"));
const PlacementTest = React.lazy(() => import("../pages/PlacementTest"));

export default function PublicRoutes({ user }) {
  return (
    <>
      <AppBar user={user} />
      <Suspense fallback={<div>Loading page...</div>}>
        <Switch>
          <Route exact path="/">
            <EducatorLogin />
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
          <Route exact path="/scope-sequence">
            <ScopeSequence />
          </Route>
          <Route exact path="/touch-typing">
            <TouchTyping />
          </Route>
          <Route exact path="/sound-spelling">
            <SoundSpelling />
          </Route>
          <Route exact path="/account-set-up">
            <AccountSetUp />
          </Route>
          <Route exact path="/contact-us">
            <ContactUs />
          </Route>
          <Route exact path="/placement-test">
            <PlacementTest />
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
            <Redirect to="/" />
          </Route>
        </Switch>
      </Suspense>
    </>
  );
}
