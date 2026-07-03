---
name: React Pages and Components
description: "Use when editing React pages or reusable components in src/pages or src/components, including UI behavior, state flow, and styling decisions."
applyTo: "src/{pages,components}/**/*.{js,jsx,css}"
---

# React Pages and Components

Use this guidance for changes in [src/pages/](src/pages/) and [src/components/](src/components/).

## Scope and Boundaries

- Keep page-level orchestration in [src/pages/](src/pages/).
- Keep reusable UI building blocks in [src/components/](src/components/).
- Avoid pushing page-specific behavior into shared components unless reuse is clear.

## Change Style

- Make the smallest safe change that matches nearby patterns.
- Preserve existing route/provider contracts unless the task explicitly requires contract changes.
- Prefer incremental refactors over broad rewrites.

## State and Data Flow

- Keep data fetching and role-aware gating close to page containers.
- Pass explicit props to components; avoid hidden coupling through globals.
- When behavior changes, update or add targeted tests near the affected feature.

## Styling and UX

- Reuse existing styles and component patterns before introducing new abstractions.
- Keep styles readable and local to feature intent; avoid one-off global CSS side effects.
- For motion work, use the [animation skill](../skills/animation/SKILL.md) and include reduced-motion handling.

## Validation Before Finish

- Run relevant tests:

```bash
npm test -- --watchAll=false --runInBand --silent
```

- Build when UI behavior, routing, or imports changed:

```bash
npm run build
```

## References

- [README.md](README.md)
- [src/routes/](src/routes/)
- [src/providers/](src/providers/)
- [src/styles/](src/styles/)
