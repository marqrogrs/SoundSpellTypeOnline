/**
 * usernameUtils.js
 *
 * Pure (no Firebase) helpers for username slug generation.
 * Tested independently; consumed by index.js and orgManagement.js.
 */

/**
 * Converts a first / last name string into a URL/RTDB-safe slug.
 * Lowercases and strips anything that isn't a letter or digit.
 *
 * @param {string} s
 * @returns {string}
 */
function slugify(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Returns the base username slug for a given first and last name.
 * Pattern: "firstname_lastname".
 * Falls back to just first, just last, or "user" if both are empty.
 *
 * @param {string} firstName
 * @param {string} lastName
 * @returns {string}
 */
function buildUsernameBase(firstName, lastName) {
  const first = slugify(firstName);
  const last = slugify(lastName);
  if (first && last) return `${first}_${last}`;
  return first || last || "user";
}

/**
 * Generates a candidate username by appending a 4-digit numeric suffix to the
 * base slug. Uses Math.random so callers can retry on collision.
 *
 * @param {string} base  Result of buildUsernameBase()
 * @returns {string}
 */
function buildUsernameWithSuffix(base) {
  const suffix = String(Math.floor(1000 + Math.random() * 9000));
  return `${base}_${suffix}`;
}

/**
 * Last-resort username derived from a timestamp (6 trailing digits).
 * Practically unique; used only after 8 random-suffix attempts fail.
 *
 * @param {string} base
 * @returns {string}
 */
function buildUsernameLastResort(base) {
  return `${base}_${Date.now().toString().slice(-6)}`;
}

/**
 * Generates a unique username using the provided async `isTaken` predicate.
 *
 * @param {string} firstName
 * @param {string} lastName
 * @param {(name: string) => Promise<boolean>} isTaken
 * @returns {Promise<string>}
 */
async function generateUsername(firstName, lastName, isTaken) {
  const base = buildUsernameBase(firstName, lastName);
  for (let i = 0; i < 8; i++) {
    const candidate = buildUsernameWithSuffix(base);
    if (!(await isTaken(candidate))) return candidate;
  }
  for (let i = 0; i < 3; i++) {
    const lastResort = buildUsernameLastResort(base);
    if (!(await isTaken(lastResort))) return lastResort;
  }
  throw new Error("Unable to generate a unique username.");
}

module.exports = {
  slugify,
  buildUsernameBase,
  buildUsernameWithSuffix,
  buildUsernameLastResort,
  generateUsername,
};
