import React, { useEffect, useRef } from "react";
import {
  primeAudioPlayback,
  speakWordSlow,
  speakPhoneme,
  stopSpeaking,
} from "../util/Audio";

export default function PlacementOutputWord({
  word,
  phonemes = [],
  runKey,
  onReadyForInput,
}) {
  const readyRef = useRef(onReadyForInput);

  useEffect(() => {
    readyRef.current = onReadyForInput;
  }, [onReadyForInput]);

  useEffect(() => {
    let cancelled = false;

    const signalReady = () => {
      if (!cancelled && typeof readyRef.current === "function") {
        readyRef.current();
      }
    };

    const play = async () => {
      try {
        await primeAudioPlayback();
      } catch (_error) {
        // Continue even if priming fails.
      }

      try {
        await speakWordSlow(word);

        for (const phoneme of Array.isArray(phonemes) ? phonemes : []) {
          if (cancelled) {
            return;
          }
          await speakPhoneme(phoneme);
        }

        if (!cancelled) {
          await speakWordSlow(word);
        }
      } finally {
        signalReady();
      }
    };

    const timeoutId = setTimeout(signalReady, 12000);
    play();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      stopSpeaking();
    };
  }, [phonemes, runKey, word]);

  return (
    <div
      style={{
        fontSize: 20,
        fontWeight: 600,
        color: "#0d47a1",
        textAlign: "center",
      }}
    >
      Listen...
    </div>
  );
}
