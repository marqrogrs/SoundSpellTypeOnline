/**
 * customLessonHelpers.js
 *
 * All Firestore data-access functions for the Custom Lesson system.
 *
 * Collections used:
 *   educatorClasses      – classes created by educators, with student rosters
 *   customLessons        – lessons created by educators or students
 *   customLessonProgress – per-student progress on each custom lesson
 */

import firebase from "../firebase";
import { db } from "../firebase";

const EDUCATOR_CLASSES = "educatorClasses";
const CUSTOM_LESSONS = "customLessons";
const CUSTOM_LESSON_PROGRESS = "customLessonProgress";

const serverTimestamp = () => firebase.firestore.FieldValue.serverTimestamp();

// ─── Word Validation ──────────────────────────────────────────────────────────
//
// Checks a raw word list against the Firebase `words` collection.
// Returns { validWords: string[], invalidWords: string[] }.
// Words are normalised to uppercase; duplicates are collapsed.

export const validateWords = async (wordList) => {
  if (!Array.isArray(wordList) || wordList.length === 0) {
    return { validWords: [], invalidWords: [] };
  }

  const unique = [
    ...new Set(
      wordList.map((w) => String(w).trim().toUpperCase()).filter(Boolean),
    ),
  ];

  const found = {};

  // Firestore `in` supports up to 10 values per query – batch accordingly.
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    const snap = await db.collection("words").where("word", "in", batch).get();
    snap.docs.forEach((doc) => {
      const w = doc.data().word;
      if (w) found[w] = true;
    });
  }

  const validWords = unique.filter((w) => found[w]);
  const invalidWords = unique.filter((w) => !found[w]);
  return { validWords, invalidWords };
};

// ─── Educator Class Management ────────────────────────────────────────────────

/**
 * Subscribe (real-time) to all classes owned by an educator.
 * Returns an unsubscribe function.
 */
export const subscribeToEducatorClasses = (educatorId, callback) => {
  return db
    .collection(EDUCATOR_CLASSES)
    .where("educatorId", "==", educatorId)
    .orderBy("createdAt", "desc")
    .onSnapshot((snap) => {
      callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
};

/**
 * Subscribe (real-time) to ALL educator classes (for schoolAdmin / admin).
 * Returns an unsubscribe function.
 */
export const subscribeToAllEducatorClasses = (callback) => {
  return db
    .collection(EDUCATOR_CLASSES)
    .orderBy("createdAt", "desc")
    .onSnapshot((snap) => {
      callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
};

/**
 * Subscribe (real-time) to all active schools.
 * Available to schoolAdmin and admin via Firestore rules.
 * Returns an unsubscribe function.
 */
export const subscribeToSchools = (callback) => {
  return db
    .collection("schools")
    .where("isActive", "==", true)
    .orderBy("name")
    .onSnapshot((snap) => {
      callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
};

/**
 * Create a new class for an educator.
 * Returns a Promise that resolves with the new DocumentReference.
 */
export const createClass = (
  educatorId,
  educatorName,
  className,
  description = "",
) => {
  return db.collection(EDUCATOR_CLASSES).add({
    educatorId,
    educatorName,
    className: className.trim(),
    description: description.trim(),
    students: {}, // map of { [username]: { name, username, addedAt } }
    studentIds: [], // flat array for Firestore array-contains queries
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

/**
 * Update a class's name or description.
 */
export const updateClass = (classId, updates) => {
  return db
    .collection(EDUCATOR_CLASSES)
    .doc(classId)
    .update({
      ...updates,
      updatedAt: serverTimestamp(),
    });
};

/**
 * Delete a class. Custom lessons previously assigned to it remain but
 * become inaccessible to students (no security-rule match).
 */
export const deleteClass = (classId) => {
  return db.collection(EDUCATOR_CLASSES).doc(classId).delete();
};

/**
 * Add a student to a class roster.
 * studentUsername is the student's Firebase UID (which equals their username).
 */
export const addStudentToClass = (classId, studentUsername, studentName) => {
  return db
    .collection(EDUCATOR_CLASSES)
    .doc(classId)
    .update({
      [`students.${studentUsername}`]: {
        name: studentName || studentUsername,
        username: studentUsername,
        addedAt: serverTimestamp(),
      },
      studentIds: firebase.firestore.FieldValue.arrayUnion(studentUsername),
      updatedAt: serverTimestamp(),
    });
};

/**
 * Remove a student from a class roster.
 */
export const removeStudentFromClass = (classId, studentUsername) => {
  return db
    .collection(EDUCATOR_CLASSES)
    .doc(classId)
    .update({
      [`students.${studentUsername}`]: firebase.firestore.FieldValue.delete(),
      studentIds: firebase.firestore.FieldValue.arrayRemove(studentUsername),
      updatedAt: serverTimestamp(),
    });
};

/**
 * Search students by username prefix (case-sensitive, lowercase).
 * Returns an array of plain user data objects.
 */
export const searchStudentsByUsername = async (query) => {
  const trimmed = String(query || "").trim();
  if (trimmed.length < 2) return [];

  // Prefix range query on the `username` field.
  // Student documents always have a `username` field; educator documents do not.
  const end = trimmed.replace(/.$/, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 1),
  );

  const snap = await db
    .collection("users")
    .where("username", ">=", trimmed)
    .where("username", "<", end)
    .limit(10)
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    username: doc.data().username,
    name: doc.data().name || doc.data().username,
  }));
};

/**
 * Return an array of class IDs that a student belongs to.
 * Used on the student's Custom Lessons page to also fetch class-assigned lessons.
 */
export const getStudentClassIds = async (studentId) => {
  const [legacySnap, v2Snap] = await Promise.all([
    db
      .collection(EDUCATOR_CLASSES)
      .where("studentIds", "array-contains", studentId)
      .get(),
    db
      .collection("classes")
      .where("studentIds", "array-contains", studentId)
      .get(),
  ]);

  const ids = new Set();
  legacySnap.docs.forEach((doc) => ids.add(doc.id));
  v2Snap.docs.forEach((doc) => ids.add(doc.id));
  return Array.from(ids);
};

// ─── Custom Lesson CRUD ───────────────────────────────────────────────────────

/**
 * Create a new custom lesson.
 *
 * lessonData shape:
 * {
 *   name: string,
 *   creatorId: string,
 *   creatorName: string,
 *   creatorType: "student" | "educator",
 *   words: string[],           // validated, uppercase words
 *   difficultyLevels: number[], // subset of [1, 2, 3]
 *   type: "personal" | "forStudent" | "forClass",
 *
 *   // forStudent only:
 *   assignedStudentIds?: string[],
 *
 *   // forClass only:
 *   assignedClassId?: string,
 *   assignedClassName?: string,
 *
 *   // educator-created only:
 *   educatorId?: string,
 *   educatorName?: string,
 * }
 *
 * Returns a Promise<DocumentReference>.
 */
export const createCustomLesson = (lessonData) => {
  return db.collection(CUSTOM_LESSONS).add({
    ...lessonData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

/**
 * Update mutable fields of a custom lesson (name, words, difficultyLevels, etc.).
 */
export const updateCustomLesson = (lessonId, updates) => {
  return db
    .collection(CUSTOM_LESSONS)
    .doc(lessonId)
    .update({
      ...updates,
      updatedAt: serverTimestamp(),
    });
};

/**
 * Permanently delete a custom lesson.
 * (Progress records for deleted lessons are orphaned but harmless.)
 */
export const deleteCustomLesson = (lessonId) => {
  return db.collection(CUSTOM_LESSONS).doc(lessonId).delete();
};

/**
 * Subscribe (real-time) to all lessons created by a user.
 */
export const subscribeToLessonsByCreator = (creatorId, callback) => {
  return db
    .collection(CUSTOM_LESSONS)
    .where("creatorId", "==", creatorId)
    .orderBy("createdAt", "desc")
    .onSnapshot((snap) => {
      callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
};

/**
 * Subscribe (real-time) to lessons directly assigned to a student.
 */
export const subscribeToLessonsForStudent = (studentId, callback) => {
  return db
    .collection(CUSTOM_LESSONS)
    .where("assignedStudentIds", "array-contains", studentId)
    .orderBy("createdAt", "desc")
    .onSnapshot((snap) => {
      callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
};

/**
 * Subscribe (real-time) to lessons assigned to a specific class.
 */
export const subscribeToLessonsForClass = (classId, callback) => {
  return db
    .collection(CUSTOM_LESSONS)
    .where("assignedClassId", "==", classId)
    .orderBy("createdAt", "desc")
    .onSnapshot((snap) => {
      callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
};

/**
 * Subscribe (real-time) to lessons assigned to a specific school.
 * Used by students whose user doc has a matching schoolId.
 */
export const subscribeToLessonsForSchool = (schoolId, callback) => {
  if (!schoolId) {
    callback([]);
    return () => {};
  }
  return db
    .collection(CUSTOM_LESSONS)
    .where("type", "==", "forSchool")
    .where("assignedSchoolId", "==", schoolId)
    .orderBy("createdAt", "desc")
    .onSnapshot((snap) => {
      callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
};

/**
 * Subscribe (real-time) to lessons assigned to the entire platform (forAll).
 */
export const subscribeToLessonsForAll = (callback) => {
  return db
    .collection(CUSTOM_LESSONS)
    .where("type", "==", "forAll")
    .orderBy("createdAt", "desc")
    .onSnapshot((snap) => {
      callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
};

/**
 * Subscribe (real-time) to all lessons assigned to any of the given class IDs.
 * Handles Firestore's 10-value `in` limit by using the first 10 class IDs.
 * For students in many classes, additional batches can be added in the future.
 */
export const subscribeToLessonsForClasses = (classIds, callback) => {
  if (!classIds || classIds.length === 0) {
    callback([]);
    return () => {};
  }
  const batch = classIds.slice(0, 10);
  return db
    .collection(CUSTOM_LESSONS)
    .where("assignedClassId", "in", batch)
    .orderBy("createdAt", "desc")
    .onSnapshot((snap) => {
      callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
};

/**
 * Fetch a single custom lesson document once.
 * Returns the plain data object or null if not found.
 */
export const getCustomLesson = async (lessonId) => {
  const doc = await db.collection(CUSTOM_LESSONS).doc(lessonId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
};

// ─── Custom Lesson Progress ───────────────────────────────────────────────────

/**
 * Subscribe (real-time) to a student's progress record for a single lesson.
 * Calls back with the progress object or null if not yet started.
 */
export const subscribeToCustomLessonProgress = (
  lessonId,
  studentId,
  callback,
) => {
  return db
    .collection(CUSTOM_LESSON_PROGRESS)
    .where("lessonId", "==", lessonId)
    .where("studentId", "==", studentId)
    .limit(1)
    .onSnapshot((snap) => {
      const doc = snap.docs[0];
      callback(doc ? { id: doc.id, ...doc.data() } : null);
    });
};

/**
 * Start a new attempt for a student on a custom lesson.
 *
 * - If a progress record already exists, it resets completion data and
 *   increments the attempt counter.
 * - If no record exists, it creates one.
 *
 * Returns a Promise<progressDocId: string>.
 */
export const startCustomLessonAttempt = async ({
  lessonId,
  lessonName,
  studentId,
  studentName,
  totalWords,
  educatorId = null,
}) => {
  const existing = await db
    .collection(CUSTOM_LESSON_PROGRESS)
    .where("lessonId", "==", lessonId)
    .where("studentId", "==", studentId)
    .limit(1)
    .get();

  const base = {
    lessonId,
    lessonName,
    studentId,
    studentName,
    educatorId,
    wordsCompleted: [],
    totalWords,
    currentIndex: 0,
    lastAttemptAt: serverTimestamp(),
    completedAt: null,
  };

  if (existing.docs.length > 0) {
    const prevAttempts = existing.docs[0].data().attempts || 0;
    await existing.docs[0].ref.update({ ...base, attempts: prevAttempts + 1 });
    return existing.docs[0].id;
  }

  const ref = await db
    .collection(CUSTOM_LESSON_PROGRESS)
    .add({ ...base, attempts: 1 });
  return ref.id;
};

/**
 * Update a student's progress record mid-lesson.
 * Typically called after completing each word.
 */
export const updateCustomLessonProgress = (progressId, updates) => {
  return db
    .collection(CUSTOM_LESSON_PROGRESS)
    .doc(progressId)
    .update({
      ...updates,
      lastAttemptAt: serverTimestamp(),
    });
};

/**
 * Mark a lesson attempt as complete.
 */
export const completeCustomLessonAttempt = (progressId) => {
  return db.collection(CUSTOM_LESSON_PROGRESS).doc(progressId).update({
    completedAt: serverTimestamp(),
    lastAttemptAt: serverTimestamp(),
  });
};

/**
 * Subscribe (real-time) to all progress records for lessons an educator created.
 * Used on the Educator Progress Dashboard.
 */
export const subscribeToEducatorLessonProgress = (educatorId, callback) => {
  return db
    .collection(CUSTOM_LESSON_PROGRESS)
    .where("educatorId", "==", educatorId)
    .orderBy("lastAttemptAt", "desc")
    .onSnapshot((snap) => {
      callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
};

/**
 * Subscribe (real-time) to all of a student's custom lesson progress records.
 * Used on the student's Custom Lessons page.
 */
export const subscribeToStudentProgress = (studentId, callback) => {
  return db
    .collection(CUSTOM_LESSON_PROGRESS)
    .where("studentId", "==", studentId)
    .orderBy("lastAttemptAt", "desc")
    .onSnapshot((snap) => {
      callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
};
