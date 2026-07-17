# Updater Signing Key — Backup, Rotation, and Loss Runbook

The in-app auto-updater (ADR 0049) trusts exactly one thing: a minisign
(Ed25519) keypair. Every shipped client verifies each update against the
**public** key baked into its binary at build time; the release pipeline signs
each updater bundle with the matching **private** key. If that private key is
lost, leaked, or rotated incorrectly, auto-update breaks — and because updater
errors are DEV-log-only with no telemetry (ADR 0036), the break is **silent**.

This page is the operational runbook for that keypair. It does not repeat the
release mechanics in
[`versioning-and-artifacts.md`](versioning-and-artifacts.md) — it covers only
the signing key lifecycle.

> Security: never put a real private key, its password, or a real CI token in
> this repo, an issue, a PR, or chat. Everything below uses placeholders such
> as `<MINISIGN_PRIVATE_KEY_PATH>` and `<KEY_PASSWORD>`. The only value safe to
> paste anywhere is the **public** key.

## Where the key material lives today

| Item | Location | Kind |
|---|---|---|
| Public key | [`src-tauri/tauri.conf.json`](../../../src-tauri/tauri.conf.json) → `plugins.updater.pubkey` | Committed, public, baked into every build |
| Private key | GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` | CI-only, write-only |
| Key password | GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | CI-only, write-only |
| Signing step | [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) "Build + upload to draft release" | `tauri-action` signs each updater bundle |
| Drift gate | [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) "Verify updater signatures against committed pubkey" → [`scripts/release/verify-updater-sigs.mjs`](../../../scripts/release/verify-updater-sigs.mjs) | Fails the release if the signing key ID differs from the committed pubkey |

To print the key ID the committed pubkey belongs to (useful for eyeball checks
during rotation), run from the repo root:

```sh
node -e 'const c=require("./src-tauri/tauri.conf.json");const b=Buffer.from(Buffer.from(c.plugins.updater.pubkey,"base64").toString().split("\n")[1],"base64");console.log(Buffer.from(b.subarray(2,10)).reverse().toString("hex").toUpperCase())'
```

The `verify-updater-sigs.mjs` gate compares this ID against every produced
`.sig` on every release, so a key that no longer matches the committed pubkey
fails the run before a draft can be published.

## The reason this key is special: clients trust one baked-in public key

A shipped client can verify an update **only** with the public key that was
compiled into it. That key comes from `plugins.updater.pubkey` at *build*
time, so it is frozen inside each installed binary and cannot be updated
remotely. This produces one hard constraint that governs every procedure below:

- To reach an already-installed client with a *new* public key, you must first
  ship it a release that is signed by the key it *already* trusts (the old
  key), and whose bundle carries the new public key. Call this the **bridge
  release**.
- A client that never installs the bridge release stays frozen on the old
  public key. If you have already retired the old private key, that client can
  never auto-update again and must be reinstalled by hand.

Everything else is a consequence of this one fact.

## Backup / escrow (do this at key generation, before first release)

GitHub Actions secrets are **write-only** — once set, `TAURI_SIGNING_PRIVATE_KEY`
cannot be read back out. So the CI secret is **not** a backup. If the only copy
of the private key is the CI secret, the key is effectively already lost. Back
it up at generation time:

1. Generate the keypair locally (offline machine preferred):

   ```sh
   pnpm tauri signer generate -w <MINISIGN_PRIVATE_KEY_PATH>
   ```

   The command prompts for `<KEY_PASSWORD>` and prints the **public** key. The
   public key goes into `src-tauri/tauri.conf.json`; the private key file at
   `<MINISIGN_PRIVATE_KEY_PATH>` and its password are the secrets.

2. Register the two CI secrets (values are the *contents* of the private key
   file and the password — never a file path or a real value in any doc):

   ```sh
   gh secret set TAURI_SIGNING_PRIVATE_KEY < <MINISIGN_PRIVATE_KEY_PATH>
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # paste <KEY_PASSWORD> when prompted
   ```

3. Escrow **two independent offline copies** of the private key file *and* the
   password, stored so that no single location holds both in plaintext:
   - Private key file: an encrypted offline vault (hardware-backed secret
     manager, or an encrypted volume held by the release owner). Not the repo,
     not a Git-tracked path, not a shared drive in plaintext.
     `<MINISIGN_PRIVATE_KEY_PATH>` is already password-protected by minisign,
     but treat the file itself as secret regardless.
   - Password: a separate password manager entry with a different access list.
   - Record **who** can reach each copy (access control is part of the escrow —
     the key is only as safe as the shortest list of people who can read it).

4. Access control: restrict who can read the escrow and who can edit the two
   GitHub Actions secrets to the maintainers who actually publish releases.
   Removing a release maintainer means reviewing both escrow copies too.

## Rotation (planned key change — you still hold the old key)

Use this when you deliberately replace the keypair (for example, hygiene after a
maintainer with escrow access leaves) and the **old private key is still
available**. The old key is what makes a clean migration possible: it is the
only thing that can sign an update old clients will accept.

The migration is **one** bridge release. A client installs it while trusting the
old key, and comes out the other side trusting the new key.

Two build-time inputs decide everything, and they are independent:

- What signs the bundle: the CI secret `TAURI_SIGNING_PRIVATE_KEY`.
- What the installed binary will trust next time: `plugins.updater.pubkey` in
  `src-tauri/tauri.conf.json`, baked into the binary.

Order matters — do not skip a step:

1. **Generate + escrow the new keypair** using the backup procedure above. Keep
   the old key available; you are not retiring it yet.
2. **Verify the new keypair** before it touches a release: sign a throwaway file
   locally and confirm it verifies against the new public key.

   ```sh
   pnpm tauri signer sign -k <NEW_MINISIGN_PRIVATE_KEY_PATH> <SOME_TEST_FILE>
   ```

3. **Ship the bridge release:** build it from a commit where
   `plugins.updater.pubkey` is the **new** public key, but with the CI secret
   `TAURI_SIGNING_PRIVATE_KEY` still set to the **old** private key. Result: the
   bundle is signed by the old key, so every existing install (which trusts the
   old key) accepts it; installing it replaces their binary with one whose
   baked-in pubkey is now the new one.

   This is the single release where committed pubkey (new) and signing key (old)
   intentionally disagree, so the `verify-updater-sigs.mjs` drift gate will go
   red for it — that red is expected. Handle the bridge deliberately: run it,
   confirm the signature is the old key over the new-pubkey binary, and note the
   expected-red gate in the release PR. To actually ship it: the build/upload
   step runs before the drift gate, so the signed bundle is already attached to
   the draft release when the gate goes red — publish that draft by hand for this
   one release (`gh release edit <tag> --draft=false`, or the GitHub Release
   **Publish** button) rather than turning the gate off. Do **not** turn the gate
   off for normal releases; it exists to catch the *accidental* version of exactly
   this mismatch.
4. **Give clients time to install the bridge.** Auto-update reaches a client
   only when it launches and the user approves, and there is no telemetry to
   confirm adoption. Leave the bridge as the `latest` release long enough for
   your user base to roll through it (weeks, not hours) and announce the window
   in the release notes.
5. **Cut over CI signing to the new key** by updating the two GitHub Actions
   secrets to the new private key + password. From the next release on, the
   signing key (new) matches the committed pubkey (new), the drift gate is green
   again, and clients that took the bridge verify normally.
6. **Retire the old key** only after the cutover release is out and verified.
   The old private key was overwritten in the CI secret at step 5; delete the
   old escrow copies and record the retirement date. Any client that never took
   the bridge is now stranded on the old pubkey and must reinstall manually —
   see the loss runbook's out-of-band migration path.

Keep the old escrow copy until step 6. Deleting the old key before the bridge
has been `latest` long enough strands every client that has not yet taken it.

## Loss (the private key is gone and cannot be recovered)

Symptoms: the escrow copies are gone/corrupt and the CI secret cannot be read
back (it never can). You can no longer produce a signature that the committed
pubkey accepts.

Impact — state it plainly:

- You cannot sign any release that existing installs will accept. Because there
  is no old key to sign a bridge, **every existing install is permanently cut
  off from auto-update.** A new keypair does not help them: their baked-in
  public key is the old one, and nothing you can sign will verify against it.
- New installs are fine once you ship a build with a new pubkey — the problem is
  strictly the already-deployed clients.

Response:

1. **Confirm the loss** before acting: check both escrow copies and confirm no
   maintainer holds a copy. Confirm the CI secret truly cannot be exported (it
   cannot — GitHub secrets are write-only). Only proceed once loss is certain.
2. **Generate a fresh keypair** and escrow it with the backup procedure above.
   This time, verify at least two independent offline copies exist before the
   first release.
3. **Ship a new release** with the new public key committed to
   `src-tauri/tauri.conf.json` and CI signing set to the new key. The drift gate
   passes (new == new). This protects *new* installs.
4. **Migrate stranded clients out-of-band**, because auto-update cannot reach
   them:
   - Release notes on the new release and the repository README must state that
     existing installs will not auto-update and must be reinstalled manually.
   - Point users at the normal install paths in
     [`versioning-and-artifacts.md`](versioning-and-artifacts.md) and
     [`homebrew-cask.md`](homebrew-cask.md) (`brew upgrade --cask table-view`
     picks up the new build on macOS).
   - Treat this as a user-visible incident: it warrants a
     [`docs/product/known-limitations.md`](../../product/known-limitations.md)
     note for the affected version range until adoption of the reinstall is
     believed complete.
5. **Post-incident:** record the loss and the new key ID (public) in the release
   history, and review why escrow failed so the same single-point-of-failure
   cannot recur.

## Compromise / leak (the private key may be in someone else's hands)

Different from loss: here you likely *still* hold the key, but its secrecy is
gone. The danger is that whoever holds the leaked key can forge an update that
your clients will trust.

Scope the exposure first:

- The updater fetches its manifest and bundles only from this repository's
  releases (`releases/latest/download/latest.json`). A leaked *signing* key by
  itself does not let an attacker serve clients a malicious update — they would
  also need to publish a malicious `latest.json`/bundle to this repo's releases,
  which requires repository write access. So a key leak **without** repo-write
  is lower urgency than it looks. It is still a broken guarantee and must be
  rotated out.
- If the leak coincides with repo-write compromise, treat it as an active
  incident: unpublish/replace any suspicious release and rotate immediately.

Response:

1. **Rotate away from the compromised key** using the rotation procedure above.
   Because you still hold the old key, you can sign the bridge and migrate
   honest clients cleanly onto a new pubkey the attacker does not have.
2. **Shorten the migration window** relative to a routine rotation — the old
   pubkey stays trusted by un-migrated clients until they take the bridge, and
   during that window a forged update (if the attacker also has repo-write)
   would be accepted. Announce urgency in release notes.
3. **Rotate the CI secret's blast radius too:** review who had access to the CI
   secret and escrow, revoke unneeded access, and rotate any related tokens
   (for example `RELEASE_PAT`) if the same exposure could have reached them.
4. **You cannot remotely invalidate the old pubkey** already baked into shipped
   binaries — the only lever is shipping the bridge and getting clients onto the
   new key. Manage expectations accordingly and, if the exposure is severe,
   pair rotation with the out-of-band reinstall guidance from the loss runbook.

## Periodic checks (fold into the release runbook)

- **Every release** already verifies key health for free: the
  `verify-updater-sigs.mjs` drift gate fails the run if the signing key stops
  matching the committed pubkey, and `verify-latest-json.mjs` fails if a
  platform is missing from the manifest. Do not bypass either — a bypass ships a
  silently broken updater (see
  [`versioning-and-artifacts.md`](versioning-and-artifacts.md) rollback notes).
- **Quarterly (or when the release-maintainer list changes):** confirm both
  offline escrow copies still exist and open, and that the access lists for the
  escrow and the two GitHub Actions secrets still match the current release
  maintainers. Remove access for anyone who has left.
- **On any maintainer departure:** treat as a compromise-adjacent event —
  review escrow access and consider a rotation if the departing maintainer held
  a private-key copy.

## Related

- ADR 0049 —
  [`docs/archives/decisions/0049-auto-update-full-tauri-updater/memory.md`](../../archives/decisions/0049-auto-update-full-tauri-updater/memory.md)
  (why minisign is the trust anchor; private key in CI secret only).
- ADR 0036 — telemetry zero: updater failures are silent client-side, which is
  why a key mistake is invisible without these gates.
- [`versioning-and-artifacts.md`](versioning-and-artifacts.md) — release
  mechanics, artifact verification, rollback.
- [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) —
  signing env + drift/manifest gates.
- [`src/lib/runtime/autoUpdate.ts`](../../../src/lib/runtime/autoUpdate.ts) —
  client-side check/download/verify/relaunch.
