export const getLessonSubsection = (lesson) => {
  const lessonId = String(lesson?.lesson_id ?? lesson?.id ?? "").trim();
  if (!lessonId) {
    return "0";
  }

  return lessonId.substring(lessonId.lastIndexOf(".") + 1);
};

export const buildActiveLessonWords = (words = [], lessonId = "") => {
  const cleanedWords = (Array.isArray(words) ? words : [])
    .map((word) => (typeof word === "string" ? word.trim() : ""))
    .filter((word) => word.length > 0);

  const normalizedLessonId = String(lessonId || "").trim();
  if (normalizedLessonId === "1.4") {
    const removedWords = new Set(["HID", "SAP", "POD", "SAT"]);
    return cleanedWords.filter(
      (word) => !removedWords.has(String(word || "").toUpperCase()),
    );
  }
  if (normalizedLessonId === "1.5") {
    const removedWords = new Set(["VAT"]);
    return cleanedWords.filter(
      (word) => !removedWords.has(String(word || "").toUpperCase()),
    );
  }
  if (normalizedLessonId === "5.2") {
    const removedWords = new Set(["ARM", "CAR"]);
    return cleanedWords.filter(
      (word) => !removedWords.has(String(word || "").toUpperCase()),
    );
  }
  if (normalizedLessonId === "8.5") {
    const removedWords = new Set([
      "GLUES",
      "CONSTRUES",
      "DEVALUES",
      "DEVALUED",
      "MISCUED",
      "IMBUES",
      "MISCUING",
      "STEWS",
      "CHEWS",
      "CHEWED",
      "BREWS",
      "BREWED",
      "NEWSCASTING",
      "RENEWALS",
    ]);
    return cleanedWords.filter(
      (word) => !removedWords.has(String(word || "").toUpperCase()),
    );
  }

  // Use the lesson words exactly as configured in Firebase (trimmed only).
  // This avoids forced truncation to 25 words and avoids synthetic duplicates.
  return cleanedWords;
};
