const fs = require("fs");
const path = require("path");

const buildJsDir = path.resolve(__dirname, "../build/static/js");

function findMapFiles() {
  if (!fs.existsSync(buildJsDir)) {
    throw new Error(
      `Missing build output at ${buildJsDir}. Run a build first.`,
    );
  }

  return fs
    .readdirSync(buildJsDir)
    .filter((file) => file.endsWith(".js.map"))
    .sort((left, right) => left.localeCompare(right));
}

function toPackageName(sourcePath) {
  const match = sourcePath.match(/node_modules\/(.*?)(?:\/|$)/);
  if (!match) {
    return null;
  }

  if (!match[1].startsWith("@")) {
    return match[1];
  }

  const scopedMatch = sourcePath.match(/node_modules\/(.*?\/.*?)(?:\/|$)/);
  return scopedMatch ? scopedMatch[1] : match[1];
}

function summarizeMap(mapFile) {
  const mapPath = path.join(buildJsDir, mapFile);
  const parsed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const packageCounts = new Map();
  let appSourceCount = 0;
  let firebaseSourceCount = 0;

  for (const sourcePath of parsed.sources || []) {
    if (sourcePath.includes("../src/")) {
      appSourceCount += 1;
    }

    if (
      sourcePath.includes("node_modules/firebase") ||
      sourcePath.includes("node_modules/@firebase") ||
      sourcePath.includes("firebase/compat")
    ) {
      firebaseSourceCount += 1;
    }

    const packageName = toPackageName(sourcePath);
    if (!packageName) {
      continue;
    }

    packageCounts.set(packageName, (packageCounts.get(packageName) || 0) + 1);
  }

  return {
    mapFile,
    appSourceCount,
    firebaseSourceCount,
    topPackages: [...packageCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 15),
  };
}

function printSummary(summary) {
  console.log(`\n${summary.mapFile}`);
  console.log(`  app sources: ${summary.appSourceCount}`);
  console.log(`  firebase-related sources: ${summary.firebaseSourceCount}`);
  console.log("  top package families:");
  for (const [packageName, count] of summary.topPackages) {
    console.log(`    ${String(count).padStart(4, " ")}  ${packageName}`);
  }
}

try {
  const mapFiles = findMapFiles();
  if (mapFiles.length === 0) {
    throw new Error(
      "No .js.map files found in build/static/js. Build with sourcemaps enabled.",
    );
  }

  console.log("Bundle source-map summary");
  for (const mapFile of mapFiles) {
    printSummary(summarizeMap(mapFile));
  }
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
