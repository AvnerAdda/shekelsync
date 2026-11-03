# GitHub security alert cleanup

Reviewed against main commit `65b0c12` on 2026-11-03. The API listens on localhost
and applies authentication and shared rate limiting before mounting routers.

## Changes in this branch

| Alerts | Resolution |
| --- | --- |
| CodeQL #18, #19 | Build public error responses from allowlisted validation codes and fixed messages. Internal messages, nested details, stacks and arbitrary error properties are excluded. Unknown structured errors return HTTP 500. Pattern routes also stop returning stacks and internal server-error messages. |
| CodeQL #32 | Bound diagnostic filename components to 100 characters, then trim hyphens with linear scans. |
| CodeQL #15 | Use a constant logging message and separate account/vendor arguments, including when the CLI uses console logging. |
| CodeQL #28 | Apply a dedicated 120-request/minute webhook limiter before signature verification. One bounded bucket covers all callers, independently of API tokens and forwarding headers. Valid signatures are still required. |
| CodeQL #33, #34, #36–#41, #45, #46 | Set top-level `permissions: contents: read` in both flagged workflows. |
| Dependabot #120, #121 | Update minimatch 10.2.5 to compatible 10.2.6 and backport the upstream preprocessing guards to all installed 9.x/10.x copies, in CJS and ESM builds. Keep older callers' APIs intact. |

## Dependency backport

The upstream fix is [commit 77a0f5c](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8)
for [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
Minimatch 11 removes APIs used by existing build tools, including `makeRe()` and
RegExp-backed pattern sets. A global major-version override would break those
callers. Version-specific patch-package patches retain the supported interfaces.

Postinstall patches cap generated glob parts and skip optional pairwise
deduplication for large sets. `npm run test:dependency-security` verifies the
attack pattern, normal matching, legacy RegExp API, nested copies, and both CJS
and ESM. The dependency-audit workflow also runs this verification after clean
installation. Existing 3.x/5.x copies do not have the vulnerable preprocessing
method; the verifier checks that assumption.

All current minimatch copies are development dependencies. GitHub/npm only see
package versions, so the backport does not automatically clear the two advisory
alerts. Keep them open until the branch is merged and the clean-install checks
are green, then record the backport evidence when closing them. Remove these
patches when upstream callers support a fixed version without compatibility
overrides. Never suppress all future minimatch advisories by package name.

## False-positive dismissal rationale

These reasons apply to the existing main branch and do not depend on merging
the fixes above. Use them for the 12 dismissals after regression checks pass.
Alerts that depend on this branch's fixes remain open until merge.

| CodeQL alert | Evidence / dismissal reason |
| --- | --- |
| #13 | The balance-sync credential vendor is overwritten with the validated `options.companyId`; supported vendor identifiers contain no format specifiers. |
| #14 | The interpolated company identifier passes the company-type validation before scraping; the normal logger also treats message arguments as text. |
| #20 | POST `/api/analytics/quests/:id/verify` passes shared token authentication and the 200/minute token/path limiter. |
| #21 | POST `/api/credentials` passes the shared 30/minute token/path limiter. |
| #22 | PUT `/api/credentials` passes the shared 30/minute token/path limiter. |
| #23 | PUT `/api/credentials/:id` passes the shared 30/minute token/path limiter. |
| #24 | PATCH `/api/credentials` passes the shared 30/minute token/path limiter. |
| #25 | PATCH `/api/credentials/:id` passes the shared 30/minute token/path limiter. |
| #26 | DELETE `/api/credentials` passes the shared 30/minute token/path limiter. |
| #27 | DELETE `/api/credentials/:id` passes the shared 30/minute token/path limiter. |
| #29 | POST `/api/donations/entitlement` passes shared token authentication and the 200/minute token/path limiter before its sync-secret check. |
| #31 | User-supplied regex syntax is intentional. `validateRegex` only constructs and discards a RegExp to validate syntax; no production matching consumer of the stored patterns was found. Revisit before adding one. |

The API-security regression tests exercise all nine protected routes through
authentication and rate limiting, including the rejected request immediately
after each allowance is exhausted. Keep those tests when dismissing alerts.

## Validation

Run the route/security regression tests, dependency verification, app/renderer
lint and typecheck, app coverage and renderer unit suites. Review the PR's CodeQL
and Security Audit runs before merging. Version-based dependency warnings can
remain visible despite the verified backport; passing audit policy is not a
claim of zero advisory entries.
