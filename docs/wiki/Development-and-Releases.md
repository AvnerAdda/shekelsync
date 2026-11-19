# Development and releases

## Run the project

ShekelSync uses Electron, a React/Vite renderer, a local API, and SQLite.

Use Node.js 22.22.2+ on 22.x, 24.15.0+ on 24.x, or 26+. The repository's `.nvmrc` selects its development version.

```bash
npm install
npm --prefix app install
npm --prefix renderer install
npm run dev:electron
```

See the [README](https://github.com/AvnerAdda/shekelsync/blob/main/README.md) for configuration and the [contributing guide](https://github.com/AvnerAdda/shekelsync/blob/main/CONTRIBUTING.md) for PR expectations. Internal migration and architecture notes live in [`docs/`](https://github.com/AvnerAdda/shekelsync/tree/main/docs).

## Development updates

The community workflow captures Home, Plan, and Wealth from each PR merged into `main`, using mocked APIs and fictional demo data. It posts the PR summary and screenshots in [Show and tell](https://github.com/AvnerAdda/shekelsync/discussions/categories/show-and-tell). An optional **Community update** section in a PR provides a user-facing explanation.

These screenshots describe development work. Published installers can lag behind `main`.

## Published versions

Release preparation includes updating `app/package.json` and its versioned changelog entry, reviewing migrations, and pushing a matching `v*` tag. The package workflow runs dependency audits, builds all three desktop platforms, and publishes after the builds succeed.

After publication, the community workflow adds a post in [Announcements](https://github.com/AvnerAdda/shekelsync/discussions/categories/announcements) with release notes, downloads, and update instructions. It verifies that the release commit is contained in `main`. Rerunning the workflow updates the existing post.

macOS releases are signed and notarized when the complete credential set is configured. With no signing credentials they are explicitly unsigned and require manual updates. Partially configured signing credentials stop the release.

See [Releases](https://github.com/AvnerAdda/shekelsync/releases), the [changelog](https://github.com/AvnerAdda/shekelsync/blob/main/CHANGELOG.md), and the [community automation guide](https://github.com/AvnerAdda/shekelsync/blob/main/docs/community-updates.md).

## Improve the wiki

The wiki's Markdown sources are maintained in [`docs/wiki/`](https://github.com/AvnerAdda/shekelsync/tree/main/docs/wiki). Submit documentation changes through a PR. A maintainer publishes the reviewed files to the separate GitHub wiki repository.
