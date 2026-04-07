import React, { useRef, useEffect } from "react";
import { default as ReactKeyboard } from "react-simple-keyboard";

import "react-simple-keyboard/build/css/index.css";
import { DEFAULT_BUTTONS_THEME } from "../util/constants";
import "../styles/keyboard.css";

export default function Keyboard({ onChange, interactive = true }) {
  const layout = {
    default: [
      "q w e r t y u i o p {bksp}",
      "a s d f g h j k l ; {enter}",
      "z x c v b n m , .   ",
      "{space}",
    ],
  };
  const display = {
    "{bksp}": "delete",
    "{enter}": "enter",
    "{space}": " ",
  };

  const keyboard = useRef();

  const normalizeButtonKey = (key) => {
    if (!key || typeof key !== "string") {
      return null;
    }
    switch (key) {
      case " ":
      case "space":
        return "{space}";
      case "Backspace":
        return "{bksp}";
      case "Enter":
        return "{enter}";
      default:
        return key.toLowerCase();
    }
  };

  const mapVirtualButtonToKey = (button) => {
    if (!button || typeof button !== "string") {
      return null;
    }

    switch (button) {
      case "{bksp}":
        return "backspace";
      case "{enter}":
        return "enter";
      case "{space}":
        return "space";
      default:
        return button;
    }
  };

  const handleVirtualKeyPress = (button) => {
    if (!interactive) {
      return;
    }
    const mappedKey = mapVirtualButtonToKey(button);
    if (!mappedKey) {
      return;
    }
    onChange(mappedKey);
  };

  useEffect(() => {
    //So the keyboard can be displayed in all caps
    var keys = document.getElementsByClassName("hg-button hg-standardBtn");
    Array.from(keys).forEach((key) => {
      const letter = key.attributes["data-skbtn"].nodeValue;
      key.innerHTML = `<span>${letter.toUpperCase()}</span>`;
    });
  }, []);

  useEffect(() => {
    const handlePress = (event) => {
      const button = normalizeButtonKey(event?.detail?.key);
      if (!button || !keyboard.current?.addButtonTheme) {
        return;
      }
      keyboard.current.addButtonTheme(button, "hg-activeButton");
    };

    const handleRelease = (event) => {
      const button = normalizeButtonKey(event?.detail?.key);
      if (!button || !keyboard.current?.removeButtonTheme) {
        return;
      }
      keyboard.current.removeButtonTheme(button, "hg-activeButton");
    };

    window.addEventListener("soundspeller-key-press", handlePress);
    window.addEventListener("soundspeller-key-release", handleRelease);

    return () => {
      window.removeEventListener("soundspeller-key-press", handlePress);
      window.removeEventListener("soundspeller-key-release", handleRelease);
    };
  }, []);
  return (
    <>
      <div style={interactive ? undefined : { pointerEvents: "none" }}>
        <ReactKeyboard
          keyboardRef={(r) => (keyboard.current = r)}
          layout={layout}
          display={display}
          physicalKeyboardHighlight={false}
          buttonTheme={DEFAULT_BUTTONS_THEME}
          onKeyPress={handleVirtualKeyPress}
        />
      </div>
    </>
  );
}
