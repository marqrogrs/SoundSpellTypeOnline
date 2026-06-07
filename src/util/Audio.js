var tink = require("../audio/tink.mp3");
var { PHONEMES } = require("./constants");

var synthesis;
if ("speechSynthesis" in window) {
  synthesis = window.speechSynthesis;
} else {
  console.log("Text-to-speech not supported.");
}

// Shared AudioContext — reused across all phoneme calls to avoid per-call init latency.
var sharedAudioContext = null;
const getAudioContext = () => {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (Constructor) {
      sharedAudioContext = new Constructor();
    }
  }
  if (sharedAudioContext && sharedAudioContext.state === "suspended") {
    sharedAudioContext.resume().catch(() => {});
  }
  return sharedAudioContext;
};

//GLOBALS
var SPEECH_RATE = 1.0;
var PLAY_AUDIO = true;

const getPreferredVoice = (voices) => {
  return (
    voices.find(
      (v) => v.lang === "en-US" && v.localService && v.name === "Samantha",
    ) ||
    voices.find((v) => v.lang === "en-US" && v.localService) ||
    voices.find((v) => v.lang === "en-US") ||
    voices[0] ||
    null
  );
};

const safePlayMedia = (media) => {
  try {
    const playResult = media.play();
    if (playResult && typeof playResult.catch === "function") {
      return playResult.then(() => true).catch(() => false);
    }
    return Promise.resolve(true);
  } catch (error) {
    return Promise.resolve(false);
  }
};

const speakTextWithBrowser = async (text, rate = SPEECH_RATE) => {
  if (!PLAY_AUDIO || !synthesis) {
    return false;
  }

  const safeText = String(text || "").trim();
  if (!safeText) {
    return true;
  }

  const voices = await getVoices().catch(() => []);

  synthesis.cancel();
  // Chrome silently drops speak() calls made too soon after cancel().
  // An 80ms gap is enough to let the browser process the cancellation.
  await new Promise((resolve) => setTimeout(resolve, 80));

  if (!PLAY_AUDIO) {
    return false;
  }

  // Resume in case the synthesis engine ended up in a paused state.
  if (synthesis.paused) {
    synthesis.resume();
  }

  return new Promise((resolve) => {
    var speech = new SpeechSynthesisUtterance();
    speech.voice = getPreferredVoice(voices);
    speech.text = safeText;
    speech.rate = rate;
    speech.lang = "en-US";
    speech.onend = () => resolve(true);
    speech.onerror = (event) => {
      // "interrupted" and "canceled" are fired when synthesis.cancel() clears
      // the queue before a new utterance; they are not real failures.
      const errorType = event?.error;
      if (errorType === "interrupted" || errorType === "canceled") {
        resolve(true);
        return;
      }
      resolve(false);
    };
    try {
      synthesis.speak(speech);
    } catch (error) {
      resolve(false);
      return;
    }

    setTimeout(
      () => resolve(true),
      Math.max(5000, (safeText.length / 10) * (1 / Math.max(rate, 0.1)) * 1000),
    );
  });
};

export const speakText = async (text, rate = SPEECH_RATE) => {
  return speakTextWithBrowser(text, rate);
};

export const stopSpeaking = () => {
  if (!synthesis) {
    return;
  }
  try {
    synthesis.cancel();
  } catch (error) {
    return;
  }
};

const resolvePhonemeAudioFile = (phoneme) => {
  const raw = String(phoneme || "").trim();
  if (!raw) {
    return null;
  }

  if (/\.mp3$/i.test(raw)) {
    // Keep explicit file names, but force S to always use the unvoiced clip.
    if (raw.toLowerCase() === "s.mp3") {
      return "s.mp3";
    }
    return raw;
  }

  const normalized = raw.toUpperCase().replace(/[0-9]/g, "");

  // Explicit safeguard requested: S must not sound like Z.
  if (normalized === "S") {
    return "s.mp3";
  }

  if (normalized === "Z") {
    return "z.mp3";
  }

  return PHONEMES[normalized] || PHONEMES[raw] || null;
};

const getVoices = () => {
  return new Promise((resolve) => {
    if (!synthesis) {
      resolve([]);
      return;
    }

    // Resolve immediately if voices are already available.
    const immediate = synthesis.getVoices();
    if (immediate.length > 0) {
      resolve(immediate);
      return;
    }
    let id;
    const timeoutId = setTimeout(() => {
      clearInterval(id);
      resolve(synthesis.getVoices()); // resolve with whatever is available
    }, 3000);
    id = setInterval(() => {
      const voices = synthesis.getVoices();
      if (voices.length > 0) {
        clearInterval(id);
        clearTimeout(timeoutId);
        resolve(voices);
      }
    }, 10);
  });
};

export const speakWord = async (word, wordNumber = 1) => {
  if (!PLAY_AUDIO) {
    return true;
  }

  var preambleMap = {
    1: "The first word is:",
    2: "The next word is:",
    3: "Next word is:",
    4: "Next word",
  };
  var preambleText = preambleMap[wordNumber] || "";

  if (preambleText) {
    await speakTextWithBrowser(preambleText, SPEECH_RATE);
  }

  // Always announce the target word; only the preamble tapers off.
  return speakTextWithBrowser(word, Math.max(0.1, SPEECH_RATE * 0.4));
};

export const speakWordSlow = async (word, phonemeSequence = []) => {
  if (!PLAY_AUDIO) {
    return false;
  }

  if (Array.isArray(phonemeSequence) && phonemeSequence.length > 0) {
    for (let i = 0; i < phonemeSequence.length; i += 1) {
      await speakPhoneme(phonemeSequence[i]);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return true;
  }

  return speakTextWithBrowser(word, Math.max(0.1, SPEECH_RATE * 0.4));
};

export const speakPhoneme = async (phoneme) => {
  if (!PLAY_AUDIO) {
    return;
  }

  const fallbackSpeak = () => {
    const fallbackText = String(phoneme || "")
      .trim()
      .replace(/\.mp3$/i, "");
    if (!fallbackText) {
      return Promise.resolve();
    }
    return speakTextWithBrowser(
      fallbackText,
      Math.max(0.35, SPEECH_RATE * 0.6),
    );
  };

  return new Promise((resolve) => {
    const audioFile = resolvePhonemeAudioFile(phoneme);

    if (!audioFile) {
      fallbackSpeak().finally(() => resolve());
      return;
    }

    let sound;
    try {
      sound = new Audio(require(`../audio/phonemes/${audioFile}`));
    } catch (error) {
      fallbackSpeak().finally(() => resolve());
      return;
    }
    amplifySound(sound, 6);
    safePlayMedia(sound).then((started) => {
      if (!started) {
        fallbackSpeak().finally(() => resolve());
      }
    });
    // Resolve when the audio ends so safeSpeakPhoneme's cueDelay properly covers it.
    sound.addEventListener("ended", () => resolve(), { once: true });
    sound.addEventListener(
      "error",
      () => {
        fallbackSpeak().finally(() => resolve());
      },
      { once: true },
    );
    // Safety net in case events never fire.
    setTimeout(() => resolve(), 1500);
  });
};

const amplifySound = (sound, multiplier) => {
  const context = getAudioContext();
  if (!context) {
    return;
  }
  const result = {
    context: context,
    source: context.createMediaElementSource(sound),
    gain: context.createGain(),
    media: sound,
    amplify: function (multiplier) {
      result.gain.gain.value = multiplier;
    },
    getAmpLevel: function () {
      return result.gain.gain.value;
    },
  };
  result.source.connect(result.gain);
  result.gain.connect(context.destination);
  result.amplify(multiplier);
};

export const changeSpeechSpeed = (speed) => {
  var transformedSpeed = SPEECH_RATE;
  var speedString;
  switch (speed) {
    case 0:
      transformedSpeed = 0.5;
      speedString = "slower";
      break;
    case 25:
      transformedSpeed = 0.6;
      speedString = "slow";
      break;
    case 50:
      transformedSpeed = 1.0;
      speedString = "normal";
      break;
    case 75:
      transformedSpeed = 1.5;
      speedString = "fast";
      break;
    case 100:
      transformedSpeed = 2.0;
      speedString = "faster";
      break;
    default:
      break;
  }

  SPEECH_RATE = transformedSpeed;
  if (!synthesis) {
    return;
  }
  if (!speedString) {
    return;
  }

  synthesis.cancel();

  getVoices().then((voices) => {
    var voice = getPreferredVoice(voices);

    var text = `This is how ${speedString} speed sounds.`;
    var speech = new SpeechSynthesisUtterance(speedString);
    speech.voice = voice;
    speech.text = text;
    speech.rate = SPEECH_RATE;
    speech.lang = "en-US";
    try {
      synthesis.speak(speech);
    } catch (error) {
      return;
    }
  });
};

export const playStartBells = () => {
  if (!PLAY_AUDIO) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const TINK = new Audio(tink);
    var numTinks = 0;
    let settled = false;

    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const playOnce = () => {
      safePlayMedia(TINK).then((started) => {
        if (!started) {
          finish();
        }
      });
    };

    TINK.addEventListener("ended", () => {
      setTimeout(() => {
        if (numTinks < 2) {
          numTinks++;
          playOnce();
        } else {
          finish();
        }
      }, 400);
    });

    TINK.addEventListener("error", finish, { once: true });
    playOnce();
    setTimeout(finish, 4000);
  });
};

export const primeAudioPlayback = () => {
  // Always re-enable audio on an explicit user action regardless of previous state.
  PLAY_AUDIO = true;

  try {
    if (synthesis) {
      getVoices().catch(() => {});

      // Chrome requires speechSynthesis.speak() to be called within a user
      // gesture before it will allow subsequent async speak() calls. Speak a
      // silent, near-instant utterance here (called from the Start Lesson click
      // handler) to unlock the API for the async playWordFlow sequence.
      // Do NOT call synthesis.cancel() first — cancelling immediately before
      // speak() triggers a Chrome bug where the utterance is silently dropped.
      const unlockUtterance = new SpeechSynthesisUtterance(" ");
      unlockUtterance.volume = 0;
      unlockUtterance.rate = 10;
      synthesis.speak(unlockUtterance);
    }

    // Resume the shared AudioContext so amplifySound works correctly.
    // Do NOT create a new context here — that would leave the shared one suspended.
    const context = getAudioContext();
    if (context && context.state === "suspended") {
      return context.resume().catch(() => Promise.resolve(true));
    }
  } catch (error) {
    return Promise.resolve(false);
  }

  return Promise.resolve(true);
};

export const setPlayAudio = (should_play) => {
  PLAY_AUDIO = should_play;
};

export const terminateAudio = () => {
  PLAY_AUDIO = false;
  // Do NOT call synthesis.cancel() here. Cancelling immediately before the
  // next word's speak() call triggers a Chrome bug where the new utterance
  // is silently dropped. Setting PLAY_AUDIO=false is sufficient to stop the
  // current flow; speakTextWithBrowser's own cancel() will clear any
  // lingering utterance before the next word starts.
};

export { SPEECH_RATE };
