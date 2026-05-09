const PERF_STORE_KEY = "__sstoPerfStore";

const getStore = () => {
  if (typeof window === "undefined") {
    return null;
  }

  if (!window[PERF_STORE_KEY]) {
    window[PERF_STORE_KEY] = {
      currentSessionId: null,
      sessions: {},
      lastSummary: null,
    };
  }

  return window[PERF_STORE_KEY];
};

const getSession = (sessionId) => {
  const store = getStore();
  if (!store || !sessionId) {
    return null;
  }

  return store.sessions[sessionId] || null;
};

const maybeLogSummary = (sessionId) => {
  const session = getSession(sessionId);
  if (!session || session.summaryLogged) {
    return;
  }

  const metrics = session.metrics || {};
  const hasAuth = Number.isFinite(metrics.authCallbackMs);
  const hasHomePaint = Number.isFinite(metrics.homeFirstPaintMs);
  const lessonSkipped = Boolean(metrics.lessonInitialDataSkipped);
  const hasLessonData = Number.isFinite(metrics.lessonInitialDataMs);

  if (!hasAuth || !hasHomePaint || (!lessonSkipped && !hasLessonData)) {
    return;
  }

  session.summaryLogged = true;
  const summary = {
    sessionId,
    uid: session.meta?.uid || "",
    role: session.meta?.role || "",
    adminHome: Boolean(metrics.adminHome),
    authCallbackMs: metrics.authCallbackMs,
    timeSinceAppOpenMs: metrics.timeSinceAppOpenMs ?? null,
    homeFirstPaintMs: metrics.homeFirstPaintMs,
    lessonInitialDataMs: hasLessonData ? metrics.lessonInitialDataMs : null,
    lessonInitialDataSkipped: lessonSkipped,
    route: metrics.route || "",
  };

  const store = getStore();
  if (store) {
    store.lastSummary = summary;
  }

  console.info("[perf] login-session-summary", summary);
};

export const startPerfSession = (meta = {}) => {
  const store = getStore();
  if (!store) {
    return null;
  }

  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  store.currentSessionId = sessionId;
  store.sessions[sessionId] = {
    meta,
    metrics: {},
    summaryLogged: false,
  };

  return sessionId;
};

export const clearCurrentPerfSession = () => {
  const store = getStore();
  if (!store) {
    return;
  }

  store.currentSessionId = null;
};

export const getCurrentPerfSessionId = () => {
  const store = getStore();
  if (!store) {
    return null;
  }

  return store.currentSessionId || null;
};

export const setPerfMetric = (name, value, options = {}) => {
  const store = getStore();
  if (!store) {
    return;
  }

  const sessionId = options.sessionId || store.currentSessionId;
  if (!sessionId) {
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    return;
  }

  session.metrics[name] = value;
  maybeLogSummary(sessionId);
};

export const getLatestPerfSessionSummary = () => {
  const store = getStore();
  if (!store || !store.lastSummary) {
    return null;
  }

  return { ...store.lastSummary };
};
