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
  `main` commit whose `tauri.conf.json` version equals the tag.
  `auto-tag-release.yml` checks the three files agree before it creates a tag,
  but `release.yml` does not recheck at build time (#1431): a hand-pushed
  `git push origin vX.Y.Z` publishes whatever bundle the tag points at, under a
  mismatched version. Confirm the match yourself before pushing a tag by hand.
- The tag must also point to a `main` commit SHA that passed the Pre-Release
  Verification Gate. If the SHA changes, rerun the gate before tagging. Nothing
  prevents a tag from landing on a red SHA — `auto-tag-release.yml` fires the
  moment the version bump merges, concurrently with that commit's own CI — so
  the check happens after the fact: `release.yml`'s `Verify tag SHA CI is green`
  job reads the tagged commit's check runs and ends the release run red when one
  of the checks it counts failed (#2168 — it does not count all of them; the
  exclusions are in Tag And Workflow below). A red release run is the signal
  sitting next to the
  Publish button; it does not delete the tag or the draft, and it does not stop
  a maintainer who publishes anyway.
- Parser subcrate versions such as `sql-parser-core` and `mongosh-parser-core`
  are internal crate versions and do not drive the desktop release tag.
- Agents must not create, move, delete, or force-push release tags unless the
  maintainer explicitly requests that exact operation.

To bump the version, edit `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml` together in a `chore/release-X.Y.Z` PR (this drives the
auto-tag flow in Tag And Workflow below), then rerun CI on the merge commit.

## Tag And Workflow

Two workflows drive a release:

- [`.github/workflows/auto-tag-release.yml`](../../../.github/workflows/auto-tag-release.yml)
  (Option B): when a version-bump PR merges to `main` and changes
  `src-tauri/tauri.conf.json`, it reads the version, checks that
  `src-tauri/Cargo.toml` and `package.json` both agree (every source-of-truth
  version file the workflow reads must match), and
  — if the `vX.Y.Z` tag does not already exist — creates and pushes it. The tag
  is pushed with the `RELEASE_PAT` secret, because a `GITHUB_TOKEN`-pushed tag
  would not trigger downstream workflows. This is the normal way a release tag is
  born; you rarely push tags by hand. See the `RELEASE_PAT` note below for how
  the workflow guards against an expired token silently stalling this step.
- [`.github/workflows/release.yml`](../../../.github/workflows/release.yml): the
  build pipeline.
  - A `v*.*.*` tag push (from auto-tag, or a deliberate manual push) starts the
    real release build. **It does not recheck the tag against the checked-out
    `tauri.conf.json` version** (the `UNGUARDED (#1431)` comment in
    `release.yml`), so a hand-pushed tag ships whatever bundle it points at,
    under a mismatched version. Confirm the match yourself before pushing a tag
    by hand.
  - `workflow_dispatch` is a dry-run path. It creates a draft release named
    `manual-<sha>` instead of a version tag.
  - Once the build legs finish, the `Verify tag SHA CI is green` job reads the
    tagged commit's check runs and fails the release run when one of the checks
    it counts failed, when one never finished inside its wait budget, or when
    the commit carries no check runs at all. It counts neither this release
    run's own jobs nor any check whose name ends in `(non-blocking)`. That
    second exclusion goes by name and never reads the conclusion, so it drops
    those checks whether they passed or failed. Since #2174 every job carrying
    the suffix also carries `continue-on-error: true`, but that flag does not
    soften what this job drops: a failing `continue-on-error` job still records
    `conclusion: failure` on its own check run, so a dropped row that is red is
    genuinely red. On what it does
    count it is fail-closed: an unreadable API answer is a failure, not a pass.
    It runs on the dry-run path too.
- Release workflow output is a draft GitHub Release. A maintainer reviews and
  publishes it manually — the draft is the only check that stops a bad build
  from auto-installing to every user via the updater.
- Draft release creation is packaging evidence only. It does not replace CI or
  product support evidence.

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
  provisioning that (App creation, secret registration) is a maintainer action
  outside this repository, so no file here holds that decision. What the repo
  does hold is `.github/workflows/auto-tag-release.yml`: the `RELEASE_PAT`
  secret name, the `contents: write` requirement it states, and a preflight
  annotation that repeats this preferred posture when the token reports no
  expiry. The 2026-07-30 release-ops bundle that raised the migration was
  #1439 P2-7.

## Artifact Expectations

| Artifact lane | Workflow matrix | Expected output |
|---|---|---|
| macOS arm64 | `macOS arm64`, `aarch64-apple-darwin` | Apple Silicon `.dmg` plus `.sha256`. Current packages are unsigned, so first launch may require right-click -> Open or quarantine removal. |
| Windows x86_64 | `Windows x86_64`, `x86_64-pc-windows-msvc` | Windows installer bundle, normally `.msi`, plus `.sha256`. Current packages are unsigned, so SmartScreen may warn. |
| Linux x64 | `Linux x64`, `x86_64-unknown-linux-gnu` | Linux bundles produced by Tauri, such as `.deb`, `.rpm`, or `.AppImage`, plus `.sha256`. This lane is automation packaging evidence, not the primary supported desktop distribution target. |
| Checksums | `Upload SHA256 checksums` step | The step hashes each `artifactPaths` entry that is a file and uploads a `.sha256` for it in standard `shasum -a 256` format, under the name the asset was published as — that name goes in the sidecar's own filename and in the filename column inside it. It reads the name off the release by matching the local file's sha256 against the assets' `digest` field instead of deriving it, because two renames sit in between: GitHub rewrites spaces to dots, and `tauri-action` gives the macOS updater tarball an arch suffix (#2307 — `v0.7.1` published `Table.View.app.tar.gz.sha256`, which pairs with no asset, while the published `Table.View_aarch64.app.tar.gz` got none; every sidecar in that release also wrote `Table View_…` with a space in its filename column, so the `shasum -a 256 -c` the release body tells users to run failed on all of them). It ends the leg red when an entry resolves to neither a file nor a directory, when no single published asset carries an entry's digest, and when nothing was hashed at all (#2207: Git Bash cannot stat the backslash paths `tauri-action` reports on Windows, and `[ -f "$f" ] || continue` turned that into a silent skip — `v0.7.0` and `v0.7.1` published `.msi` and `.exe` with no checksum under a green step). A green leg still does not mean every published asset has a sidecar: a directory bundle (the macOS `.app`) gets none by design and is logged as skipped, and `latest.json` gets none because it is not an `artifactPaths` entry and every matrix leg rewrites it after upload, which would leave any checksum stale. `scripts/release/checksum-sidecars.test.sh` pins the step's shape. |
| Updater artifacts | `createUpdaterArtifacts: true` in `tauri.conf.json`; `tauri-action` signs each with the minisign key | Each platform's updater bundle plus a sibling minisign `.sig` (macOS: `<app>.app.tar.gz` + `<app>.app.tar.gz.sig`), aggregated into one `latest.json` manifest on the draft release. This is the auto-update path — no job verifies it; check it by hand in Post-Release Verification. |
| Homebrew cask | [`homebrew-cask.md`](homebrew-cask.md) after release publish | No workflow updates the tap. After publishing, edit `Casks/table-view.rb` in the tap repo by hand from the macOS arm64 `.dmg` and its checksum, and open the tap PR. |

## Post-Release Verification

After the draft release is created:

- Confirm the draft release tag/name matches the intended version or dry-run
  SHA.
- Confirm macOS, Windows, and Linux bundle assets are present for the workflow
  lanes above.
- Take the difference both ways — assets with no sidecar, and sidecars naming an
  asset that is not there — then verify at least one checksum locally with the
  command shown in the generated release body. Only the updater manifest
  `latest.json` is expected under `NO SIDECAR`; see the Checksums row in Artifact
  Expectations above for why. Anything else under either heading is a defect
  (#2307 — reading only the `NO SIDECAR` direction is what let `v0.7.1` ship two
  sidecars pointing at nothing).

  ```sh
  gh release view <TAG> --json assets -q '.assets[].name' \
    | awk '{n[$0] = 1} END {
        for (a in n)
          if (a ~ /\.sha256$/) {
            b = substr(a, 1, length(a) - 7)
            if (!(b in n)) print "ORPHAN SIDECAR: " a
          } else if (!((a ".sha256") in n)) print "NO SIDECAR: " a
      }'
  ```
- Confirm release notes link to
  [`release-notes-support-matrix.md`](release-notes-support-matrix.md),
  [`docs/product/README.md`](../../product/README.md), and
  [`docs/product/known-limitations.md`](../../product/known-limitations.md).
- Before publishing, confirm the exact release SHA has green CI yourself. The
  release run's `Verify tag SHA CI is green` job does not settle that in either
  direction. It ignores every check whose name ends in `(non-blocking)`, and
  those checks still record `conclusion: failure` when they fail — their
  `continue-on-error: true` spares the workflow run they belong to, not their
  own check run — so a blown `WASM Size Budget (non-blocking)` leaves a red
  check on the commit while this job still passes. In the other direction the job runs under
  `if: always()`, so a red release run may be red for something the job never
  looked at, such as a dead build leg; only a failure reported by the job itself
  names offending checks. Read the commit's check list, not the release run's
  colour. The job also reports only the conclusions those checks reached; it
  cannot widen what they covered.
  `Runtime Happy Path` on a PR only ran the specs that PR's changed paths
  selected; the run that covers every spec is the `main` push run on the merge
  commit, or the nightly. Take that run, or run the smoke suite by hand, when
  the release needs full runtime proof (see
  [`testing-and-quality.md`](../testing-and-quality.md)).

Updater artifacts — the auto-update path, which reaches every installed client,
so a broken one is silent (updater errors are DEV-log-only, ADR 0036):

- Open `latest.json` from the draft and confirm it lists every build-matrix
  platform key (`darwin-aarch64`, `windows-x86_64`, `linux-x86_64`), each with a
  non-empty `url` and `signature`. The release run's `Verify latest.json is
  present` job only fails when the draft carries no `latest.json` at all
  (`release.yml`, the `UNGUARDED` comment under that job); **nothing checks
  completeness**, and a dropped key makes `check()` on that OS report "up to
  date" forever.
- Confirm each platform's updater bundle and its sibling `.sig` are attached
  (macOS: `<app>.app.tar.gz` + `<app>.app.tar.gz.sig`). **Nothing verifies those
  `.sig` files against the pubkey committed in `tauri.conf.json`**
  (the `UNGUARDED (#1430)` comment in `release.yml`) — if the signing key and
  that pubkey drift, every client rejects the update silently. Verify by hand.
  Key backup, rotation, and loss handling live in
  [`updater-signing-key.md`](updater-signing-key.md) — do not repeat them here.
- Both checks above are yours to run. A green release proves only that the build
  legs finished; it proves nothing about updater manifest completeness or
  signature validity, and nothing about a live `check()` roundtrip (see the
  post-publish smoke below).

After publishing:

- Auto-update roundtrip smoke: from an install of the *previous* published
  version, trigger the boot-time check in
  [`src/lib/runtime/autoUpdate.ts`](../../../src/lib/runtime/autoUpdate.ts),
  confirm the prompt offers the new version, accept it, and confirm
  `downloadAndInstall` completes and the app relaunches into the new version.
  This is the only check that exercises the real `check()` ->
  `downloadAndInstall` roundtrip; CI produces the updater artifacts but verifies
  nothing about them and cannot install a published release. `.deb`/`.rpm`
  installs cannot self-update (no writable in-place target) and show a
  manual-upgrade hint instead of a prompt (#1437), so run the roundtrip on a
  macOS, Windows, or Linux AppImage install.
- Update the Homebrew tap by hand — no workflow does it. The procedure is in
  [`homebrew-cask.md`](homebrew-cask.md).
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
   change — on `main`, and rerun CI on the merge commit. The `main` push run of
   `Runtime Happy Path` covers every spec; run the suite by hand only when you
   need evidence sooner than that run lands. If the fix is a
   pure revert, it can be small and fast; correctness still gates it.
2. **Bump to the next patch.** In one `chore/release-X.Y.Z+1` PR, bump
   `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`
   together to the next patch version (a bad `0.4.2` is superseded by `0.4.3`,
   never by re-releasing `0.4.2`). This is the normal release flow, just
   prioritized: merging it drives auto-tag → draft build → the Post-Release
   Verification above.
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
