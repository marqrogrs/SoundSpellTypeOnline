/**
 * roleUtils.js
 *
 * Pure (no Firebase) role normalization helpers.
 * Tested independently; consumed by orgManagement.js.
 */

const ROLE_RANK = {
  student: 0,
  parent: 1,
  tutor: 1,
  educator: 2,
  schoolAdmin: 3,
  admin: 4,
};

/**
 * Normalizes any role string / numeric value to the canonical internal role.
 * UI labels ("Teacher", "Home School Parent", etc.) are also accepted.
 *
 * @param {string|number} input
 * @returns {"student"|"parent"|"tutor"|"educator"|"schoolAdmin"|"admin"}
 */
function normalizeRole(input) {
  const raw = String(input || "").trim();
  const v = raw.toLowerCase().replace(/\s+/g, "");
  if (v === "4" || v === "admin") return "admin";
  if (v === "3" || v === "schooladmin" || v === "school_admin")
    return "schoolAdmin";
  if (v === "2" || v === "educator" || v === "teacher") return "educator";
  // "homeSchoolParent" and variants all map to parent
  if (
    v === "1" ||
    v === "parent" ||
    v === "homeschoolparent" ||
    v === "home_school_parent" ||
    v === "homeschool_parent"
  )
    return "parent";
  if (
    v === "tutor" ||
    v === "readingspecialist" ||
    v === "reading_specialist" ||
    v === "tutor/readingspecialist"
  )
    return "tutor";
  if (v === "0" || v === "student") return "student";
  // camelCase exact match guard (already handled above for lowercase, but kept
  // for safety with mixed-case inputs that didn't match the lowercase path)
  if (raw === "schoolAdmin") return "schoolAdmin";
  return "student";
}

/**
 * Returns the numeric rank for a role string.
 * Higher = more privileged.
 *
 * @param {string} role
 * @returns {number}
 */
function rankOf(role) {
  return ROLE_RANK[normalizeRole(role)] ?? 0;
}

/**
 * Returns true if callerRole has at least the privileges of requiredRole.
 *
 * @param {string} callerRole
 * @param {string} requiredRole
 * @returns {boolean}
 */
function hasRank(callerRole, requiredRole) {
  return rankOf(callerRole) >= rankOf(requiredRole);
}

/**
 * Builds the Firebase custom claims object for a given role.
 *
 * @param {string} role
 * @returns {object}
 */
function buildClaimsForRole(role) {
  return {
    role,
    admin: role === "admin",
    schoolAdmin: role === "schoolAdmin",
    parent: role === "parent",
    tutor: role === "tutor",
  };
}

module.exports = {
  ROLE_RANK,
  normalizeRole,
  rankOf,
  hasRank,
  buildClaimsForRole,
};
