import React from "react";
import { getPerfDebugSnapshot } from "../util/perfSession";

const panelStyle = {
  position: "fixed",
  right: 10,
  bottom: 10,
  width: 320,
  maxHeight: "60vh",
  overflow: "auto",
  zIndex: 99999,
  background: "rgba(17, 24, 39, 0.92)",
  color: "#e5e7eb",
  border: "1px solid rgba(148, 163, 184, 0.5)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
};

const headerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 10px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.35)",
  background: "rgba(15, 23, 42, 0.8)",
};

const bodyStyle = {
  padding: "8px 10px",
  lineHeight: 1.4,
};

const metricRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  padding: "2px 0",
};

const titleStyle = {
  margin: 0,
  fontSize: 12,
  letterSpacing: 0.3,
  textTransform: "uppercase",
};

const buttonStyle = {
  border: "1px solid rgba(148, 163, 184, 0.45)",
  borderRadius: 4,
  background: "transparent",
  color: "#e5e7eb",
  cursor: "pointer",
  fontSize: 11,
  padding: "2px 6px",
};

const buttonRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const statusStyle = {
  fontSize: 10,
  opacity: 0.85,
};

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const formatValue = (value) => {
  if (typeof value === "number") {
    return `${Math.round(value)}ms`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
};

const importantMetricOrder = [
  "authCallbackMs",
  "timeSinceAppOpenMs",
  "homeFirstPaintMs",
  "firebaseRoleContextCached",
  "firebaseRoleContextSource",
  "firebaseResolveRoleContextMs",
  "firebaseTokenClaimsFetchMs",
  "firebaseUserDocFetchMs",
  "studentProgressCacheHit",
  "studentProgressStaticCacheHit",
  "studentProgressFullyFromCache",
  "studentProgressSkippedMgmtListData",
  "lessonStaticCacheHit",
  "lessonStaticRefreshSkipped",
  "lessonStaticRefreshMs",
  "lessonInitialDataMs",
  "fn_mgmtListDataMs",
  "adminHome",
  "route",
];

function PerfDebugPanel() {
  const [collapsed, setCollapsed] = React.useState(false);
  const [snapshot, setSnapshot] = React.useState(() => getPerfDebugSnapshot());
  const [lastUpdated, setLastUpdated] = React.useState(() => nowMs());
  const [copyStatus, setCopyStatus] = React.useState("");

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      setSnapshot(getPerfDebugSnapshot());
      setLastUpdated(nowMs());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const metrics = snapshot?.metrics || {};
  const orderedMetricNames = [
    ...importantMetricOrder.filter((name) =>
      Object.prototype.hasOwnProperty.call(metrics, name),
    ),
    ...Object.keys(metrics)
      .filter((name) => !importantMetricOrder.includes(name))
      .sort(),
  ];

  const handleCopySnapshot = React.useCallback(async () => {
    const payload = {
      copiedAt: new Date().toISOString(),
      snapshot,
    };

    const text = JSON.stringify(payload, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        textArea.style.pointerEvents = "none";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setCopyStatus("Copied");
    } catch (error) {
      console.warn("[perf] copy snapshot failed", error);
      setCopyStatus("Copy failed");
    }
  }, [snapshot]);

  React.useEffect(() => {
    if (!copyStatus) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyStatus("");
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyStatus]);

  return (
    <aside style={panelStyle} aria-label="Performance debug panel">
      <div style={headerStyle}>
        <h2 style={titleStyle}>Perf Debug</h2>
        <div style={buttonRowStyle}>
          <button
            type="button"
            style={buttonStyle}
            onClick={handleCopySnapshot}
          >
            Copy
          </button>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div style={bodyStyle}>
          {copyStatus && <div style={statusStyle}>{copyStatus}</div>}
          <div style={metricRowStyle}>
            <span>Session</span>
            <span>{formatValue(snapshot?.sessionId)}</span>
          </div>
          <div style={metricRowStyle}>
            <span>Role</span>
            <span>{formatValue(snapshot?.sessionMeta?.role)}</span>
          </div>
          <div style={metricRowStyle}>
            <span>UID</span>
            <span>{formatValue(snapshot?.sessionMeta?.uid)}</span>
          </div>
          <div style={metricRowStyle}>
            <span>Updated</span>
            <span>{Math.round(lastUpdated)}ms</span>
          </div>

          <hr
            style={{
              borderColor: "rgba(148, 163, 184, 0.35)",
              margin: "8px 0",
            }}
          />

          {orderedMetricNames.length === 0 ? (
            <div>No metrics yet.</div>
          ) : (
            orderedMetricNames.map((name) => (
              <div key={name} style={metricRowStyle}>
                <span>{name}</span>
                <span>{formatValue(metrics[name])}</span>
              </div>
            ))
          )}
        </div>
      )}
    </aside>
  );
}

export default PerfDebugPanel;
