import React from "react";
import { useHistory } from "react-router-dom";

//Material UI
import { Typography } from "@material-ui/core";
// var Landing = require('../img/Landing.png')

const Landing = () => {
  const history = useHistory();

  return (
    <div id="landing-container" className="landing-only">
      <div className="right-panel">
        <div className="welcome-text">
          <Typography className="upper-text">WELCOME TO</Typography>
          <Typography className="lower-text">
            Sound Spell Type Online
          </Typography>
        </div>

        <div className="user-type kid" onClick={() => history.push("/student")}>
          <Typography className="upper-text">I AM A</Typography>
          <Typography className="lower-text">Kid</Typography>
        </div>
        <div
          className="user-type adult"
          onClick={() => history.push("/educator")}
        >
          <Typography className="upper-text">I AM AN</Typography>
          <Typography className="lower-text" style={{ fontFamily: "Roboto" }}>
            Adult
          </Typography>
        </div>
      </div>
    </div>
  );
};

export default Landing;
