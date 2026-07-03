---
name: firebase-safe-deploy
description: 'Safely deploy Firebase functions or hosting in this repo. Use for pre-deploy checks, correct script selection, and rollback-aware deploy decisions.'
argument-hint: 'What are you deploying: functions, hosting, or both?'
---

# Firebase Safe Deploy

Use this workflow to deploy with the repository-approved scripts and guardrails.

## When to Use

- You are about to deploy Firebase functions.
- You are about to deploy hosting.
- You need a repeatable pre-deploy checklist.

## Procedure

1. Confirm scope.
- Functions only
- Hosting only
- Both (run functions first, then hosting)

2. Run fast validation before deploy.

```bash
npm --prefix functions test
npm test -- --watchAll=false --runInBand --silent
npm run build
```

3. Choose the correct deploy path.

- Functions deploy:

```bash
npm run deploy:functions
```

- Hosting deploy:

```bash
npm run deploy:web-app
```

Do not replace these with raw firebase commands unless explicitly required.

4. If deploy fails, apply focused recovery.

- Functions module load or dependency corruption symptoms:

```bash
rm -rf functions/node_modules functions/package-lock.json
npm --prefix functions install
```

- Root dependency install conflicts:

```bash
rm -rf node_modules
npm install --legacy-peer-deps --ignore-scripts
```

5. Report deployment summary.

- What was deployed
- Commands executed
- Any failures and remediation taken
- Follow-up actions (if any)

## Guardrails

- Never deploy without at least the narrow tests for changed surface area.
- Prefer smallest safe deployment unit (functions vs hosting) for reduced blast radius.
- If role/auth logic changed in [functions/](functions/), call out risk and verification steps explicitly.

## References

- [README.md](README.md)
- [functions/README.md](functions/README.md)
- [docs/emulator-reset-password-checklist.md](docs/emulator-reset-password-checklist.md)
