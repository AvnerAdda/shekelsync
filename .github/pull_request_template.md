## Summary

Describe what changed and why.

## Community update

<!-- Optional: write a short user-facing explanation for the automatic Show and tell
post after merge. If blank, the post uses Summary. Home, Plan, and Wealth demo
screenshots are captured automatically from the merged version. -->

## Scope

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Docs only
- [ ] Security-related

## Validation Checklist (Required)

- [ ] `npm --prefix app run lint` passes
- [ ] `npm --prefix app run typecheck` passes
- [ ] `npm run test:ci` passes
- [ ] Coverage thresholds pass (lines >= 82%, statements >= 82%, functions >= 80%, branches >= 70%)
- [ ] No secrets were introduced (`npm run secrets:scan` or CI `gitleaks`)
- [ ] Docs/readme updated if behavior or workflows changed

## Risk Review

- [ ] No breaking change
- [ ] Breaking change explained below
- [ ] Rollback plan is clear

## Data / Config Impact

- [ ] No DB/config changes
- [ ] DB/config changes explained below (including migration/rollback)

## UI Changes

- [ ] No UI changes
- [ ] UI changes included screenshots/video

## Linked Issue

Add issue/ticket links, if relevant.
