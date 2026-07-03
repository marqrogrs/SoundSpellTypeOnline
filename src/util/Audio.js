var tink = require("../audio/tink.mp3");
var { PHONEMES, LESSON_FLOW_TIMING } = require("./constants");

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
const placementWordAudioCache = new Map();
const PLACEMENT_FALLBACK_VOLUME = 0.35;
const PLACEMENT_INTER_STAGE_DELAY_MS = 1000;
const VOICES_FALLBACK_TIMEOUT_MS = 500;

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

  const speakBareUtterance = () => {
    return new Promise((resolve) => {
      let didStart = false;
      let settled = false;

      const settle = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      const speech = new SpeechSynthesisUtterance(safeText);
      speech.rate = Math.max(0.2, rate);
      speech.lang = "en-US";
      speech.onstart = () => {
        didStart = true;
      };
      speech.onend = () => settle(true);
      speech.onerror = (event) => {
        const errorType = event?.error;
        if (errorType === "interrupted" || errorType === "canceled") {
          settle(didStart);
          return;
        }
        settle(false);
      };

      try {
        if (synthesis.paused) {
          synthesis.resume();
        }
        synthesis.speak(speech);
      } catch (_error) {
        settle(false);
        return;
      }

      setTimeout(
        () => settle(didStart),
        Math.max(
          1400,
          (safeText.length / 12) *
            (1 / Math.max(Math.max(0.2, rate), 0.2)) *
            1000,
        ),
      );
    });
  };

  const bareResult = await speakBareUtterance();
  if (bareResult || !PLAY_AUDIO) {
    return bareResult;
  }

  const voices = await getVoices().catch(() => []);

  if (!PLAY_AUDIO) {
    return false;
  }

  if (synthesis.paused) {
    synthesis.resume();
  }

  const attemptSpeak = ({ usePreferredVoice }) => {
    return new Promise((resolve) => {
      let didStart = false;
      let settled = false;

      const settle = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      var speech = new SpeechSynthesisUtterance();
      if (usePreferredVoice) {
        speech.voice = getPreferredVoice(voices);
      }
      speech.text = safeText;
      speech.rate = Math.max(0.2, rate);
      speech.lang = "en-US";
      speech.onstart = () => {
        didStart = true;
      };
      speech.onend = () => settle(true);
      speech.onerror = (event) => {
        const errorType = event?.error;
        if (errorType === "interrupted" || errorType === "canceled") {
          settle(didStart);
          return;
        }
        settle(false);
      };

      try {
        synthesis.speak(speech);
      } catch (_error) {
        settle(false);
        return;
      }

      setTimeout(
        () => settle(didStart),
        Math.max(
          1400,
          (safeText.length / 12) *
            (1 / Math.max(Math.max(0.2, rate), 0.2)) *
            1000,
        ),
      );
    });
  };

  const primaryResult = await attemptSpeak({ usePreferredVoice: true });
  if (primaryResult || !PLAY_AUDIO) {
    return primaryResult;
  }

  // Retry once with browser-default voice settings when first start fails.
  return attemptSpeak({ usePreferredVoice: false });
};

const speakTextWithBrowserFastStart = async (
  text,
  rate = SPEECH_RATE,
  startTimeoutMs = 450,
) => {
  if (!PLAY_AUDIO || !synthesis) {
    return false;
  }

  const safeText = String(text || "").trim();
  if (!safeText) {
    return true;
  }

  return new Promise((resolve) => {
    let didStart = false;
    let settled = false;

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const speech = new SpeechSynthesisUtterance();
    const immediateVoices = synthesis.getVoices();
    if (immediateVoices.length > 0) {
      speech.voice = getPreferredVoice(immediateVoices);
    }
    speech.text = safeText;
    speech.rate = Math.max(0.2, rate);
    speech.lang = "en-US";
    speech.onstart = () => {
      didStart = true;
      settle(true);
    };
    speech.onend = () => settle(true);
    speech.onerror = (event) => {
      const errorType = event?.error;
      if (errorType === "interrupted" || errorType === "canceled") {
        settle(didStart);
        return;
      }
      settle(false);
    };

    try {
      if (synthesis.paused) {
        synthesis.resume();
      }
      synthesis.speak(speech);
    } catch (_error) {
      settle(false);
      return;
    }

    setTimeout(
      () => {
        if (!didStart) {
          try {
            synthesis.cancel();
          } catch (_err) {
            // Ignore cancellation errors and fall back.
          }
          settle(false);
        }
      },
      Math.max(200, startTimeoutMs),
    );
  });
};

const sleep = (delayMs) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

const playBase64Audio = async (audioBase64, mimeType = "audio/mpeg") => {
  const data = String(audioBase64 || "").trim();
  if (!data) {
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const audio = new Audio(`data:${mimeType};base64,${data}`);
    audio.volume = PLACEMENT_FALLBACK_VOLUME;
    const onEnded = () => settle(true);
    const onError = () => settle(false);

    audio.addEventListener("ended", onEnded, { once: true });
    audio.addEventListener("error", onError, { once: true });

    safePlayMedia(audio).then((started) => {
      if (!started) {
        settle(false);
      }
    });

    setTimeout(() => settle(false), 5000);
  });
};

const speakPlacementWordFromPublicTts = async (word) => {
  const safeWord = String(word || "").trim();
  if (!safeWord) {
    return false;
  }

  const url =
    "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=" +
    encodeURIComponent(safeWord);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const audio = new Audio(url);
    audio.volume = PLACEMENT_FALLBACK_VOLUME;
    audio.addEventListener("ended", () => settle(true), { once: true });
    audio.addEventListener("error", () => settle(false), { once: true });

    safePlayMedia(audio).then((started) => {
      if (!started) {
        settle(false);
      }
    });

    setTimeout(() => settle(false), 5000);
  });
};

const speakPlacementWordFromCloud = async (word) => {
  const safeWord = String(word || "")
    .trim()
    .toLowerCase();
  if (!safeWord) {
    return false;
  }

  const cached = placementWordAudioCache.get(safeWord);
  if (cached && cached.audioBase64) {
    return playBase64Audio(cached.audioBase64, cached.mimeType || "audio/mpeg");
  }
  if (cached && cached.unavailable) {
    return speakPlacementWordFromPublicTts(safeWord);
  }

  try {
    const response = await fetch(
      "https://us-central1-soundspeller-c5e53.cloudfunctions.net/synthesizeWordAudioHttp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ word: safeWord }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!payload?.available || !payload?.audioBase64) {
      placementWordAudioCache.set(safeWord, { unavailable: true });
      return speakPlacementWordFromPublicTts(safeWord);
    }

    const entry = {
      audioBase64: payload.audioBase64,
      mimeType: payload.mimeType || "audio/mpeg",
    };
    placementWordAudioCache.set(safeWord, entry);
    return playBase64Audio(entry.audioBase64, entry.mimeType);
  } catch (_error) {
    placementWordAudioCache.set(safeWord, { unavailable: true });
    return speakPlacementWordFromPublicTts(safeWord);
  }
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

const unlockSynthesis = async () => {
  // Resume shared audio context; this is cheap and keeps phoneme playback healthy.
  const context = getAudioContext();
  if (context && context.state === "suspended") {
    try {
      await context.resume();
    } catch (_err) {
      // Continue even if context resume fails.
    }
  }

  // Resume speech engine if paused. Do not enqueue warmup utterances here,
  // because repeated async calls can create a queue and starve real word speech.
  if (!synthesis) {
    return;
  }
  try {
    if (synthesis.paused) {
      synthesis.resume();
    }
  } catch (_err) {
    // Continue.
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

const normalizePlacementPhonemes = (phonemes = []) => {
  const source = Array.isArray(phonemes) ? phonemes : [];
  const normalized = [];

  for (let i = 0; i < source.length; i += 1) {
    const token = String(source[i] || "").trim();
    if (!token) {
      continue;
    }

    if (/\.mp3$/i.test(token)) {
      normalized.push(token);
      continue;
    }

    let key = token.toUpperCase().replace(/[0-9]/g, "");

    // Placement legacy aliases: keep this local to placement playback only.
    if (key === "H") key = "HH";
    if (key === "J") key = "JH";
    if (key === "A") key = "AE";

    // Treat trailing L as coda-L so placement playback uses the dark-L clip.
    // This protects words like "poil" even when legacy data stores final "L".
    if (key === "L") {
      let hasFollowingToken = false;
      for (let j = i + 1; j < source.length; j += 1) {
        if (String(source[j] || "").trim()) {
          hasFollowingToken = true;
          break;
        }
      }
      if (!hasFollowingToken) {
        key = "LL";
      }
    }

    // Some legacy entries split OR into O + R.
    if (key === "O") {
      const nextKey = String(source[i + 1] || "")
        .trim()
        .toUpperCase()
        .replace(/[0-9]/g, "");
      if (nextKey === "R") {
        normalized.push("OR");
        i += 1;
        continue;
      }
    }

    normalized.push(key || token);
  }

  return normalized;
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
    }, VOICES_FALLBACK_TIMEOUT_MS);
    id = setInterval(() => {
      const voices = synthesis.getVoices();
      if (voices.length > 0) {
        clearInterval(id);
        clearTimeout(timeoutId);
        resolve(voices);
      }
    }, 20);
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
  return speakTextWithBrowser(word, Math.max(0.45, SPEECH_RATE * 0.75));
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

  return speakTextWithBrowser(word, Math.max(0.45, SPEECH_RATE * 0.75));
};

const speakPlacementWord = async (word) => {
  const safeWord = String(word || "").trim();
  if (!safeWord) {
    return true;
  }

  if (!PLAY_AUDIO) {
    return false;
  }

  const browserResult = await speakTextWithBrowserFastStart(
    safeWord,
    Math.max(0.45, SPEECH_RATE * 0.75),
  );
  if (browserResult) {
    return true;
  }

  return speakPlacementWordFromCloud(safeWord);
};

export const playPlacementWordSequence = async (
  word,
  phonemes = [],
  options = {},
) => {
  // Placement should always attempt audio playback when this flow is triggered.
  PLAY_AUDIO = true;

  const shouldContinue =
    typeof options.shouldContinue === "function"
      ? options.shouldContinue
      : () => true;
  const onStage =
    typeof options.onStage === "function" ? options.onStage : null;
  const wordHoldMs = Number.isFinite(options.wordHoldMs)
    ? options.wordHoldMs
    : PLACEMENT_INTER_STAGE_DELAY_MS;
  const phonemeGapMs = Number.isFinite(options.phonemeGapMs)
    ? options.phonemeGapMs
    : LESSON_FLOW_TIMING.PHONEME_POST_GAP_BASE_MS;
  const replayWordAfterPhonemes = options.replayWordAfterPhonemes === true;
  const speakWordStages = options.speakWordStages !== false;
  const normalizedPhonemes = normalizePlacementPhonemes(phonemes);

  if (!shouldContinue()) {
    return false;
  }

  let firstWordSpoken = false;
  if (speakWordStages) {
    if (onStage) onStage("before-word-start");
    firstWordSpoken = await speakPlacementWord(word);
    if (onStage)
      onStage(`before-word-done:${firstWordSpoken ? "true" : "false"}`);

    if (!shouldContinue()) {
      return false;
    }

    await sleep(wordHoldMs);
  }

  if (!shouldContinue()) {
    return false;
  }

  if (onStage) onStage("phonemes-start");
  for (const phoneme of normalizedPhonemes) {
    if (!shouldContinue()) {
      return false;
    }
    await speakPhoneme(phoneme);
    if (!shouldContinue()) {
      return false;
    }
    await sleep(phonemeGapMs);
  }
  if (onStage) onStage("phonemes-done");

  if (!shouldContinue()) {
    return false;
  }

  const shouldRetryWord = !firstWordSpoken && !replayWordAfterPhonemes;
  if (shouldRetryWord) {
    if (onStage) onStage("retry-word-start");
    const retriedWordSpoken = await speakPlacementWord(word);
    if (onStage)
      onStage(`retry-word-done:${retriedWordSpoken ? "true" : "false"}`);
    return Boolean(retriedWordSpoken);
  }

  if (!replayWordAfterPhonemes) {
    return Boolean(firstWordSpoken);
  }

  await sleep(wordHoldMs);

  if (!shouldContinue()) {
    return false;
  }

  if (onStage) onStage("after-word-start");
  let closingWordSpoken = await speakPlacementWord(word);
  if (!closingWordSpoken) {
    if (onStage) onStage("after-word-retry-start");
    closingWordSpoken = await speakPlacementWord(word);
    if (onStage)
      onStage(`after-word-retry-done:${closingWordSpoken ? "true" : "false"}`);
  }
  if (onStage)
    onStage(`after-word-done:${closingWordSpoken ? "true" : "false"}`);
  return Boolean(firstWordSpoken || closingWordSpoken);
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

export const setSpeechSpeedPreset = (presetKey = "normal") => {
  const normalizedKey = String(presetKey || "normal").toLowerCase();
  switch (normalizedKey) {
    case "slower":
      SPEECH_RATE = 0.5;
      break;
    case "faster":
      SPEECH_RATE = 2.0;
      break;
    case "normal":
    default:
      SPEECH_RATE = 1.0;
      break;
  }
  return SPEECH_RATE;
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

const playTinkSequence = ({ count = 1, gapMs = 220, volume = 0.32 } = {}) => {
  if (!PLAY_AUDIO) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let playIndex = 0;
    let settled = false;

    const finish = (result = true) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const playNext = () => {
      if (playIndex >= count) {
        finish(true);
        return;
      }

      let sound;
      try {
        sound = new Audio(tink);
        sound.volume = volume;
      } catch (_error) {
        finish(false);
        return;
      }

      const currentIndex = playIndex;
      playIndex += 1;

      sound.addEventListener(
        "ended",
        () => {
          if (currentIndex >= count - 1) {
            finish(true);
            return;
          }
          setTimeout(playNext, gapMs);
        },
        { once: true },
      );
      sound.addEventListener("error", () => finish(false), { once: true });

      safePlayMedia(sound).then((started) => {
        if (!started) {
          finish(false);
        }
      });

      setTimeout(() => {
        if (currentIndex >= count - 1) {
          finish(true);
        }
      }, 1800);
    };

    playNext();
  });
};

export const playRewardChime = () => {
  return playTinkSequence({ count: 1, gapMs: 0, volume: 0.24 });
};

export const playCelebrationFanfare = () => {
  return playTinkSequence({ count: 3, gapMs: 180, volume: 0.28 });
};

export const primeAudioPlayback = () => {
  // Always re-enable audio on explicit user actions.
  PLAY_AUDIO = true;

  try {
    let unlockPromise = Promise.resolve(true);
    if (synthesis) {
      getVoices().catch(() => {});

      if (synthesis.paused) {
        synthesis.resume();
      }

      // Kick speech synthesis once inside the user gesture so later async
      // utterances in the flow can start reliably in Chrome/Safari.
      unlockPromise = new Promise((resolve) => {
        let settled = false;
        const settle = () => {
          if (!settled) {
            settled = true;
            resolve(true);
          }
        };

        try {
          const unlockUtterance = new SpeechSynthesisUtterance(" ");
          unlockUtterance.volume = 0;
          unlockUtterance.rate = 10;
          unlockUtterance.onstart = settle;
          unlockUtterance.onend = settle;
          unlockUtterance.onerror = settle;
          synthesis.speak(unlockUtterance);
          setTimeout(settle, 160);
        } catch (_error) {
          settle();
        }
      });
    }

    // Resume the shared AudioContext so amplifySound works correctly.
    const context = getAudioContext();
    if (context && context.state === "suspended") {
      return Promise.all([
        unlockPromise,
        context.resume().catch(() => Promise.resolve(true)),
      ]).then(() => true);
    }

    return unlockPromise;
  } catch (error) {
    return Promise.resolve(false);
  }
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
