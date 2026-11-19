# Community updates and wiki maintenance

## Automatic Discussion posts

- **Merged PR → Show and tell:** `.github/workflows/community-showcase.yml` runs when a PR into `main` closes with `merged: true`. It checks out the merge commit, builds the renderer, and captures Home, Plan, and Wealth with Playwright. APIs are mocked and external network requests are blocked in the browser. The optional **Community update** PR section supplies the post text; otherwise it uses **Summary**.
- **Published version → Announcements:** the package workflow calls `.github/workflows/community-release.yml` after release finalization. The workflow also handles `release: published` for releases published outside Actions and offers a manual tag input. Draft/unpublished releases and commits outside `main` are skipped. Prereleases are labeled.

GitHub does not start new workflows for release events emitted using `GITHUB_TOKEN`, so the explicit call from the package workflow is necessary. See [GitHub's token documentation](https://docs.github.com/en/actions/concepts/security/github_token).

The existing `show-and-tell` and `announcements` Discussion categories must remain enabled. No new repository secrets or third-party services are needed. The screenshot job has read-only access; a separate publisher job has `contents: write` and `discussions: write`. Release announcements only require `contents: read` and `discussions: write`.

The showcase uses `pull_request_target: closed` so it can publish after fork PRs merge as well. The screenshot job only runs when `merged: true` and checks out `merge_commit_sha`, never the unmerged PR head. Keep this guard and the separation between capture and publishing permissions.

Screenshots are stored on an automation-owned orphan branch named `community-assets`. Each image path includes its PR number and merge SHA. Keep this branch to preserve images in older posts. The temporary Actions artifact expires after seven days; Discussion images do not depend on that artifact.

Posts contain hidden PR/release identifiers. Rerunning a completed workflow finds the original post across all category pages and updates it, preserving the discussion and replies.

## Verify and recover

```bash
npm run test:community
npm --prefix renderer run build
npm --prefix renderer run screenshots:community
```

Preview images are written to `renderer/community-screenshots/` (ignored by Git). The capture command calls Playwright directly so missing browsers fail the command. Install Chromium first if needed:

```bash
npm --prefix renderer exec -- playwright install --with-deps chromium
```

To recover a failed showcase, rerun its workflow from Actions. To announce or refresh an existing published release, run **Release announcement** manually with its tag. Publication failures are visible in Actions and can be retried without rebuilding a release; the already published release remains available.

## Publish wiki changes

`docs/wiki/` holds the wiki sources, including navigation and the legacy community-guide link. GitHub stores the live wiki in a separate Git repository, so merging these files alone does not update it.

After reviewing the changes, clone the wiki into a separate directory, copy the Markdown files, inspect the diff, then commit and push:

```bash
git clone git@github.com:AvnerAdda/shekelsync.wiki.git /tmp/shekelsync-wiki
cp docs/wiki/*.md /tmp/shekelsync-wiki/
git -C /tmp/shekelsync-wiki diff
git -C /tmp/shekelsync-wiki add -- '*.md'
git -C /tmp/shekelsync-wiki commit -m "Update ShekelSync community wiki"
git -C /tmp/shekelsync-wiki push origin HEAD
```
