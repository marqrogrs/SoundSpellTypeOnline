/**
 * userFormValidation.test.js
 *
 * Tests for the Phase 1 user-form validation changes:
 * - First name and last name are now required for all roles
 * - Email is required for non-student roles only
 * - Students no longer require a username (auto-generated server-side)
 * - Student email is optional (for account recovery)
 *
 * These tests exercise the validation rules directly using the same
 * conditions checked in Admin.js and Management.js handleSave().
 */

// ─── Inline validation helper (mirrors Admin.js / Management.js logic) ────────
//
// Rather than rendering the full dialogs (which require heavy Firebase mocking),
// we extract and test the pure validation predicate.  If the dialog logic
// ever moves to a shared validator we can replace this with an import.

function validateUserForm(form) {
  const errors = [];
  if (!String(form.firstName || "").trim())
    errors.push("First name is required.");
  if (!String(form.lastName || "").trim())
    errors.push("Last name is required.");
  const isStudent = form.role === "student";
  if (!isStudent && !String(form.email || "").trim())
    errors.push("Email is required.");
  const pw = String(form.password || "").trim();
  if (pw && pw.length < 6)
    errors.push("Password must be at least 6 characters.");
  return errors;
}

// ─── Test runner ──────────────────────────────────────────────────────────────

describe("userFormValidation — Phase 1 rules", () => {
  // ── Educators / Teachers ──────────────────────────────────────────────────
  describe("educator (teacher) role", () => {
    it("passes with first name, last name, and email", () => {
      expect(
        validateUserForm({
          role: "educator",
          firstName: "Jane",
          lastName: "Doe",
          email: "jane@school.edu",
        }),
      ).toHaveLength(0);
    });

    it("fails without first name", () => {
      const errors = validateUserForm({
        role: "educator",
        firstName: "",
        lastName: "Doe",
        email: "jane@school.edu",
      });
      expect(errors).toContain("First name is required.");
    });

    it("fails without last name", () => {
      const errors = validateUserForm({
        role: "educator",
        firstName: "Jane",
        lastName: "",
        email: "jane@school.edu",
      });
      expect(errors).toContain("Last name is required.");
    });

    it("fails without email", () => {
      const errors = validateUserForm({
        role: "educator",
        firstName: "Jane",
        lastName: "Doe",
        email: "",
      });
      expect(errors).toContain("Email is required.");
    });

    it("fails when password is set but too short", () => {
      const errors = validateUserForm({
        role: "educator",
        firstName: "Jane",
        lastName: "Doe",
        email: "j@s.edu",
        password: "abc",
      });
      expect(errors).toContain("Password must be at least 6 characters.");
    });

    it("passes when password meets minimum length", () => {
      expect(
        validateUserForm({
          role: "educator",
          firstName: "Jane",
          lastName: "Doe",
          email: "j@s.edu",
          password: "secret",
        }),
      ).toHaveLength(0);
    });
  });

  // ── Home School Parent ────────────────────────────────────────────────────
  describe("parent (home school parent) role", () => {
    it("passes with first name, last name, and email", () => {
      expect(
        validateUserForm({
          role: "parent",
          firstName: "Bob",
          lastName: "Jones",
          email: "bob@home.com",
        }),
      ).toHaveLength(0);
    });

    it("fails without email", () => {
      const errors = validateUserForm({
        role: "parent",
        firstName: "Bob",
        lastName: "Jones",
        email: "",
      });
      expect(errors).toContain("Email is required.");
    });
  });

  // ── School Admin ──────────────────────────────────────────────────────────
  describe("schoolAdmin role", () => {
    it("passes with required fields", () => {
      expect(
        validateUserForm({
          role: "schoolAdmin",
          firstName: "Admin",
          lastName: "User",
          email: "admin@school.edu",
        }),
      ).toHaveLength(0);
    });

    it("fails without email", () => {
      const errors = validateUserForm({
        role: "schoolAdmin",
        firstName: "Admin",
        lastName: "User",
        email: "",
      });
      expect(errors).toContain("Email is required.");
    });
  });

  // ── Students ──────────────────────────────────────────────────────────────
  describe("student role", () => {
    it("passes with only first and last name (no email required)", () => {
      expect(
        validateUserForm({
          role: "student",
          firstName: "Alice",
          lastName: "Smith",
          email: "",
        }),
      ).toHaveLength(0);
    });

    it("does NOT require email for students", () => {
      const errors = validateUserForm({
        role: "student",
        firstName: "Alice",
        lastName: "Smith",
        email: "",
      });
      expect(errors).not.toContain("Email is required.");
    });

    it("passes when optional email is provided", () => {
      expect(
        validateUserForm({
          role: "student",
          firstName: "Alice",
          lastName: "Smith",
          email: "alice@guardian.com",
        }),
      ).toHaveLength(0);
    });

    it("still requires first name for students", () => {
      const errors = validateUserForm({
        role: "student",
        firstName: "",
        lastName: "Smith",
        email: "",
      });
      expect(errors).toContain("First name is required.");
    });

    it("still requires last name for students", () => {
      const errors = validateUserForm({
        role: "student",
        firstName: "Alice",
        lastName: "",
        email: "",
      });
      expect(errors).toContain("Last name is required.");
    });

    it("does NOT require a username for students (auto-generated)", () => {
      // Under Phase 1 rules, username is not part of form validation — it is
      // generated server-side.  Verify no username-related error surfaces.
      const errors = validateUserForm({
        role: "student",
        firstName: "Alice",
        lastName: "Smith",
        username: "",
      });
      expect(errors.some((e) => /username/i.test(e))).toBe(false);
    });

    it("fails when a password is provided but is too short", () => {
      const errors = validateUserForm({
        role: "student",
        firstName: "Alice",
        lastName: "Smith",
        email: "",
        password: "12",
      });
      expect(errors).toContain("Password must be at least 6 characters.");
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("trims whitespace-only first name as missing", () => {
      const errors = validateUserForm({
        role: "educator",
        firstName: "   ",
        lastName: "Doe",
        email: "j@s.edu",
      });
      expect(errors).toContain("First name is required.");
    });

    it("trims whitespace-only last name as missing", () => {
      const errors = validateUserForm({
        role: "educator",
        firstName: "Jane",
        lastName: "   ",
        email: "j@s.edu",
      });
      expect(errors).toContain("Last name is required.");
    });

    it("allows blank password (unchanged password in edit mode)", () => {
      expect(
        validateUserForm({
          role: "educator",
          firstName: "Jane",
          lastName: "Doe",
          email: "j@s.edu",
          password: "",
        }),
      ).toHaveLength(0);
    });
  });
});
