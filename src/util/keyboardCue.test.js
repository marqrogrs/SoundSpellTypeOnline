import { buildKeyboardCuePressPlan } from "./keyboardCue";

describe("buildKeyboardCuePressPlan", () => {
  test("marks doubled letters so the same key can be replayed", () => {
    expect(buildKeyboardCuePressPlan("OO")).toEqual([
      { key: "o", bounceBeforePress: false },
      { key: "o", bounceBeforePress: true },
    ]);
  });

  test("does not bounce different letters in the same grapheme", () => {
    expect(buildKeyboardCuePressPlan("SH")).toEqual([
      { key: "s", bounceBeforePress: false },
      { key: "h", bounceBeforePress: false },
    ]);
  });

  test("returns an empty plan for missing graphemes", () => {
    expect(buildKeyboardCuePressPlan(null)).toEqual([]);
  });
});
