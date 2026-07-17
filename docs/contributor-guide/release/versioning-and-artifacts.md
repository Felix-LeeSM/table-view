# Versioning And Artifact Readiness

This page records the release mechanics for the current release readiness pass.
Support claims stay in
[`release-notes-support-matrix.md`](release-notes-support-matrix.md), and the
pre-release gate stays in
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).

## Current Version Decision

- The desktop release version is whatever
  [`package.json`](../../../package.json),
  [`src-tauri/tauri.conf.json`](../../../src-tauri/tauri.conf.json), and
  [`src-tauri/Cargo.toml`](../../../src-tauri/Cargo.toml) currently declare —
  those three files are the source of truth, not this page. They must all agree
  on the same `X.Y.Z` (at time of writing, `0.4.2`).
- The release tag is `vX.Y.Z` for that exact version. It must point at the
  `main` commit whose `tauri.conf.json` version equals the tag, and `release.yml`
  enforces this on every tagged build via
  [`scripts/release/verify-tag-version.mjs`](../../../scripts/release/verify-tag-version.mjs):
  a tag whose checked-out version disagrees fails before any build work.
- The tag must also point to a `main` commit SHA that passed the Pre-Release
  Verification Gate. If the SHA changes, rerun the gate before tagging.
- Parser subcrate versions such as `sql-parser-core` and `mongosh-parser-core`
  are internal crate versions and do not drive the desktop release tag.
- Agents must not create, move, delete, or force-push release tags unless the
  maintainer explicitly requests that exact operation.

To bump the version, edit `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml` together in a `chore/release-X.Y.Z` PR (this drives the
auto-tag flow in Tag And Workflow below), then rerun CI and Runtime Happy Path
on the merge commit.

## Tag And Workflow

Two workflows drive a release:

- [`.github/workflows/auto-tag-release.yml`](../../../.github/workflows/auto-tag-release.yml)
  (Option B): when a version-bump PR merges to `main` and changes
  `src-tauri/tauri.conf.json`, it reads the version, checks that `Cargo.toml`
  and `package.json` both agree (all three source-of-truth files must match), and
  — if the `vX.Y.Z` tag does not already exist — creates and pushes it. The tag
  is pushed with the `RELEASE_PAT` secret, because a `GITHUB_TOKEN`-pushed tag
  would not trigger downstream workflows. This is the normal way a release tag is
  born; you rarely push tags by hand. See the `RELEASE_PAT` note below for how
  the workflow guards against an expired token silently stalling this step.
- [`.github/workflows/release.yml`](../../../.github/workflows/release.yml): the
  build pipeline.
  - A `v*.*.*` tag push (from auto-tag, or a deliberate manual push) starts the
    real release build. Its first gate step (after the boilerplate checkout)
    ([`verify-tag-version.mjs`](../../../scripts/release/verify-tag-version.mjs))
    fails every build leg if the tag disagrees with the checked-out
    `tauri.conf.json` version, so a hand-pushed tag cannot ship a mismatched
    bundle.
  - `workflow_dispatch` is a dry-run path. It creates a draft release named
    `manual-<sha>` instead of a version tag, and skips the tag/version gate.
- Release workflow output is a draft GitHub Release. A maintainer reviews and
  publishes it manually — the draft gate is the human check that stops a bad
  build from auto-installing to every user via the updater.
- Draft release creation is packaging evidence only. It does not replace CI,
  Runtime Happy Path, or product support evidence.

### `RELEASE_PAT` — health and least privilege

`auto-tag-release.yml` pushes the tag with the `RELEASE_PAT` secret because a
`GITHUB_TOKEN`-pushed tag does not trigger `release.yml`. Two operational
concerns follow from that:

- **Silent stall on expiry.** An *expired* PAT is still a non-empty secret, so a
  bare "is it set" check passes and the tag push then fails with a cryptic auth
  error — the version bump merged but no tag ships, and nobody notices unless
  they watch the Actions tab. The workflow now runs a preflight that probes the
  token against the GitHub API: a `401` fails the run loudly with rotation
  guidance, and it emits a warning annotation when the token's reported
  expiration is within 14 days so a maintainer can rotate ahead of the break.
  GitHub still emails the run's actor on a failed run; any richer external alert
  (Slack, PagerDuty) needs a webhook secret and is a maintainer-owned follow-up.
- **Broad scope of a classic PAT.** A classic PAT — especially a never-expiring
  one — carries account-wide scope far beyond the `contents: write` this
  workflow needs. The preferred posture is a fine-grained PAT scoped to this repo
  with `contents: write` only, or a GitHub App installation token. Choosing and
  provisioning that (App creation, secret registration) is an infrastructure
  decision that requires a maintainer action and is **not** made by this doc or
  the workflow — see issue #1439 P2-7.

## Artifact Expectations

| Artifact lane | Workflow matrix | Expected output |
|---|---|---|
| macOS arm64 | `macOS arm64`, `aarch64-apple-darwin` | Apple Silicon `.dmg` plus `.sha256`. Current packages are unsigned, so first launch may require right-click -> Open or quarantine removal. |
| Windows x86_64 | `Windows x86_64`, `x86_64-pc-windows-msvc` | Windows installer bundle, normally `.msi`, plus `.sha256`. Current packages are unsigned, so SmartScreen may warn. |
| Linux x64 | `Linux x64`, `x86_64-unknown-linux-gnu` | Linux bundles produced by Tauri, such as `.deb`, `.rpm`, or `.AppImage`, plus `.sha256`. This lane is automation packaging evidence, not the primary supported desktop distribution target. |
| Checksums | `Upload SHA256 checksums` step | Every uploaded bundle should have a sibling `.sha256` file in standard `shasum -a 256` format. |
| Updater artifacts | `createUpdaterArtifacts: true` in `tauri.conf.json`; `tauri-action` signs each with the minisign key | Each platform's updater bundle plus a sibling minisign `.sig` (macOS: `<app>.app.tar.gz` + `<app>.app.tar.gz.sig`), aggregated into one `latest.json` manifest on the draft release. This is the auto-update path — verified by the gates in Post-Release Verification. |
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

Updater artifacts — the auto-update path, which reaches every installed client,
so a broken one is silent (updater errors are DEV-log-only, ADR 0036):

- Confirm the draft carries `latest.json`, and that the release run's
  `Verify latest.json platform completeness` job passed. That gate
  ([`verify-latest-json.mjs`](../../../scripts/release/verify-latest-json.mjs))
  fails the release unless `latest.json` lists every build-matrix platform key
  (`darwin-aarch64`, `windows-x86_64`, `linux-x86_64`), each with a non-empty
  `url` and `signature`. A dropped key would make `check()` on that OS report
  "up to date" forever.
- Confirm each platform's updater bundle and its sibling `.sig` are attached
  (macOS: `<app>.app.tar.gz` + `<app>.app.tar.gz.sig`), and that the
  `Verify updater signatures against committed pubkey` step passed. That gate
  ([`verify-updater-sigs.mjs`](../../../scripts/release/verify-updater-sigs.mjs))
  fails the release if any `.sig` was signed by a key other than the pubkey in
  `tauri.conf.json`. Key backup, rotation, and loss handling live in
  [`updater-signing-key.md`](updater-signing-key.md) — do not repeat them here.
- Do not bypass either gate. A green release proves the signed updater artifacts
  are present and internally consistent; it does not by itself prove a live
  `check()` roundtrip works end to end (see the post-publish smoke below).

After publishing:

- Auto-update roundtrip smoke: from an install of the *previous* published
  version, trigger the boot-time check in
  [`src/lib/runtime/autoUpdate.ts`](../../../src/lib/runtime/autoUpdate.ts),
  confirm the prompt offers the new version, accept it, and confirm
  `downloadAndInstall` completes and the app relaunches into the new version.
  This is the only check that exercises the real `check()` ->
  `downloadAndInstall` roundtrip; CI verifies the artifacts but cannot install a
  published release. `.deb`/`.rpm` installs cannot self-update (no writable
  in-place target) and show a manual-upgrade hint instead of a prompt (#1437),
  so run the roundtrip on a macOS, Windows, or Linux AppImage install.
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
- Bad published release: publish a superseding patch release (procedure below),
  mark the previous release notes as superseded, and close or revert any Homebrew
  tap PR that points at the bad assets.
- Do not silently replace published assets under the same tag. Users and
  downstream checksums need a new version or a clearly documented superseding
  release.
- Lost or leaked updater signing key: this is not a tag rollback — follow
  [`updater-signing-key.md`](updater-signing-key.md), which covers the bridge
  release needed to move already-installed clients onto a new public key.

### Superseding patch release (auto-update only moves forward)

There is **no downgrade path** for a bad *published* release. The in-app updater
(ADR 0049) offers a client an update only when the manifest version is *newer*
than what it runs, so re-publishing the previous good version as `latest` does
nothing — every client already on the bad version sees an older `latest` and
stays put. The only way to move users off a bad published release is to ship a
**higher** version that fixes (or reverts) it. That is the superseding patch.

1. **Fix or revert on `main`.** Land the fix — or a straight revert of the bad
   change — on `main`, and rerun CI + Runtime Happy Path on the merge commit.
   If the fix is a pure revert, it can be small and fast; correctness still
   gates it.
2. **Bump to the next patch.** In one `chore/release-X.Y.Z+1` PR, bump
   `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`
   together to the next patch version (a bad `0.4.2` is superseded by `0.4.3`,
   never by re-releasing `0.4.2`). This is the normal release flow, just
   prioritized: merging it drives auto-tag → draft build → the gates above.
3. **Publish the patch draft** after the normal Post-Release Verification. On
   publish it becomes `latest`, and every install on the bad version auto-updates
   forward to it on next launch + user approval.
4. **Mark the bad release superseded.** Edit the bad release's notes to point at
   the patch, and close or revert any Homebrew tap PR that referenced the bad
   assets so downstream installs pick up the patch.
5. **Announce — there is no telemetry (ADR 0036).** Auto-update reaches a client
   only when it launches and the user approves, and nothing reports adoption. If
   the bad release is severe (data loss, security), also add a
   [`docs/product/known-limitations.md`](../../product/known-limitations.md) note
   for the affected version range, and consider unpublishing/replacing the bad
   assets so *new* installs cannot land on it while the patch propagates.

Clients that cannot self-update (`.deb`/`.rpm`, and Intel Macs — see
known-limitations) will not receive the patch automatically; the announcement in
step 5 is their only signal to upgrade by hand.
