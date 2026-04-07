import React, { useContext, useEffect, useState } from "react";

import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableContainer from "@material-ui/core/TableContainer";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";
import { LessonContext } from "../providers/LessonProvider";
import ProgressListItem from "./ProgressListItem";

import { UserContext } from "../providers/UserProvider";
import { getLessonSubsection } from "../util/functions";
import { INIT_PROGRESS_OBJ, LESSON_SECTION_OVERRIDES } from "../util/constants";
import { useStyles } from "../styles/material";
import { db, auth } from "../firebase";

export default function ProgressList({ student }) {
  const { lessons, lessonSections = {} } = useContext(LessonContext);
  const { userData } = useContext(UserContext);
  const [userLessonData, setUserLessonData] = useState(null);
  const classes = useStyles();

  useEffect(() => {
    // console.log('student: ', student)
    var unsubscribeStudent = () => {};
    if (student) {
      unsubscribeStudent = db
        .collection("users")
        .where("username", "==", student)
        .where("educator", "==", auth.currentUser.uid)
        .onSnapshot((snap) => {
          const firstDoc = snap.docs[0];
          setUserLessonData(firstDoc ? firstDoc.data() : null);
        });
    } else {
      setUserLessonData(userData || { progress: {} });
    }
    return () => {
      unsubscribeStudent();
    };
  }, [student, userData]);

  return (
    <>
      <TableContainer component={Paper} className={classes.table}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Lesson</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right">Status</TableCell>
              <TableCell align="right"></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {userLessonData && (
              <>
                {(() => {
                  let previousSection = null;

                  return lessons.map((lesson) => {
                    const lesson_section = lesson.lesson_section;
                    const lesson_subsection = getLessonSubsection(lesson);
                    const sectionKey = String(lesson_section || "").trim();
                    const currentSection = sectionKey || "unknown";
                    const isNewSection = previousSection !== currentSection;
                    previousSection = currentSection;

                    const sectionMeta = {
                      ...(lessonSections[sectionKey] || {}),
                      ...(LESSON_SECTION_OVERRIDES[sectionKey] || {}),
                    };
                    const fallbackTitle = sectionKey
                      ? `Part ${sectionKey}`
                      : "Part";

                    const sectionTitle = sectionMeta.title
                      ? `Part ${sectionKey} - ${sectionMeta.title}`
                      : fallbackTitle;
                    const sectionDescription = sectionMeta.description || "";

                    const userProgress = userLessonData.progress || {};

                    const progress = userProgress[lesson_section]
                      ? userProgress[lesson_section][lesson_subsection]
                        ? userProgress[lesson_section][lesson_subsection]
                        : JSON.parse(JSON.stringify(INIT_PROGRESS_OBJ))
                      : JSON.parse(JSON.stringify(INIT_PROGRESS_OBJ));

                    return (
                      <React.Fragment key={lesson.lesson_id}>
                        {isNewSection && (
                          <TableRow>
                            <TableCell colSpan={6}>
                              <strong>{sectionTitle}</strong>
                              {sectionDescription ? (
                                <div>{sectionDescription}</div>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        )}
                        <ProgressListItem
                          lesson={lesson}
                          progress={progress}
                          showButtons={student ? false : true}
                        />
                      </React.Fragment>
                    );
                  });
                })()}
              </>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
