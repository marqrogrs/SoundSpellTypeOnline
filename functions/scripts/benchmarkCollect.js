#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function parseArgs(argv) {
  const opts = {
    runs: 100,
    outDir: "benchmarks",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--runs") opts.runs = Number(argv[++i]);
    else if (a === "--out-dir") opts.outDir = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node scripts/benchmarkCollect.js [--runs 100] [--out-dir benchmarks]",
      );
      process.exit(0);
    }
  }

  if (!Number.isFinite(opts.runs) || opts.runs <= 0) {
    throw new Error("--runs must be a positive number");
  }

  return opts;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const pick = (p) => sorted[Math.floor((sorted.length - 1) * p)];
  return {
    runs: values.length,
    min: sorted[0],
    p50: pick(0.5),
    p90: pick(0.9),
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted[sorted.length - 1],
    avg: Number((sum / values.length).toFixed(2)),
  };
}

function percentile(sorted, p) {
  return sorted[Math.floor((sorted.length - 1) * p)];
}

function runBenchmark(target, runs) {
  const values = [];
  for (let i = 1; i <= runs; i++) {
    const code = `const t=Date.now(); require(${JSON.stringify(target)}); process.stdout.write(String(Date.now()-t));`;
    const r = spawnSync(process.execPath, ["-e", code], { encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(
        `Benchmark failed for ${target} run ${i}: ${r.stderr || "unknown error"}`,
      );
    }
    const ms = Number(r.stdout.trim());
    if (!Number.isFinite(ms)) {
      throw new Error(
        `Invalid benchmark value for ${target} run ${i}: ${r.stdout}`,
      );
    }
    values.push(ms);
  }
  return values;
}

function writeDerivedCsv(benchmarkPath, derivedPath) {
  const lines = fs.readFileSync(benchmarkPath, "utf8").split(/\r?\n/);
  const dataRows = [];
  for (const line of lines) {
    if (!line || line.startsWith("summary_") || line === "target,run,ms")
      continue;
    const parts = line.split(",");
    if (parts.length !== 3) continue;
    const [target, runStr, msStr] = parts;
    const run = Number(runStr);
    const ms = Number(msStr);
    if (!target || Number.isNaN(run) || Number.isNaN(ms)) continue;
    dataRows.push({ target, run, ms });
  }

  const byTarget = new Map();
  for (const row of dataRows) {
    if (!byTarget.has(row.target)) byTarget.set(row.target, []);
    byTarget.get(row.target).push(row);
  }
  for (const rows of byTarget.values()) rows.sort((a, b) => a.run - b.run);

  const out = [];
  out.push(
    [
      "target",
      "run",
      "ms",
      "rolling_avg_5",
      "rolling_avg_10",
      "rolling_avg_20",
      "rolling_min_20",
      "rolling_max_20",
      "cum_p50",
      "cum_p90",
      "cum_p95",
      "cum_p99",
      "cum_avg",
    ].join(","),
  );

  for (const [target, rows] of byTarget.entries()) {
    const vals = rows.map((r) => r.ms);
    for (let i = 0; i < rows.length; i++) {
      const run = rows[i].run;
      const ms = rows[i].ms;

      const w5 = vals.slice(Math.max(0, i - 4), i + 1);
      const w10 = vals.slice(Math.max(0, i - 9), i + 1);
      const w20 = vals.slice(Math.max(0, i - 19), i + 1);
      const cum = vals.slice(0, i + 1).sort((a, b) => a - b);
      const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

      out.push(
        [
          target,
          run,
          ms,
          avg(w5).toFixed(2),
          avg(w10).toFixed(2),
          avg(w20).toFixed(2),
          Math.min(...w20),
          Math.max(...w20),
          percentile(cum, 0.5),
          percentile(cum, 0.9),
          percentile(cum, 0.95),
          percentile(cum, 0.99),
          avg(vals.slice(0, i + 1)).toFixed(2),
        ].join(","),
      );
    }
  }

  out.push("");
  out.push("summary_target,runs,min,p50,p90,p95,p99,max,avg");
  for (const [target, rows] of byTarget.entries()) {
    const vals = rows.map((r) => r.ms).sort((a, b) => a - b);
    const sum = rows.reduce((a, r) => a + r.ms, 0);
    out.push(
      [
        target,
        rows.length,
        vals[0],
        percentile(vals, 0.5),
        percentile(vals, 0.9),
        percentile(vals, 0.95),
        percentile(vals, 0.99),
        vals[vals.length - 1],
        (sum / rows.length).toFixed(2),
      ].join(","),
    );
  }

  fs.writeFileSync(derivedPath, out.join("\n"));
}

function writeTidyCsv(derivedPath, tidyPath) {
  const lines = fs
    .readFileSync(derivedPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  const header = lines[0].split(",");
  const dataLines = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("summary_target")) break;
    dataLines.push(line);
  }

  const metricCols = header.filter((c) => c !== "target" && c !== "run");
  const out = ["target,run,metric,value"];

  for (const line of dataLines) {
    const parts = line.split(",");
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = parts[i];
    for (const metric of metricCols) {
      out.push(`${row.target},${row.run},${metric},${row[metric]}`);
    }
  }

  fs.writeFileSync(tidyPath, out.join("\n"));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:]/g, "-");
  const benchmarkPath = path.join(outDir, `module-load-benchmark-${stamp}.csv`);
  const derivedPath = path.join(outDir, `module-load-derived-${stamp}.csv`);
  const tidyPath = path.join(outDir, `module-load-tidy-${stamp}.csv`);

  const targets = ["./index.js", "@google-cloud/firestore"];
  const benchmarkRows = ["target,run,ms"];
  const summaries = [];

  for (const target of targets) {
    const values = runBenchmark(target, opts.runs);
    values.forEach((ms, i) => benchmarkRows.push(`${target},${i + 1},${ms}`));
    summaries.push({ target, ...stats(values) });
  }

  benchmarkRows.push("");
  benchmarkRows.push("summary_target,runs,min,p50,p90,p95,p99,max,avg");
  summaries.forEach((s) => {
    benchmarkRows.push(
      `${s.target},${s.runs},${s.min},${s.p50},${s.p90},${s.p95},${s.p99},${s.max},${s.avg}`,
    );
  });
  fs.writeFileSync(benchmarkPath, benchmarkRows.join("\n"));

  writeDerivedCsv(benchmarkPath, derivedPath);
  writeTidyCsv(derivedPath, tidyPath);

  console.log(`BENCHMARK_FILE ${benchmarkPath}`);
  console.log(`DERIVED_FILE ${derivedPath}`);
  console.log(`TIDY_FILE ${tidyPath}`);
}

main();
