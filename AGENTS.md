# AGENTS.md

Agent instructions for this repository. Keep changes minimal, targeted, and consistent with existing patterns.

## Project Layout

- Frontend app: [src/](src/)
- Firebase functions: [functions/](functions/)
- Operational docs: [docs/](docs/)
- Data and one-off data scripts: [data/](data/) and [data/scripts/](data/scripts/)

Default to editing [src/](src/) for product behavior and UI changes. Edit [functions/](functions/) only for backend/auth/data-access behavior.

## Environment

- Frontend/runtime tooling: Node 20.x (see [.nvmrc](.nvmrc))
- Functions runtime target: Node 22 (see [functions/package.json](functions/package.json))
- Install root deps with:

```bash
npm install --legacy-peer-deps --ignore-scripts
```

Use `--legacy-peer-deps` to satisfy this dependency tree. Use `--ignore-scripts` to avoid optional native builds not required for frontend work.

## Common Commands

Run from repo root unless noted.

- Frontend dev: `npm start`
- Frontend tests: `npm test -- --watchAll=false --runInBand --silent`
- Frontend build: `npm run build`
- Functions tests: `npm --prefix functions test`
- Functions emulator: `npm --prefix functions run serve`
- Functions deploy: `npm run deploy:functions`
- Hosting deploy flow: `npm run deploy:web-app`

Prefer these repo scripts over raw `firebase` commands.

## Change Boundaries

- Do not edit generated artifacts in [build/](build/).
- Treat scripts in [data/scripts/](data/scripts/) as historical/reference unless the task is explicitly data-migration work.
- Keep lockfiles machine-generated; do not hand-edit them.
- For Firebase function changes, add or update tests under [functions/tests/](functions/tests/) when behavior changes.

## High-Value References

- Project setup and workflow: [README.md](README.md)
- Functions-specific notes: [functions/README.md](functions/README.md)
- Emulator auth/reset-password checklist: [docs/emulator-reset-password-checklist.md](docs/emulator-reset-password-checklist.md)
- Org-management implementation context: [docs/org-management-implementation-plan.md](docs/org-management-implementation-plan.md)

## Agent Working Style

- Make smallest safe change first; avoid broad refactors unless requested.
- Validate with the narrowest relevant test/build command before finishing.
- Keep public APIs and file structure stable unless task requires otherwise.
- When unclear on auth/role behavior, inspect existing role utilities in [functions/roleUtils.js](functions/roleUtils.js) and related tests before changing logic.
