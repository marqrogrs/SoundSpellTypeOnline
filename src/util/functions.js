export const getLessonSubsection = (lesson) => {
  return lesson.lesson_id.substring(lesson.lesson_id.lastIndexOf(".") + 1);
};

export const buildActiveLessonWords = (words = []) => {
  const cleanedWords = (Array.isArray(words) ? words : [])
    .map((word) => (typeof word === "string" ? word.trim() : ""))
    .filter((word) => word.length > 0);

  // Use the lesson words exactly as configured in Firebase (trimmed only).
  // This avoids forced truncation to 25 words and avoids synthetic duplicates.
  return cleanedWords;
};
