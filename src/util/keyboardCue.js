export function buildKeyboardCuePressPlan(grapheme) {
  const letters = Array.from(String(grapheme || "").toLowerCase()).filter(
    Boolean,
  );

  return letters.map((key, index) => ({
    key,
    bounceBeforePress: index > 0 && letters[index - 1] === key,
  }));
}
