# Versioning And Artifact Readiness

This page records the release mechanics for the current release readiness pass.
Support claims stay in
[`release-notes-support-matrix.md`](release-notes-support-matrix.md), and the
pre-release gate stays in
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).

## Current Version Decision

- Planned release tag: `v0.3.0`.
- Current source versions:
  - [`package.json`](../../../package.json): `0.3.0`
  - [`src-tauri/tauri.conf.json`](../../../src-tauri/tauri.conf.json): `0.3.0`
  - [`src-tauri/Cargo.toml`](../../../src-tauri/Cargo.toml): `0.3.0`
- The release tag must point to the exact `main` commit SHA that passed the
  Pre-Release Verification Gate. If the SHA changes, rerun the gate before
  tagging.
- The tag name and Tauri app version must match: tag `v0.3.0` pairs with
  `tauri.conf.json` version `0.3.0`.
- Parser subcrate versions such as `sql-parser-core` and `mongosh-parser-core`
  are internal crate versions and do not drive the desktop release tag.
- Agents must not create, move, delete, or force-push release tags unless the
  maintainer explicitly requests that exact operation.

If the release version changes before publishing, update `package.json`,
`src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` together in a normal PR,
then rerun CI and Runtime Happy Path on the merge commit.

## Tag And Workflow

The release workflow is
[`.github/workflows/release.yml`](../../../.github/workflows/release.yml).

- `push` of `v*.*.*` starts the real release pipeline.
- `workflow_dispatch` is a dry-run path. It creates a draft release named with
  `manual-<sha>` instead of a version tag.
- Release workflow output is a draft GitHub Release. A maintainer reviews and
  publishes it manually.
- Draft release creation is packaging evidence only. It does not replace CI,
  Runtime Happy Path, or product support evidence.

## Artifact Expectations

| Artifact lane | Workflow matrix | Expected output |
|---|---|---|
| macOS arm64 | `macOS arm64`, `aarch64-apple-darwin` | Apple Silicon `.dmg` plus `.sha256`. Current packages are unsigned, so first launch may require right-click -> Open or quarantine removal. |
| Windows x86_64 | `Windows x86_64`, `x86_64-pc-windows-msvc` | Windows installer bundle, normally `.msi`, plus `.sha256`. Current packages are unsigned, so SmartScreen may warn. |
| Linux x64 | `Linux x64`, `x86_64-unknown-linux-gnu` | Linux bundles produced by Tauri, such as `.deb`, `.rpm`, or `.AppImage`, plus `.sha256`. This lane is automation packaging evidence, not the primary supported desktop distribution target. |
| Checksums | `Upload SHA256 checksums` step | Every uploaded bundle should have a sibling `.sha256` file in standard `shasum -a 256` format. |
| Homebrew cask | [`homebrew-cask.md`](homebrew-cask.md) after release publish | Published GitHub Release triggers the Homebrew tap workflow. It uses the macOS arm64 `.dmg` and checksum to open or update the tap PR. |

## Post-Release Verification

After the draft release is created:

- Confirm the draft release tag/name matches the intended version or dry-run
  SHA.
- Confirm macOS, Windows, and Linux bundle assets are present for the workflow
  lanes above.
- Confirm each bundle has a sibling `.sha256`, then verify at least one checksum
  locally with the command shown in the generated release body.
- Confirm release notes link to
  [`release-notes-support-matrix.md`](release-notes-support-matrix.md),
  [`docs/product/README.md`](../../product/README.md), and
  [`docs/product/known-limitations.md`](../../product/known-limitations.md).
- Before publishing, confirm the exact release SHA has green CI and Runtime
  Happy Path checks from the Pre-Release Verification Gate.

After publishing:

- Confirm the Homebrew cask workflow ran.
- Confirm the Homebrew tap PR points at the published macOS arm64 `.dmg` and
  matching checksum.
- If the tap PR is merged, run a fresh `brew update` and cask install check on a
  compatible macOS arm64 machine before announcing Homebrew availability.

## Rollback Notes

- Bad draft, not published: keep it unpublished, delete or replace the draft
  release only after maintainer approval, fix on `main`, rerun the gate, and
  create a new draft.
- Bad tag before publish: do not publish the draft. Prefer a new fixed patch tag
  over retargeting a tag after the workflow has produced artifacts. Any tag
  deletion or retargeting is maintainer-owned.
- Bad published release: publish a superseding patch release, mark the previous
  release notes as superseded, and close or revert any Homebrew tap PR that
  points at the bad assets.
- Do not silently replace published assets under the same tag. Users and
  downstream checksums need a new version or a clearly documented superseding
  release.
