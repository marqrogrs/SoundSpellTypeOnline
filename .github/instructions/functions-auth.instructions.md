---
name: Functions Auth and Role Safety
description: "Use when editing Firebase callable functions, auth checks, role resolution, username handling, or org-management behavior in functions/."
applyTo: "functions/**/*.js"
---

# Functions Auth and Role Safety

Use these rules when changing files under [functions/](functions/), especially auth, role, and callable code paths.

## Core Rules

- Keep callable behavior backward-compatible for legacy accounts.
- Do not rely on a single role source (claims-only or users/{uid}-only).
- Prefer lazy role inference and only call Admin Auth lookups when needed.
- Preserve username path safety for Realtime Database key segments.

## Required Checks

1. Role resolution:
- Keep fallback paths for users keyed by uid and by email.
- Preserve trusted Firestore-role fallback when claims are missing or stale.
- Trim role strings before alias matching to avoid misclassification.

2. Username/path safety:
- When a username can contain reserved path characters (for example `.`), encode before using it in Realtime Database path segments.

3. Callable authorization:
- Validate authenticated context and role permissions at the top of each callable.
- Return explicit and stable error codes/messages for denied access.

4. Function generation/runtime:
- Keep import style consistent with this repo's functions runtime patterns.

## Validation Before Finish

- Run function unit tests:

```bash
npm --prefix functions test
```

- If behavior changed significantly, run local emulator smoke checks:

```bash
npm --prefix functions run serve
```

## References

- [functions/README.md](functions/README.md)
- [docs/emulator-reset-password-checklist.md](docs/emulator-reset-password-checklist.md)
- [docs/org-management-implementation-plan.md](docs/org-management-implementation-plan.md)
