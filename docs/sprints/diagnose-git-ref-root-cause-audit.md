# Git Ref Snapback Root Diagnosis

Date: 2026-05-21 KST

Historical note: this file records one diagnosed incident. It is not the current
git or push-recovery policy. Current workflow rules live in
[`memory/workflow/git-policy/memory.md`](../../memory/workflow/git-policy/memory.md).

Scope: diagnose why a linked worktree branch ref moved back to `FETCH_HEAD`
around push time, then separate that from ordinary push rejection or GitHub
merge cleanup failures.

## Result

Root cause: the pre-push `cargo-deny` step ran a tool that shells out to Git
while the hook still carried the outer repository's Git-local environment.
When that nested Git operation updated its advisory database, the inherited
environment made the Git command operate against the outer worktree metadata
instead of only the advisory DB. The visible symptom was the sprint branch ref
snapping from the agent's local commit back to the SHA stored in `FETCH_HEAD`.

Contributing issue: a newly spawned worktree branch used to track `origin/main`
until its own remote branch existed. That did not by itself reset the branch,
but it made status/upstream reasoning point at the wrong ref and made a
`FETCH_HEAD` snapback look like an external race.

## Evidence

`git reflog --all --date=iso` shows the failure sequence on
`diagnose/worktree-push-ref-snapback`:

- `2026-05-21 08:58:20 +0900`: local commit `02b7ab5`
  `docs(diagnose): trace worktree push ref behavior`
- `2026-05-21 09:00:18 +0900`: local branch moved to `c38e7af` with
  `reset: moving to FETCH_HEAD`
- `2026-05-21 09:00:20 +0900`: remote branch updated by push to `02b7ab5`
- `2026-05-21 09:03:09 +0900`: fix commit `31a1569`
  `fix(hooks): isolate cargo deny git environment`

That ordering rules out "remote changed underneath us" as the primary cause for
this incident. The remote accepted the intended commit; the local branch ref had
already moved because a local Git operation reset it to `FETCH_HEAD`.

The local reflog also contains repeated historical `reset: moving to
FETCH_HEAD` entries across sprint branches. Those older entries are not all
proven to be the same cargo-deny path, but they show that `FETCH_HEAD` ref
snapback was a systemic failure mode rather than a one-off command typo.

## Hypotheses Checked

1. Nested Git command inherited outer hook Git env.
   - Prediction: isolating Git-local env before `cargo deny check` prevents the
     branch ref from moving.
   - Result: supported. PR #73 changed `lefthook.yml` to run
     `unset $(git rev-parse --local-env-vars)` before `cargo deny check`.

2. Worktree branch tracked `origin/main` before it had its own remote branch.
   - Prediction: a fresh worktree branch would report `origin/main` as upstream,
     creating misleading fallback state.
   - Result: supported as a contributor. PR #73 changed
     `scripts/worktree-spawn.sh` to unset upstream for new branches.

3. External actor pushed or rewrote the remote branch.
   - Prediction: remote update would precede the local ref movement or point to
     an unknown SHA.
   - Result: refuted for this incident. Reflog shows local reset first, then
     remote update to the intended commit.

4. GitHub PR merge cleanup failed locally.
   - Prediction: failure would happen after merge while checking out local
     `main`, not during branch push.
   - Result: separate issue. `gh pr merge --squash --delete-branch` can merge on
     GitHub but fail local checkout when the primary `main` worktree already
     exists. That is a cleanup-path issue, not this ref snapback.

## Fix Already Landed

- `lefthook.yml`: `cargo-deny` now unsets Git-local env before running
  `cargo deny check`.
- `scripts/worktree-spawn.sh`: new branches created from `origin/main` have
  upstream unset until their own remote ref exists.
- `scripts/hooks/test-worktree-push-ref-safety.sh`: static regression guard for
  both invariants.

## Historical Prevention Rule

Hook steps may inspect the current repository, but any hook step that invokes a
tool capable of running its own Git commands must either:

- run with `unset $(git rev-parse --local-env-vars)` before the nested tool, or
- execute inside a controlled environment that cannot inherit the outer repo's
  `GIT_*` local variables.

For push recovery, keep using the existing four-step policy:
`git ls-remote`, reflog inspection, `git update-ref` to the known local SHA,
then literal SHA refspec push.

## Validation

- `bash scripts/hooks/test-worktree-push-ref-safety.sh`
- `git status --short --branch` on a fresh diagnosis worktree confirms no
  upstream is set for `diagnose/git-ref-root-cause-audit`.
