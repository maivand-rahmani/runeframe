# Repository Setup

Runeframe is a standalone, ESM-only npm package for Node.js `>= 22`. This document covers local setup, verification, and release prerequisites.

## Requirements

- Node.js `>= 22`
- npm with the committed `package-lock.json`

## Install

```bash
npm ci
```

## Verify

```bash
npm run typecheck               # tsc --noEmit
npm test                        # unit tests (src)
npm run test:integration:smoke  # integration smoke (examples/__tests__)
npm run test:integration:full   # integration suite, verbose
npm run pack:check              # build + packed-consumer ESM-only check
```

The integration suite runs through `vitest.integration.config.ts` against the example apps in `examples/apps/`.

## Build

```bash
npm run build
```

`tsup` builds ESM output and type declarations into `dist/` from the two entry points, `src/index.ts` and `src/experimental/index.ts`. The published `exports` map is import-only: there is no CommonJS build.

## Repository settings

- Protect `main`.
- Require the `test-build` job from `.github/workflows/ci.yml`: install, typecheck, unit tests, and pack check. The integration smoke step is advisory (`continue-on-error`).
- Allow Actions to create pull requests and write repository contents.

## Release

Releases run through Changesets on `main`:

1. Add a changeset with `npm run changeset`.
2. Merge to `main`; `.github/workflows/release.yml` opens or updates a release PR.
3. Merging that PR runs `npm run changeset:version` and publishes with `npm run publish:release`.

The release workflow requires `contents: write`, `pull-requests: write`, and `id-token: write` permissions.
