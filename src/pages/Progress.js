import React, { useContext, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Button,
  Container,
  Grid,
  Paper,
  Typography,
  ButtonGroup,
} from "@material-ui/core";
import ProgressList from "../components/ProgressList";
import { useAuth } from "../hooks/useAuth";
import { LessonContext } from "../providers/LessonProvider";
import { UserContext } from "../providers/UserProvider";
import { getLessonSubsection, buildActiveLessonWords } from "../util/functions";

const REQUIRED_ACCURACY_FOR_CHECKMARK = 90;
const DAILY_GOAL_OPTIONS = [
  { value: "10_words", label: "10 words" },
  { value: "1_lesson", label: "1 lesson" },
  { value: "8_minutes", label: "8 minutes" },
];
const DAILY_GOAL_FALLBACK = "1_lesson";
const MILESTONE_TARGETS = [25, 50, 100];

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeWords = (words) =>
  new Set(
    (Array.isArray(words) ? words : [])
      .map((word) =>
        String(word || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  );

const parseDayKey = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const parts = raw.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [year, month, day] = parts;
  return { year, month, day };
};

const diffDaysFromToday = (dayKey) => {
  const parsed = parseDayKey(dayKey);
  if (!parsed) {
    return null;
  }
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const keyUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  return Math.max(0, Math.round((todayUtc - keyUtc) / (24 * 60 * 60 * 1000)));
};

const hasLevelStarted = (levelProgress) => {
  const progress = asObject(levelProgress);
  const completedWords = Number(progress.completed_words) || 0;
  const hasCompletedFlag = Boolean(progress.completed);
  const hasCorrectWords =
    Array.isArray(progress.correct_words) && progress.correct_words.length > 0;
  const hasScore = Number(progress.score) > 0;

  return completedWords > 0 || hasCompletedFlag || hasCorrectWords || hasScore;
};

const getMasteredPercent = (lesson, levelProgress) => {
  const lessonId = String(lesson?.lesson_id || "").trim();
  const totalWords = buildActiveLessonWords(lesson?.words, lessonId).length;
  if (!totalWords) {
    return 0;
  }
  const masteredCount = normalizeWords(levelProgress?.correct_words).size;
  return Math.round((masteredCount / totalWords) * 100);
};

export default function Progress() {
  const { student } = useParams();
  const { lessons = [] } = useContext(LessonContext);
  const { userData, wordsMasteredTotal, updateUserData } =
    useContext(UserContext);
  const auth = useAuth();
  const [savingDailyGoal, setSavingDailyGoal] = useState(false);

  const shouldShowUnifiedTodayPanel = !String(student || "").trim();
  const canShowAccountabilityPanel =
    shouldShowUnifiedTodayPanel &&
    (auth.isAdmin ||
      auth.isSchoolAdmin ||
      auth.isEducator ||
      auth.isParent ||
      auth.isTutor);

  const lessonSummary = useMemo(() => {
    const userProgress = asObject(userData?.progress);
    const lessonRows = (Array.isArray(lessons) ? lessons : []).map((lesson) => {
      const lessonSection = String(lesson?.lesson_section || "").trim();
      const lessonSubsection = getLessonSubsection(lesson);
      const sectionProgress = asObject(userProgress[lessonSection]);
      const rawLessonProgress = asObject(sectionProgress[lessonSubsection]);
      const masteryLevelProgress =
        rawLessonProgress[2] || rawLessonProgress["2"] || {};

      const isStarted = [0, 1, 2].some((levelIndex) =>
        hasLevelStarted(
          rawLessonProgress[levelIndex] ||
            rawLessonProgress[String(levelIndex)],
        ),
      );
      const isCompleted =
        getMasteredPercent(lesson, masteryLevelProgress) >=
        REQUIRED_ACCURACY_FOR_CHECKMARK;

      return {
        lesson,
        isStarted,
        isCompleted,
      };
    });

    const completedCount = lessonRows.filter((row) => row.isCompleted).length;
    const inProgressCount = lessonRows.filter(
      (row) => row.isStarted && !row.isCompleted,
    ).length;

    const resumeLesson =
      lessonRows.find((row) => row.isStarted && !row.isCompleted) || null;
    const nextLesson =
      resumeLesson ||
      lessonRows.find((row) => !row.isCompleted) ||
      lessonRows[lessonRows.length - 1] ||
      null;

    const streak = Math.max(
      0,
      Number(
        userData?.practice_streak ||
          userData?.current_streak ||
          userData?.streak ||
          0,
      ) || 0,
    );

    return {
      completedCount,
      inProgressCount,
      resumeLesson,
      nextLesson,
      streak,
    };
  }, [lessons, userData]);

  const nextLessonId = String(
    lessonSummary?.nextLesson?.lesson?.lesson_id || "",
  ).trim();
  const nextLessonLink = nextLessonId
    ? `/lessons/${nextLessonId}`
    : "/progress";
  const hasFirstLessonAttempted = Boolean(
    userData?.firstLessonAttemptedAt || userData?.first_lesson_attempted_at,
  );
  const storedDailyGoal = String(
    userData?.dailyPracticeGoal || userData?.daily_practice_goal || "",
  ).trim();
  const selectedDailyGoal =
    DAILY_GOAL_OPTIONS.find((option) => option.value === storedDailyGoal) ||
    DAILY_GOAL_OPTIONS.find((option) => option.value === DAILY_GOAL_FALLBACK) ||
    DAILY_GOAL_OPTIONS[0];
  const currentStreak = Math.max(
    0,
    Number(
      userData?.current_streak ||
        userData?.practice_streak ||
        userData?.streak ||
        0,
    ) || 0,
  );
  const streakSaveTokens = Math.max(
    0,
    Number(userData?.streakSaveTokens || userData?.streak_save_tokens || 0) ||
      0,
  );
  const nextMilestoneTarget =
    MILESTONE_TARGETS.find(
      (target) => Number(wordsMasteredTotal || 0) < target,
    ) || MILESTONE_TARGETS[MILESTONE_TARGETS.length - 1];
  const showFirstSessionQuickWin =
    shouldShowUnifiedTodayPanel &&
    !hasFirstLessonAttempted &&
    Boolean(nextLessonId);
  const accountabilityStatus = useMemo(() => {
    const lastPracticeDay = String(
      userData?.lastPracticeDay || userData?.last_practice_day || "",
    ).trim();
    const daysSincePractice = diffDaysFromToday(lastPracticeDay);
    const coachNote = String(
      userData?.accountabilityNote || userData?.accountability_note || "",
    ).trim();
    const nextCheckInDay = String(
      userData?.nextCheckInDay || userData?.next_check_in_day || "",
    ).trim();

    if (!hasFirstLessonAttempted) {
      return {
        tone: "warmup",
        label: "Needs first quick win",
        message:
          "Start one short lesson today. The first success is the biggest momentum unlock.",
        coachNote,
        nextCheckInDay,
      };
    }

    if (daysSincePractice === null) {
      return {
        tone: "warmup",
        label: "No recent activity yet",
        message: "Do one lesson today to establish a consistent rhythm.",
        coachNote,
        nextCheckInDay,
      };
    }

    if (daysSincePractice <= 1) {
      return {
        tone: "ontrack",
        label: "On track",
        message:
          "Great consistency. Keep the streak alive with one focused lesson.",
        coachNote,
        nextCheckInDay,
      };
    }

    if (daysSincePractice <= 3) {
      return {
        tone: "nudge",
        label: "Needs gentle nudge",
        message:
          "You are close to losing momentum. Resume one in-progress lesson today.",
        coachNote,
        nextCheckInDay,
      };
    }

    return {
      tone: "returning",
      label: "Returning after lapse",
      message:
        "Welcome back. Start with one quick-win lesson and rebuild momentum from there.",
      coachNote,
      nextCheckInDay,
    };
  }, [hasFirstLessonAttempted, userData]);
  const primaryActionLabel = lessonSummary?.resumeLesson
    ? "Continue Lesson"
    : "Start Next Lesson";

  const handleSelectDailyGoal = async (goalValue) => {
    const normalizedGoal = String(goalValue || "").trim();
    if (!normalizedGoal || normalizedGoal === storedDailyGoal) {
      return;
    }

    setSavingDailyGoal(true);
    try {
      await updateUserData({
        dailyPracticeGoal: normalizedGoal,
        dailyPracticeGoalUpdatedAt: new Date().toISOString(),
      });
    } finally {
      setSavingDailyGoal(false);
    }
  };

  return (
    <>
      <Container maxWidth="md">
        {showFirstSessionQuickWin && (
          <Paper
            style={{
              marginBottom: 16,
              padding: 16,
              borderRadius: 14,
              background: "linear-gradient(180deg, #fffdf4 0%, #fff6e8 100%)",
              border: "1px solid #f0dfc8",
            }}
          >
            <Typography variant="h6" style={{ marginBottom: 4 }}>
              First Session Quick Win
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Start with one short lesson and get your first 3 correct words.
              That first success builds momentum.
            </Typography>
            <Grid container alignItems="center" style={{ marginTop: 10 }}>
              <Grid item xs={12} sm={8}>
                <Typography variant="body2">
                  Next action: start lesson {nextLessonId}.
                </Typography>
              </Grid>
              <Grid item xs={12} sm={4} style={{ textAlign: "right" }}>
                <Button
                  component={Link}
                  to={nextLessonLink}
                  color="primary"
                  variant="contained"
                >
                  Start Quick Win
                </Button>
              </Grid>
            </Grid>
          </Paper>
        )}

        {shouldShowUnifiedTodayPanel && (
          <Paper
            style={{
              marginBottom: 16,
              padding: 16,
              borderRadius: 14,
              background: "linear-gradient(180deg, #f7fbff 0%, #f2f8f5 100%)",
            }}
          >
            <Typography variant="h5" style={{ marginBottom: 4 }}>
              Today
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Plan, focus, and launch your next lesson.
            </Typography>

            <Grid container spacing={2} style={{ marginTop: 4 }}>
              <Grid item xs={12} sm={4}>
                <Paper style={{ padding: 12, borderRadius: 12 }}>
                  <Typography variant="caption" color="textSecondary">
                    Daily Goal
                  </Typography>
                  <Typography variant="h6" style={{ marginTop: 4 }}>
                    {selectedDailyGoal.label}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    {lessonSummary.inProgressCount > 0
                      ? "Resume one in-progress lesson"
                      : "Start one new lesson"}
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Paper style={{ padding: 12, borderRadius: 12 }}>
                  <Typography variant="caption" color="textSecondary">
                    Streak
                  </Typography>
                  <Typography variant="h6" style={{ marginTop: 4 }}>
                    {currentStreak} days
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    {streakSaveTokens > 0
                      ? `${streakSaveTokens} streak save available`
                      : "Streak save refills after practice this week"}
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Paper style={{ padding: 12, borderRadius: 12 }}>
                  <Typography variant="caption" color="textSecondary">
                    Words Mastered
                  </Typography>
                  <Typography variant="h6" style={{ marginTop: 4 }}>
                    {Number(wordsMasteredTotal || 0)}
                  </Typography>
                </Paper>
              </Grid>
            </Grid>

            <Paper
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 12,
                backgroundColor: "#ffffff",
              }}
            >
              <Typography variant="subtitle1">Milestone Journey</Typography>
              <Typography variant="body2" color="textSecondary">
                Rewards are tied to real mastery. Reach the next target to
                unlock the next step.
              </Typography>
              <Grid container spacing={1} style={{ marginTop: 8 }}>
                {MILESTONE_TARGETS.map((target) => {
                  const mastered = Number(wordsMasteredTotal || 0);
                  const reached = mastered >= target;
                  const remaining = Math.max(0, target - mastered);

                  return (
                    <Grid item xs={12} sm={4} key={target}>
                      <Paper
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          border: reached
                            ? "1px solid #b9dfc8"
                            : "1px solid #d7e2ec",
                          background: reached
                            ? "linear-gradient(180deg, #f3fbf6 0%, #e9f7ef 100%)"
                            : "#f9fbfd",
                        }}
                      >
                        <Typography variant="caption" color="textSecondary">
                          {target} words mastered
                        </Typography>
                        <Typography variant="h6" style={{ marginTop: 2 }}>
                          {reached ? "Reached" : `${remaining} to go`}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          {reached
                            ? "New mastery milestone unlocked."
                            : target === nextMilestoneTarget
                              ? "Next milestone."
                              : "Upcoming milestone."}
                        </Typography>
                      </Paper>
                    </Grid>
                  );
                })}
              </Grid>
            </Paper>

            <Grid container spacing={1} style={{ marginTop: 8 }}>
              <Grid item xs={12}>
                <Typography variant="body2" color="textSecondary">
                  Pick today&apos;s target:
                </Typography>
              </Grid>
              <Grid item xs={12}>
                <ButtonGroup
                  color="primary"
                  variant="outlined"
                  disabled={savingDailyGoal}
                >
                  {DAILY_GOAL_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      variant={
                        selectedDailyGoal.value === option.value
                          ? "contained"
                          : "outlined"
                      }
                      onClick={() => handleSelectDailyGoal(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </ButtonGroup>
              </Grid>
            </Grid>

            <Grid
              container
              spacing={2}
              alignItems="center"
              style={{ marginTop: 6 }}
            >
              <Grid item xs={12} sm={8}>
                <Typography variant="body2">
                  {nextLessonId
                    ? `${lessonSummary.resumeLesson ? "Continue" : "Start next"} lesson: ${nextLessonId}`
                    : "No lesson recommendation available yet."}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  Lessons completed: {lessonSummary.completedCount}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={4} style={{ textAlign: "right" }}>
                <Button
                  component={Link}
                  to={nextLessonLink}
                  color="primary"
                  variant="contained"
                  disabled={!nextLessonId}
                >
                  {primaryActionLabel}
                </Button>
              </Grid>
            </Grid>
          </Paper>
        )}

        <Paper
          style={{
            marginBottom: 16,
            padding: 14,
            borderRadius: 12,
            backgroundColor: "#f8fbff",
          }}
        >
          <Typography variant="subtitle1">Calm Focus</Typography>
          <Typography variant="body2" color="textSecondary">
            One lesson at a time. Use the lesson path below to continue where
            you left off.
          </Typography>
        </Paper>

        {canShowAccountabilityPanel && (
          <Paper
            style={{
              marginBottom: 16,
              padding: 14,
              borderRadius: 12,
              backgroundColor:
                accountabilityStatus.tone === "ontrack"
                  ? "#f2fbf5"
                  : accountabilityStatus.tone === "returning"
                    ? "#fff6ed"
                    : "#fff8f0",
              border:
                accountabilityStatus.tone === "ontrack"
                  ? "1px solid #cfe9d9"
                  : "1px solid #f0dfc8",
            }}
          >
            <Typography variant="subtitle1">Accountability Check-In</Typography>
            <Typography variant="caption" color="textSecondary">
              {accountabilityStatus.label}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {accountabilityStatus.message}
            </Typography>
            {accountabilityStatus.coachNote && (
              <Typography variant="body2" style={{ marginTop: 8 }}>
                Coach note: {accountabilityStatus.coachNote}
              </Typography>
            )}
            {accountabilityStatus.nextCheckInDay && (
              <Typography variant="caption" color="textSecondary">
                Next check-in: {accountabilityStatus.nextCheckInDay}
              </Typography>
            )}
          </Paper>
        )}

        <ProgressList student={student} />
      </Container>
    </>
  );
}
