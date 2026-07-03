import React, { useEffect, useRef } from "react";
import { playPlacementWordSequence, primeAudioPlayback } from "../util/Audio";

const PRIME_AUDIO_TIMEOUT_MS = 50;

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
        await Promise.race([
          primeAudioPlayback(),
          new Promise((resolve) => setTimeout(resolve, PRIME_AUDIO_TIMEOUT_MS)),
        ]);
        await playPlacementWordSequence(word, phonemes, {
          shouldContinue: () => !cancelled,
          speakWordStages: true,
          replayWordAfterPhonemes: true,
        });
      } finally {
        signalReady();
      }
    };

    play();

    return () => {
      cancelled = true;
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
