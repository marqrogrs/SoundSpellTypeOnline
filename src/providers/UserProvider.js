import React, { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { db } from "../firebase";
import { createStudentAccount } from "../firebase";

const UserContext = React.createContext({});

export default function UserProvider({ children }) {
  const { user, authLoaded } = useAuth();
  const [userData, setUserData] = useState(null);
  const [classrooms, setClassrooms] = useState(null);
  const [totalScore, setTotalScore] = useState(0);
  const [userDataLoaded, setUserDataLoaded] = useState(false);

  useEffect(() => {
    if (authLoaded && user) {
      const isEducator = user.email !== null;
      console.log(isEducator);
      const userDoc = isEducator
        ? db.collection("users").doc(user.uid)
        : db.collection("users").where("username", "==", user.uid);
      var unsubscribeUser = () => {};
      var unsubscribeClasses = () => {};
      if (user) {
        console.log(`Subscribing to ${user.uid}`);
        unsubscribeUser = userDoc.onSnapshot((snap) => {
          const data = isEducator ? snap.data() : snap.docs[0]?.data();

          if (!data) {
            if (isEducator) {
              const initialEducatorData = {
                email: user.email,
                progress: {},
              };

              db.collection("users")
                .doc(user.uid)
                .set(initialEducatorData, { merge: true });

              setUserData(initialEducatorData);
            } else {
              setUserData(null);
            }
            setClassrooms(null);
            setTotalScore(0);
            setUserDataLoaded(true);
            return;
          }

          // Lazy-initialize progress for existing educator accounts that
          // were created before the progress field was set on registration.
          if (isEducator && data.progress === undefined) {
            db.collection("users").doc(user.uid).update({ progress: {} });
          }

          setUserData(data);

          //Calculate total score
          const progress = data.progress || {};
          const total_score = Object.values(progress).reduce((acc, section) => {
            var high_score = 0;
            Object.values(section || {}).forEach((id) => {
              Object.values(id || {}).forEach((level) => {
                if (!level) {
                  return;
                }
                const score = Number(level.score) || 0;
                const bestScore = Number(level.high_score) || 0;
                high_score += Math.max(bestScore, score);
              });
            });
            return (acc += high_score);
          }, 0);
          setTotalScore(total_score);
          setUserDataLoaded(true);
        });
        if (isEducator) {
          unsubscribeClasses = userDoc
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
        unsubscribeUser();
        unsubscribeClasses();
      };
    }
  }, [user, authLoaded]);

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
        totalScore,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export { UserProvider, UserContext };
