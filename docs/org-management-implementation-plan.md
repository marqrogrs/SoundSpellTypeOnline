# Org Management And Access Plan (May 2026)

## Confirmed Product Decisions

1. Educator belongs to exactly one school.
2. School Admin belongs to exactly one school.
3. Student can belong to multiple classes.
4. School Admin can both create and assign users for their own school.
5. Classes can be temporarily unassigned from an educator.
6. Existing data migration can map from classroom first, with school temporarily unset.
7. Merge Students page and Admin page now into a single management page.
8. School and class names may be free text, but each record must also have a unique stable ID.
9. Add Parent role:
   - Parent can create and manage student users for their own household only.
   - Parent does not get school admin capabilities.
   - Parent operates in virtual scope: school = Home, class = Parent.
   - Parent does not create separate classes.
10. Home school strategy is finalized: one Home school per parent user (isolated household scope).

## Core Goals

- Unify people, schools, and class management in one role-aware page.
- Enforce permissions in backend functions first, not UI-only checks.
- Preserve legacy flows long enough for safe migration and rollback.
- Avoid data loss and avoid role escalation bugs.

## Roles And Permission Matrix

### admin (top-level)

- Manage all users (admin, schoolAdmin, educator, parent, student).
- Create, edit, archive schools.
- Create, edit, archive classes in any school.
- Assign school admins to schools.
- Assign educators and students across schools.

### schoolAdmin (one school)

- Manage educator, parent, and student users in own school only.
- Create/edit classes in own school.
- Assign educator to class in own school.
- Assign students to classes in own school.
- Cannot manage admin users.
- Cannot modify any records outside own school.

### educator (one school)

- View classes assigned to educator.
- Manage student roster in assigned classes.
- Cannot create schools.
- Cannot assign users outside own classes.

### parent (virtual home scope)

- Create and manage own student accounts only.
- No access to school admin area.
- Implicit virtual school/class:
  - schoolType = home
  - schoolName = Home
  - className = Parent
- Parent cannot create additional classes.

### student

- No org management actions.

## Data Model (New Canonical Shape)

## schools collection

- id: stable unique ID (generated)
- name: free text
- normalizedName: lowercase trimmed for search
- type: regular | home
- isActive: boolean
- createdAt, updatedAt
- createdBy

Notes:

- Home schools are virtual and system-controlled for parent role.
- No schoolAdmin assignment to home schools.

## classes collection

- id: stable unique ID (generated)
- name: free text
- normalizedName
- schoolId
- schoolType: regular | home
- educatorId: nullable (supports temporary unassigned)
- educatorName: cached optional
- studentIds: array
- isActive: boolean
- createdAt, updatedAt
- createdBy

Notes:

- For parent role, class is fixed as Parent under home school.
- Parent class should be auto-created if missing.

## users collection additions

- role: admin | schoolAdmin | educator | parent | student
- schoolId: nullable for migration period
- classIds: array for students (new canonical)
- legacy fields preserved temporarily:
  - educator
  - classroom

## Parent ownership fields (for strict scope)

- parentOwnerId on student records created by parent.
- schoolId points to parent home school.
- classIds includes parent home class.

## API / Callable Function Changes

Build new callables (v2) and keep existing ones during migration:

- adminListManagementData
  - Returns role-scoped payload:
    - schools
    - classes
    - users
    - assignment options

- adminCreateSchool
- adminUpdateSchool
- adminArchiveSchool

- adminCreateClass
- adminUpdateClass
- adminArchiveClass
- adminAssignClassEducator

- adminCreateOrUpdateUser
  - Supports role parent
  - Supports school assignment
  - Supports multi-class assignment for students
  - Enforces role and school boundaries

- adminAssignStudentClasses
  - Replace class list atomically

- parentCreateStudent
  - Convenience callable with strict parent scope

Security requirement:

- Every callable validates caller role and allowed school IDs.
- Never trust schoolId/classIds sent by client without re-check.

## Firestore Rules Changes

- Add helper checks for role and school ownership.
- schools and classes writes restricted by role and scope.
- users role-sensitive field mutations restricted.
- Parent can only read/write own household-scoped student docs.
- Keep legacy paths readable during migration.

## UI Merge Plan (Now)

Create one page replacing current split behavior:

- Route target remains /admin for admin and schoolAdmin.
- Expand access to educator and parent with role-scoped view.
- Rename visual title to Management.

Sections (shown based on role):

1. Users

- Create/edit users with role-aware form controls.
- Student form includes:
  - school selector (hidden/fixed for parent)
  - educator selector (optional)
  - multi-class selector

2. Schools

- admin only full controls
- schoolAdmin limited to own school profile view/edit name rules if desired
- hidden for educator and parent

3. Classes

- admin and schoolAdmin can create/edit (within scope)
- educator can manage roster in assigned classes
- parent sees only fixed Parent class for household students

4. Assignments

- assign schoolAdmin to school (admin only)
- assign educator to class
- assign students to multiple classes

## Migration Plan

Phase 0: Prepare

- Add new collections and indexes.
- Add v2 callables and new rule paths.
- Add dual-write in backend where needed.

Phase 1: Backfill

- For each existing class under educatorClasses and users/{uid}/classes:
  - create canonical class with generated id
  - infer schoolId as null (temporary) unless mappable
- For each student:
  - move classroom to classIds array
  - keep legacy fields for compatibility
- For parent users (new):
  - create/find home school and parent class per parent

Phase 2: UI switch

- Replace separate Students and Admin experiences with merged page.
- Keep old callable fallbacks behind feature flag until stable.

Phase 3: Cleanup

- Remove legacy educator/classroom dependencies.
- Remove old callables after verification.

## Safe Rollout Controls

- Add feature flag: managementV2Enabled.
- Add audit logs for school/class/user assignment changes.
- Add dry-run migration script and report output before writes.
- Add rollback script for migrated fields (classIds back to classroom where possible).

## Testing Requirements

1. Permission tests (critical)

- schoolAdmin cannot edit out-of-school records.
- parent cannot access non-household students.
- educator cannot edit school-level config.
- admin can perform all actions.

2. Data integrity tests

- student multi-class assignments persist and update correctly.
- class educator can be null and later reassigned.
- parent students always linked to home school + parent class.

3. UI tests

- merged page shows only allowed controls per role.
- role-switching scenarios do not leak stale data.

## Open Technical Decisions To Finalize Before Coding

2. Student login naming:

- keep current username-based student auth unchanged or move to uid-backed auth later

3. Soft delete vs hard delete:

- archive schools/classes recommended instead of hard delete

## Recommended Start Order

1. Add backend v2 callables and permission guards.
2. Add new rules and tests.
3. Add schema migration scripts with dry-run.
4. Build merged Management page using new APIs.
5. Enable feature flag for internal testing.
6. Roll out and remove legacy flows.
