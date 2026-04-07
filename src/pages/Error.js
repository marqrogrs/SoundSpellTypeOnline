import React from "react";
import { Typography } from "@material-ui/core";
import { Link } from "@material-ui/core";
import { useHistory } from "react-router-dom";

var Snake = require("../img/Welcome.png");

export default function Error() {
  const history = useHistory();

  return (
    <div id="error-container">
      <img src={Snake} alt="Sound Spell Type Online welcome snake" />
      <div className="right-panel">
        <Typography className="upper-text">Oops!</Typography>
        <Typography className="lower-text">
          The page you are looking for does not exist.{" "}
          <Link onClick={() => history.push("/")}>Click here</Link> to go back
          home or <Link href="mailto:mark@birdhaven.us">contact us</Link> for
          help.
        </Typography>
      </div>
    </div>
  );
}
