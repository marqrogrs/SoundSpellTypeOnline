/**
 * roleUtils.test.js
 */

const assert = require("node:assert/strict");
const {
  normalizeRole,
  rankOf,
  hasRank,
  buildClaimsForRole,
  ROLE_RANK,
} = require("../roleUtils");

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

runCase("normalizes 'student' string", () => {
  assert.equal(normalizeRole("student"), "student");
});
runCase("normalizes 'educator' string", () => {
  assert.equal(normalizeRole("educator"), "educator");
});
runCase("normalizes 'parent' string", () => {
  assert.equal(normalizeRole("parent"), "parent");
});
runCase("normalizes 'tutor' string", () => {
  assert.equal(normalizeRole("tutor"), "tutor");
});
runCase("normalizes 'schoolAdmin' string", () => {
  assert.equal(normalizeRole("schoolAdmin"), "schoolAdmin");
});
runCase("normalizes 'admin' string", () => {
  assert.equal(normalizeRole("admin"), "admin");
});

runCase("normalizes 'teacher' to educator", () => {
  assert.equal(normalizeRole("teacher"), "educator");
});
runCase("normalizes 'Teacher' to educator", () => {
  assert.equal(normalizeRole("Teacher"), "educator");
});
runCase("normalizes 'homeSchoolParent' to parent", () => {
  assert.equal(normalizeRole("homeSchoolParent"), "parent");
});
runCase("normalizes 'home_school_parent' to parent", () => {
  assert.equal(normalizeRole("home_school_parent"), "parent");
});
runCase("normalizes 'homeschool_parent' to parent", () => {
  assert.equal(normalizeRole("homeschool_parent"), "parent");
});
runCase("normalizes 'homeschoolparent' to parent", () => {
  assert.equal(normalizeRole("homeschoolparent"), "parent");
});
runCase("normalizes 'reading_specialist' to tutor", () => {
  assert.equal(normalizeRole("reading_specialist"), "tutor");
});
runCase("normalizes 'Tutor / Reading Specialist' to tutor", () => {
  assert.equal(normalizeRole("Tutor / Reading Specialist"), "tutor");
});
runCase("normalizes 'tutor / readingspecialist' to tutor", () => {
  assert.equal(normalizeRole("tutor / readingspecialist"), "tutor");
});
runCase("normalizes 'school_admin' to schoolAdmin", () => {
  assert.equal(normalizeRole("school_admin"), "schoolAdmin");
});

runCase("normalizes numeric '0' to student", () => {
  assert.equal(normalizeRole("0"), "student");
});
runCase("normalizes numeric '1' to parent", () => {
  assert.equal(normalizeRole("1"), "parent");
});
runCase("normalizes numeric '2' to educator", () => {
  assert.equal(normalizeRole("2"), "educator");
});
runCase("normalizes numeric '3' to schoolAdmin", () => {
  assert.equal(normalizeRole("3"), "schoolAdmin");
});
runCase("normalizes numeric '4' to admin", () => {
  assert.equal(normalizeRole("4"), "admin");
});

runCase("unknown role falls back to student", () => {
  assert.equal(normalizeRole("unicorn"), "student");
});
runCase("empty falls back to student", () => {
  assert.equal(normalizeRole(""), "student");
});
runCase("null/undefined fall back to student", () => {
  assert.equal(normalizeRole(null), "student");
  assert.equal(normalizeRole(undefined), "student");
});

runCase(
  "rank ordering: student < parent < educator < schoolAdmin < admin",
  () => {
    assert.ok(rankOf("student") < rankOf("parent"));
    assert.ok(rankOf("parent") < rankOf("educator"));
    assert.ok(rankOf("educator") < rankOf("schoolAdmin"));
    assert.ok(rankOf("schoolAdmin") < rankOf("admin"));
  },
);
runCase("rankOf tutor equals parent", () => {
  assert.equal(rankOf("tutor"), rankOf("parent"));
});
runCase("rankOf teacher equals educator", () => {
  assert.equal(rankOf("teacher"), rankOf("educator"));
});

runCase("admin has rank for all roles", () => {
  for (const role of Object.keys(ROLE_RANK)) {
    assert.ok(hasRank("admin", role));
  }
});
runCase("student lacks parent+ ranks", () => {
  assert.ok(!hasRank("student", "parent"));
  assert.ok(!hasRank("student", "educator"));
  assert.ok(!hasRank("student", "schoolAdmin"));
  assert.ok(!hasRank("student", "admin"));
});
runCase("every role has rank for itself", () => {
  for (const role of Object.keys(ROLE_RANK)) {
    assert.ok(hasRank(role, role));
  }
});

runCase("admin claims are correct", () => {
  const claims = buildClaimsForRole("admin");
  assert.equal(claims.role, "admin");
  assert.equal(claims.admin, true);
  assert.equal(claims.schoolAdmin, false);
  assert.equal(claims.parent, false);
  assert.equal(claims.tutor, false);
});
runCase("parent claims are correct", () => {
  const claims = buildClaimsForRole("parent");
  assert.equal(claims.role, "parent");
  assert.equal(claims.parent, true);
  assert.equal(claims.tutor, false);
});
runCase("tutor claims are correct", () => {
  const claims = buildClaimsForRole("tutor");
  assert.equal(claims.role, "tutor");
  assert.equal(claims.parent, false);
  assert.equal(claims.tutor, true);
});

console.log("\nAll roleUtils tests passed.");
