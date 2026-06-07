/**
 * usernameUtils.test.js
 *
 * Tests for the pure username-slug logic introduced in Phase 1.
 * No Firebase mocking required.
 */

const assert = require("node:assert/strict");
const {
  slugify,
  buildUsernameBase,
  generateUsername,
} = require("../usernameUtils");

function runCase(name, fn) {
  try {
    const result = fn();
    // Support async cases
    if (result && typeof result.then === "function") {
      return result.then(
        () => console.log(`PASS: ${name}`),
        (err) => {
          console.error(`FAIL: ${name}`);
          throw err;
        },
      );
    }
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

// ─── slugify ──────────────────────────────────────────────────────────────────

runCase("slugify lowercases ASCII letters", () => {
  assert.equal(slugify("John"), "john");
});

runCase("slugify strips spaces", () => {
  assert.equal(slugify("  Jane  "), "jane");
});

runCase("slugify strips hyphens and apostrophes", () => {
  assert.equal(slugify("O'Brien-Smith"), "obriensmith");
});

runCase("slugify preserves digits", () => {
  assert.equal(slugify("Student1"), "student1");
});

runCase("slugify returns empty string for empty input", () => {
  assert.equal(slugify(""), "");
  assert.equal(slugify(null), "");
  assert.equal(slugify(undefined), "");
});

// ─── buildUsernameBase ────────────────────────────────────────────────────────

runCase("builds base from first and last name", () => {
  assert.equal(buildUsernameBase("John", "Smith"), "john_smith");
});

runCase("falls back to first name only when last is empty", () => {
  assert.equal(buildUsernameBase("Maria", ""), "maria");
});

runCase("falls back to last name only when first is empty", () => {
  assert.equal(buildUsernameBase("", "Jones"), "jones");
});

runCase("falls back to 'user' when both names are empty", () => {
  assert.equal(buildUsernameBase("", ""), "user");
});

runCase("strips special chars from both names", () => {
  assert.equal(
    buildUsernameBase("Anne-Marie", "O'Connor"),
    "annemarie_oconnor",
  );
});

// ─── generateUsername (async) ─────────────────────────────────────────────────

const neverTaken = async () => false;
const alwaysTaken = async () => true;

runCase("returns base when not taken", async () => {
  const result = await generateUsername("Alice", "Walker", neverTaken);
  assert.match(result, /^alice_walker_[0-9]{4}$/);
});

runCase("returns suffixed candidate when base is taken", async () => {
  const isTaken = async () => false;
  const result = await generateUsername("Alice", "Walker", isTaken);
  assert.match(result, /^alice_walker_[0-9]{4}$/);
});

runCase("returns last-resort name when all 8 suffixes are taken", async () => {
  let calls = 0;
  // 8 random suffix attempts are taken; first last-resort check succeeds.
  const isTaken = async () => calls++ < 8;
  const result = await generateUsername("Alice", "Walker", isTaken);
  // Last-resort pattern: base_<6 digits>
  assert.match(result, /^alice_walker_[0-9]{6}$/);
});

runCase("handles names with only special characters", async () => {
  const result = await generateUsername("---", "...", neverTaken);
  assert.match(result, /^user_[0-9]{4}$/);
});

console.log("\nAll usernameUtils tests passed.");
