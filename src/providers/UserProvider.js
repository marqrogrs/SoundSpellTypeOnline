import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { db } from "../firebase";
import { createStudentAccount } from "../firebase";

const UserContext = React.createContext({});

export default function UserProvider({ children }) {
  const { user, authLoaded, role } = useAuth();
  const [userData, setUserData] = useState(null);
  const [classrooms, setClassrooms] = useState(null);
  const [wordsMasteredTotal, setWordsMasteredTotal] = useState(0);
  const [userDataLoaded, setUserDataLoaded] = useState(false);
  const levelThreeMasteredRef = useRef(new Set());

  const normalizeWord = useCallback((word) => {
    return String(word || "")
      .trim()
      .toUpperCase();
  }, []);

  const registerMasteredWord = useCallback(
    (difficultyLevel, word) => {
      if (String(difficultyLevel) !== "3") {
        return;
      }

      const normalizedWord = normalizeWord(word);
      if (
        !normalizedWord ||
        levelThreeMasteredRef.current.has(normalizedWord)
      ) {
        return;
      }

      levelThreeMasteredRef.current.add(normalizedWord);
      setWordsMasteredTotal((prev) => prev + 1);
    },
    [normalizeWord],
  );

  useEffect(() => {
    if (authLoaded && user) {
      const isEducator = user.email !== null;
      const shouldLoadEducatorClasses = role === "educator";
      console.log(isEducator);
      const usersCollection = db.collection("users");
      const userDocRef = usersCollection.doc(user.uid);
      const userByUsernameQuery = usersCollection
        .where("username", "==", user.uid)
        .limit(1);
      var unsubscribeDirectUser = () => {};
      var unsubscribeUsernameUser = () => {};
      var unsubscribeClasses = () => {};

      const applyUserData = (data) => {
        if (!data) {
          if (isEducator) {
            const initialEducatorData = {
              email: user.email,
              progress: {},
            };

            usersCollection.doc(user.uid).set(initialEducatorData, {
              merge: true,
            });

            setUserData(initialEducatorData);
          } else {
            setUserData(null);
          }
          setClassrooms(null);
          levelThreeMasteredRef.current = new Set();
          setWordsMasteredTotal(0);
          setUserDataLoaded(true);
          return;
        }

        // Lazy-initialize progress for existing educator accounts that
        // were created before the progress field was set on registration.
        if (isEducator && data.progress === undefined) {
          usersCollection.doc(user.uid).update({ progress: {} });
        }

        setUserData(data);

        const masteredByDifficulty = data.words_mastered_by_difficulty || {};
        const levelThreeWords =
          masteredByDifficulty[3] || masteredByDifficulty["3"] || [];
        const normalizedLevelThreeWords = Array.isArray(levelThreeWords)
          ? levelThreeWords.map((word) => normalizeWord(word)).filter(Boolean)
          : [];
        const firestoreSet = new Set(normalizedLevelThreeWords);
        // Merge the incoming Firestore set with whatever we are already tracking
        // in memory. This prevents a stale snapshot (one that arrives before the
        // words_mastered_by_difficulty write has propagated) from resetting the
        // counter back to 0 at lesson completion.
        const mergedSet = new Set([
          ...firestoreSet,
          ...levelThreeMasteredRef.current,
        ]);
        levelThreeMasteredRef.current = mergedSet;
        setWordsMasteredTotal(mergedSet.size);
        setUserDataLoaded(true);
      };

      if (user) {
        console.log(`Subscribing to ${user.uid}`);
        if (isEducator) {
          unsubscribeDirectUser = userDocRef.onSnapshot((snap) => {
            applyUserData(snap.data());
          });
        } else {
          let directData = null;
          let usernameData = null;

          const emitStudentData = () => {
            applyUserData(directData || usernameData);
          };

          unsubscribeDirectUser = userDocRef.onSnapshot((snap) => {
            directData = snap.exists ? snap.data() : null;
            emitStudentData();
          });

          unsubscribeUsernameUser = userByUsernameQuery.onSnapshot((snap) => {
            usernameData = snap.docs[0]?.data() || null;
            emitStudentData();
          });
        }

        if (shouldLoadEducatorClasses) {
          unsubscribeClasses = userDocRef
            .collection("classes")
            .onSnapshot((querySnap) => {
              const classroomData = querySnap.docs.map((doc) => ({
                id: doc.id,
                students: doc.data().students,
              }));

              setClassrooms(classroomData);
            });
        }
      } else {
        console.log("No user");
        // history.push('/')
      }
      return () => {
        unsubscribeDirectUser();
        unsubscribeUsernameUser();
        unsubscribeClasses();
      };
    }
  }, [user, authLoaded, role]);

  const addNewStudent = (student) => {
    return createStudentAccount(student)
      .then((result) => {
        if (result?.data?.error) {
          throw new Error(
            result.data.error.message || String(result.data.error),
          );
        }
        return result;
      })
      .catch((error) => {
        const readableError =
          error?.details || error?.message || "Unable to add student.";
        throw new Error(readableError);
      });
  };
  return (
    <UserContext.Provider
      value={{
        userData,
        userDataLoaded,
        addNewStudent,
        classrooms,
        wordsMasteredTotal,
        registerMasteredWord,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export { UserProvider, UserContext };
