# Local picomatch security fork

`@shekelsync/picomatch@4.0.7-shekelsync.1` is a private, vendored security fork
of the npm `picomatch@4.0.7` artifact identified in `UPSTREAM.json`. It retains
the upstream MIT license and authorship. It is not an upstream patched release.

The only runtime source change is in `lib/parse.js`, addressing
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
At the time of this change, npm's latest release is 4.0.7 and the advisory
lists no patched version. The upstream discussion explicitly notes that
`+(*a)` remains vulnerable in the proposed
[leading-question-mark fix](https://github.com/micromatch/picomatch/pull/194).

Repeating a single branch containing glob or regular-expression syntax can
generate nested unbounded quantifiers. The fork uses the parser's existing
literal fallback for these branches, while retaining its known linear rewrite
for repeated literal-character sequences. The new guard cannot be disabled
by setting `maxExtglobRecursion: false`.

Compatibility: ordinary wildcards, globstars, braces, negated extglobs, literal
single-branch repeats such as `+(foo)`, and the upstream multi-branch handling
are unchanged. Complex single-branch repeats such as `+([ab])` also use the
conservative literal fallback, even where a particular expression is bounded.
This intentionally avoids an incomplete parser-level risk heuristic.

Both app and renderer override every `picomatch` dependency with this fork.
Their `install-links=true` setting installs ordinary package copies, so builds
do not depend on a symlink outside the installed application. The public
`picomatch` import path remains compatible with the upstream API.

`npm run test:dependency-security` checks the provenance and installed files,
exercises ordinary matching and module entry points, and runs malicious-pattern
regressions in child processes with hard timeouts. CI continues to run the
unmodified npm audit severity gates. A separate upstream-name advisory check
runs automatically when `CI=true` (or explicitly via
`npm run audit:picomatch-upstream`) and blocks any new high/critical advisory; it recognizes only the specific finding
remediated by this verified fork. Network or malformed-response failures block
that check as well.

Replace this fork with an official fixed release once one is available and
passes the same regressions. Do not remove these checks merely because the
dependency version or package name changes.
