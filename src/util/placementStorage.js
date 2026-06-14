export const PENDING_PLACEMENT_REPORT_STORAGE_KEY =
  "soundspeller.pendingPlacementReport";

export const readPendingPlacementReport = () => {
  try {
    const raw = window.localStorage.getItem(
      PENDING_PLACEMENT_REPORT_STORAGE_KEY,
    );
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
};

export const writePendingPlacementReport = (value) => {
  try {
    window.localStorage.setItem(
      PENDING_PLACEMENT_REPORT_STORAGE_KEY,
      JSON.stringify(value || null),
    );
  } catch (_error) {
    // Best effort cache only.
  }
};

export const clearPendingPlacementReport = () => {
  try {
    window.localStorage.removeItem(PENDING_PLACEMENT_REPORT_STORAGE_KEY);
  } catch (_error) {
    // Best effort cache only.
  }
};
