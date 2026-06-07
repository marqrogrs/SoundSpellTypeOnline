const { normalizeRole } = require("./roleUtils");

const VALID_REQUEST_STATUSES = ["pending", "approved", "denied", "cancelled"];

function resolveRequesterRole({ callerRole, callerDocRole }) {
  const normalizedDocRole = normalizeRole(callerDocRole);
  if (normalizedDocRole !== "student") {
    return normalizedDocRole;
  }
  return normalizeRole(callerRole);
}

function canRequestSchoolAdminAccess(role) {
  const normalized = normalizeRole(role);
  return normalized !== "admin" && normalized !== "schoolAdmin";
}

function isPendingSchoolAdminRequest(existingRequest) {
  return String(existingRequest?.status || "") === "pending";
}

function canManageSchoolAdminRequests(role) {
  return normalizeRole(role) === "admin";
}

function normalizeSchoolAdminRequestListArgs(data) {
  const statusFilter = String(data?.status || "pending")
    .trim()
    .toLowerCase();
  const limit = Math.min(Math.max(Number(data?.limit || 100), 1), 300);
  return {
    statusFilter,
    isValidStatusFilter: VALID_REQUEST_STATUSES.includes(statusFilter),
    limit,
  };
}

function parseSchoolAdminReviewInput(data) {
  const requestId = String(data?.requestId || "").trim();
  const decision = String(data?.decision || "")
    .trim()
    .toLowerCase();
  const decisionNote = String(data?.decisionNote || "").trim();
  const forcedSchoolId = String(data?.schoolId || "").trim();

  return {
    requestId,
    decision,
    decisionNote,
    forcedSchoolId,
    isValid:
      Boolean(requestId) && (decision === "approve" || decision === "deny"),
  };
}

module.exports = {
  VALID_REQUEST_STATUSES,
  resolveRequesterRole,
  canRequestSchoolAdminAccess,
  isPendingSchoolAdminRequest,
  canManageSchoolAdminRequests,
  normalizeSchoolAdminRequestListArgs,
  parseSchoolAdminReviewInput,
};
