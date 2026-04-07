## Summary

Describe what changed and why.

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Test-only
- [ ] Documentation-only

## Validation

- [ ] `npm --prefix functions test`
- [ ] `npm test -- --watchAll=false --runInBand --silent`
- [ ] `npm run build`

Include key output or screenshots when relevant.

## Security Checklist (Required For Auth/Functions/Data Access Changes)

If this PR touches authentication, Cloud Functions, Firestore rules, or database access logic, all items below must be completed.

- [ ] Caller authentication is enforced where required.
- [ ] Authorization checks ensure access is limited to owned/allowed resources.
- [ ] Error codes are preserved (for example `permission-denied`, `not-found`) and not masked as generic internal errors.
- [ ] Sensitive values are not logged (passwords, hashes, tokens, secrets).
- [ ] Negative-path tests exist for denied access scenarios.

## Manual QA Notes

List any manual test steps and outcomes.

## Deployment / Rollback Notes

Document any rollout concerns and rollback steps if needed.
