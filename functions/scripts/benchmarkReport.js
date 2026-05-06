#!/usr/bin/env node
/*
 * Generate an HTML report from module-load tidy benchmarks and enforce
 * CI-style regression checks against an optional baseline file.
 */

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const opts = {
    input: null,
    baseline: null,
    outDir: "benchmarks/reports",
    reportName: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") opts.input = argv[++i];
    else if (a === "--baseline") opts.baseline = argv[++i];
    else if (a === "--out-dir") opts.outDir = argv[++i];
    else if (a === "--report-name") opts.reportName = argv[++i];
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log("Usage: node scripts/benchmarkReport.js [options]");
  console.log("");
  console.log("Options:");
  console.log(
    "  --input <file>       Tidy CSV input (defaults to latest benchmarks/module-load-tidy-*.csv)",
  );
  console.log(
    "  --baseline <file>    Optional baseline tidy CSV for regression checks",
  );
  console.log(
    "  --out-dir <dir>      Output directory for HTML/JSON report (default: benchmarks/reports)",
  );
  console.log(
    "  --report-name <name> Report filename stem (default: benchmark-report-<timestamp>)",
  );
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function latestTidyFile() {
  const dir = path.resolve("benchmarks");
  if (!fs.existsSync(dir)) {
    throw new Error("benchmarks directory not found");
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("module-load-tidy-") && f.endsWith(".csv"))
    .sort()
    .reverse();
  if (!files.length) {
    throw new Error("No module-load-tidy-*.csv files found in benchmarks");
  }
  return path.join(dir, files[0]);
}

function parseCsvLine(line) {
  return line.split(",");
}

function readTidyCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  if (header.join(",") !== "target,run,metric,value") {
    throw new Error(
      `Unexpected tidy header in ${filePath}: ${header.join(",")}`,
    );
  }

  const byTarget = new Map();
  for (let i = 1; i < lines.length; i++) {
    const [target, runStr, metric, valueStr] = parseCsvLine(lines[i]);
    const run = Number(runStr);
    const value = Number(valueStr);
    if (!target || !metric || Number.isNaN(run) || Number.isNaN(value))
      continue;

    if (!byTarget.has(target)) byTarget.set(target, new Map());
    const byMetric = byTarget.get(target);
    if (!byMetric.has(metric)) byMetric.set(metric, []);
    byMetric.get(metric).push({ run, value });
  }

  // Normalize run order for each metric.
  for (const metrics of byTarget.values()) {
    for (const values of metrics.values()) {
      values.sort((a, b) => a.run - b.run);
    }
  }

  return byTarget;
}

function percentile(sortedValues, p) {
  const idx = Math.floor((sortedValues.length - 1) * p);
  return sortedValues[idx];
}

function summarizeMs(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    runs: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    avg: Number((sum / sorted.length).toFixed(2)),
  };
}

function pctDelta(current, baseline) {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(baseline) ||
    baseline === 0
  ) {
    return null;
  }
  return Number((((current - baseline) / baseline) * 100).toFixed(2));
}

function collectMsSeries(byTarget) {
  const out = [];
  for (const [target, metrics] of byTarget.entries()) {
    const ms = metrics.get("ms") || [];
    if (!ms.length) continue;
    out.push({
      target,
      runs: ms.map((p) => p.run),
      values: ms.map((p) => p.value),
      summary: summarizeMs(ms.map((p) => p.value)),
    });
  }
  return out;
}

function runChecks(currentSeries, baselineSeriesByTarget, config) {
  const findings = [];
  let failed = false;

  for (const row of currentSeries) {
    const current = row.summary;
    const baseline = baselineSeriesByTarget.get(row.target)?.summary || null;

    // Hard max check for absolute guardrail.
    if (current.max > config.hardMaxMs) {
      failed = true;
      findings.push({
        level: "fail",
        target: row.target,
        rule: "hard_max",
        message: `max ${current.max}ms exceeds HARD_MAX_MS ${config.hardMaxMs}ms`,
      });
    } else {
      findings.push({
        level: "pass",
        target: row.target,
        rule: "hard_max",
        message: `max ${current.max}ms within HARD_MAX_MS ${config.hardMaxMs}ms`,
      });
    }

    // Outlier count check based on the current series itself.
    const outlierThreshold = Number(
      (current.p95 * config.outlierMultiplier).toFixed(2),
    );
    const outlierCount = row.values.filter((v) => v > outlierThreshold).length;
    findings.push({
      level: "info",
      target: row.target,
      rule: "outliers",
      message: `${outlierCount}/${row.values.length} points > p95*${config.outlierMultiplier} (${outlierThreshold}ms)`,
    });

    if (!baseline) {
      findings.push({
        level: "info",
        target: row.target,
        rule: "baseline",
        message: "No baseline provided; skipped p95/avg regression checks",
      });
      continue;
    }

    const p95Delta = pctDelta(current.p95, baseline.summary.p95);
    const avgDelta = pctDelta(current.avg, baseline.summary.avg);

    if (p95Delta !== null && p95Delta > config.p95RegressionPct) {
      failed = true;
      findings.push({
        level: "fail",
        target: row.target,
        rule: "p95_regression",
        message: `p95 regression ${p95Delta}% exceeds threshold ${config.p95RegressionPct}%`,
      });
    } else {
      findings.push({
        level: "pass",
        target: row.target,
        rule: "p95_regression",
        message: `p95 regression ${p95Delta}% within threshold ${config.p95RegressionPct}%`,
      });
    }

    if (avgDelta !== null && avgDelta > config.avgRegressionPct) {
      failed = true;
      findings.push({
        level: "fail",
        target: row.target,
        rule: "avg_regression",
        message: `avg regression ${avgDelta}% exceeds threshold ${config.avgRegressionPct}%`,
      });
    } else {
      findings.push({
        level: "pass",
        target: row.target,
        rule: "avg_regression",
        message: `avg regression ${avgDelta}% within threshold ${config.avgRegressionPct}%`,
      });
    }
  }

  return { failed, findings };
}

function svgPolyline(values, width, height, color) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1 || 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${points}" />`;
}

function renderHtml(report) {
  const colors = ["#0b6efd", "#198754", "#d63384", "#fd7e14", "#6f42c1"];

  const cards = report.series
    .map((s, i) => {
      const color = colors[i % colors.length];
      const chart = svgPolyline(s.values, 600, 140, color);
      const sum = s.summary;
      return `
      <section class="card">
        <h2>${s.target}</h2>
        <div class="stats">runs=${sum.runs} min=${sum.min} p50=${sum.p50} p95=${sum.p95} p99=${sum.p99} max=${sum.max} avg=${sum.avg}</div>
        <svg viewBox="0 0 600 140" preserveAspectRatio="none" aria-label="${s.target} ms trend">${chart}</svg>
      </section>`;
    })
    .join("\n");

  const findingsRows = report.checks.findings
    .map(
      (f) =>
        `<tr><td>${f.level}</td><td>${f.target}</td><td>${f.rule}</td><td>${f.message}</td></tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Module Load Benchmark Report</title>
  <style>
    :root { --bg:#f7f9fc; --ink:#1f2937; --card:#ffffff; --line:#e5e7eb; }
    body { margin:0; font:14px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; background:var(--bg); color:var(--ink); }
    main { max-width: 980px; margin: 24px auto; padding: 0 16px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    .meta { margin: 0 0 16px; color:#4b5563; }
    .card { background: var(--card); border:1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 14px; }
    .stats { margin: 0 0 10px; color:#374151; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    svg { width: 100%; height: 140px; background: #fbfdff; border:1px solid #eef2f7; border-radius: 8px; }
    table { width:100%; border-collapse: collapse; background: var(--card); border:1px solid var(--line); }
    th, td { text-align:left; border-bottom:1px solid var(--line); padding:8px; }
    th { background:#f9fafb; }
    .status-pass { color:#137333; }
    .status-fail { color:#b42318; font-weight:600; }
  </style>
</head>
<body>
  <main>
    <h1>Module Load Benchmark Report</h1>
    <p class="meta">input=${report.inputFile} baseline=${report.baselineFile || "none"} generatedAt=${report.generatedAt}</p>
    ${cards}
    <section class="card">
      <h2>Checks</h2>
      <p class="${report.checks.failed ? "status-fail" : "status-pass"}">status=${report.checks.failed ? "FAIL" : "PASS"}</p>
      <table>
        <thead><tr><th>level</th><th>target</th><th>rule</th><th>message</th></tr></thead>
        <tbody>${findingsRows}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inputFile = path.resolve(opts.input || latestTidyFile());
  const baselineFile = opts.baseline ? path.resolve(opts.baseline) : null;
  const outDir = path.resolve(opts.outDir);
  const reportName =
    opts.reportName ||
    `benchmark-report-${new Date().toISOString().replace(/[:]/g, "-")}`;

  const config = {
    p95RegressionPct: envNumber("REGRESSION_P95_PCT", 15),
    avgRegressionPct: envNumber("REGRESSION_AVG_PCT", 10),
    hardMaxMs: envNumber("HARD_MAX_MS", 300),
    outlierMultiplier: envNumber("OUTLIER_MULTIPLIER", 1.25),
  };

  const currentByTarget = readTidyCsv(inputFile);
  const currentSeries = collectMsSeries(currentByTarget);
  if (!currentSeries.length) {
    throw new Error(`No ms series found in ${inputFile}`);
  }

  let baselineByTarget = new Map();
  let baselineSeries = [];
  if (baselineFile) {
    baselineByTarget = readTidyCsv(baselineFile);
    baselineSeries = collectMsSeries(baselineByTarget);
  }

  const baselineSeriesByTarget = new Map(
    baselineSeries.map((s) => [s.target, s]),
  );
  const checks = runChecks(currentSeries, baselineSeriesByTarget, config);

  const report = {
    generatedAt: new Date().toISOString(),
    inputFile,
    baselineFile,
    config,
    series: currentSeries,
    checks,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${reportName}.json`);
  const htmlPath = path.join(outDir, `${reportName}.html`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(htmlPath, renderHtml(report));

  console.log(`REPORT_JSON ${jsonPath}`);
  console.log(`REPORT_HTML ${htmlPath}`);
  console.log(`STATUS ${checks.failed ? "FAIL" : "PASS"}`);
  for (const f of checks.findings) {
    console.log(
      `[${f.level.toUpperCase()}] ${f.target} ${f.rule}: ${f.message}`,
    );
  }

  if (checks.failed) {
    process.exitCode = 1;
  }
}

main();
