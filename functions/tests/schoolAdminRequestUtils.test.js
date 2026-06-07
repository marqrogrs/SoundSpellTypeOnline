const assert = require("node:assert/strict");

const {
  resolveRequesterRole,
  canRequestSchoolAdminAccess,
  isPendingSchoolAdminRequest,
  canManageSchoolAdminRequests,
  normalizeSchoolAdminRequestListArgs,
  parseSchoolAdminReviewInput,
} = require("../schoolAdminRequestUtils");

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

runCase("request role resolves to caller doc role when non-student", () => {
  assert.equal(
    resolveRequesterRole({ callerRole: "student", callerDocRole: "parent" }),
    "parent",
  );
  assert.equal(
    resolveRequesterRole({
      callerRole: "educator",
      callerDocRole: "reading_specialist",
    }),
    "tutor",
  );
});

runCase(
  "request role falls back to caller role when doc role is student",
  () => {
    assert.equal(
      resolveRequesterRole({ callerRole: "teacher", callerDocRole: "student" }),
      "educator",
    );
  },
);

runCase("school admin request permissions deny admin-level accounts", () => {
  assert.equal(canRequestSchoolAdminAccess("admin"), false);
  assert.equal(canRequestSchoolAdminAccess("schoolAdmin"), false);
  assert.equal(canRequestSchoolAdminAccess("school_admin"), false);
});

runCase("school admin request permissions allow non-admin roles", () => {
  assert.equal(canRequestSchoolAdminAccess("educator"), true);
  assert.equal(canRequestSchoolAdminAccess("parent"), true);
  assert.equal(canRequestSchoolAdminAccess("tutor"), true);
  assert.equal(canRequestSchoolAdminAccess("student"), true);
});

runCase("pending request detection supports idempotency", () => {
  assert.equal(isPendingSchoolAdminRequest({ status: "pending" }), true);
  assert.equal(isPendingSchoolAdminRequest({ status: "approved" }), false);
  assert.equal(isPendingSchoolAdminRequest(null), false);
});

runCase("manage requests permission is top-level admin only", () => {
  assert.equal(canManageSchoolAdminRequests("admin"), true);
  assert.equal(canManageSchoolAdminRequests("schoolAdmin"), false);
  assert.equal(canManageSchoolAdminRequests("educator"), false);
});

runCase("list args normalize valid status and clamp limit", () => {
  const args = normalizeSchoolAdminRequestListArgs({
    status: " approved ",
    limit: 9999,
  });
  assert.equal(args.statusFilter, "approved");
  assert.equal(args.isValidStatusFilter, true);
  assert.equal(args.limit, 300);
});

runCase("list args default to pending and minimum limit", () => {
  const args = normalizeSchoolAdminRequestListArgs({
    status: "",
    limit: -100,
  });
  assert.equal(args.statusFilter, "pending");
  assert.equal(args.isValidStatusFilter, true);
  assert.equal(args.limit, 1);
});

runCase("list args do not whitelist unknown status", () => {
  const args = normalizeSchoolAdminRequestListArgs({
    status: "in-progress",
    limit: 25,
  });
  assert.equal(args.statusFilter, "in-progress");
  assert.equal(args.isValidStatusFilter, false);
  assert.equal(args.limit, 25);
});

runCase("review input parses approve decision", () => {
  const parsed = parseSchoolAdminReviewInput({
    requestId: " user-1 ",
    decision: " APPROVE ",
    decisionNote: " note ",
    schoolId: " school-1 ",
  });
  assert.equal(parsed.requestId, "user-1");
  assert.equal(parsed.decision, "approve");
  assert.equal(parsed.decisionNote, "note");
  assert.equal(parsed.forcedSchoolId, "school-1");
  assert.equal(parsed.isValid, true);
});

runCase("review input parses deny decision", () => {
  const parsed = parseSchoolAdminReviewInput({
    requestId: "user-2",
    decision: "deny",
  });
  assert.equal(parsed.requestId, "user-2");
  assert.equal(parsed.decision, "deny");
  assert.equal(parsed.isValid, true);
});

runCase("review input invalid when requestId missing", () => {
  const parsed = parseSchoolAdminReviewInput({
    decision: "approve",
  });
  assert.equal(parsed.requestId, "");
  assert.equal(parsed.isValid, false);
});

runCase("review input invalid when decision is unsupported", () => {
  const parsed = parseSchoolAdminReviewInput({
    requestId: "user-3",
    decision: "later",
  });
  assert.equal(parsed.decision, "later");
  assert.equal(parsed.isValid, false);
});

console.log("\nAll schoolAdminRequestUtils tests passed.");
