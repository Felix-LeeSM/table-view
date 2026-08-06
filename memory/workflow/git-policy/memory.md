---
title: Git 정책
type: workflow-rule
updated: 2026-08-06
task: commit, push, signing, push-reject, pr-close, race-trace
keywords: non-fast-forward, push reject, force-push, --no-verify, --no-gpg-sign, FETCH_HEAD, ORIG_HEAD, update-ref, ls-remote, stale ref, pinentry, gpg failed, exit code, 파이프, stash, stash pop
trigger:
  signal: git commit / git push / push reject / PR close 시
  layer: none — 집행 훅 없음, 규율만
---

# Git 정책

이 파일이 git **계약**의 유일한 SOT 다 — 금지 목록, 근거, 책임 주체. 명령
시퀀스는 `.agents/skills/recovering-push-rejects/SKILL.md` 가 소유한다 (아래
「절차는 skill 이 소유한다」). 둘이 어긋나면 이 방이 이긴다.

**집행 장치는 없다.** 아래 금지 항목을 **아무도 막지 않는다** — 실행되기 전에
스스로 멈춰야 한다. 이 방은 `CLAUDE.md` → `AGENTS.md` import 를 타고 오는
포인터를 보고 직접 열어야 닿는다.

## 절대 금지 — 검증 우회

**`git commit --no-verify` / `git push --no-verify` 어떤 상황에서도 사용 금지.**
**`--no-gpg-sign` / `commit.gpgsign=false` 등 signing 우회도 금지.**

### Why

- push 직전 로컬 검증은 **`lefthook.yml` 의 pre-push 훅**이다 — 그 파일의
  `pre-push.jobs` 가 목록의 SOT 이고, 지금 걸린 것은
  `biome check . --error-on-warnings` (포맷 + 일반 lint, 전체 트리), push 대상
  변경 파일 한정 `eslint --quiet` (repo 고유 가드), 그리고 manifest 마다 도는
  `cargo fmt --manifest-path <manifest> --check`. `--no-verify` 는 통째로 끈다.
- 나머지 — `cargo clippy -D warnings`, `cargo test`, vitest, 커버리지 — 는
  여전히 **CI 에서만 돈다.** 깨진 코드를 push 하면 CI 에서 처음 드러난다.
- pre-commit 훅은 없다. 커밋은 게이트 없이 지나가고 push 에서 한 번 잡힌다.
- hook 설치는 `pnpm install` → `package.json` 의 `prepare` 가
  `git config --unset-all core.hooksPath` 후 `lefthook install`. 지워진
  `.githooks/` 를 가리키는 dangling `core.hooksPath` 가 남아 있어 unset 이
  선행되지 않으면 lefthook 훅이 아예 안 걸린다.
- 서명은 `commit.gpgsign` 설정이 건다.
- [ADR 0044](../../../docs/decisions/0044-e2e-smoke-remote-required/memory.md)
  의 runtime e2e smoke blocking check 는 2026-07-31 (#2038) 부터 다시 실검사다.
  `Runtime Happy Path` 가 변경 경로에서 spec 부분집합을 골라 돌린다 — 로컬에서
  안 돌려도 CI 가 잡지만, 잡히는 범위는 네 변경이 고른 spec 뿐이다.

## 실패 시 — 회피 X, 근본 fix

- 포맷 실패 → `pnpm format` (= `biome format --write .`) / rust 는
  `pnpm format:rust` — 맨 `cargo fmt` 는 루트에 `Cargo.toml` 이 없어 실패한다.
  manifest 경로는 그 스크립트에 있다.
- 린트 실패 → 경고 수정. 억제는 사유 코멘트와 함께만 — 일반 규칙은
  `biome-ignore`, repo 고유 가드는 `eslint-disable`.
- 테스트 실패 → 코드 수정 또는 (테스트가 틀렸으면) 테스트 + ADR 수정.
- e2e timeout → `e2e/smoke/_helpers.ts` + `wdio.smoke.conf.ts` timeout, docker
  daemon 확인.
- GPG pinentry timeout → 즉시 중단. 사용자에게 signing cache warm-up 필요를
  보고하고 unsigned commit 으로 진행하지 않음.

## Hard block — 승인으로도 우회 불가

아래는 사용자 승인 요청 대상이 아니라 **수행 금지**다.
**이 목록이 SOT 이고 집행자는 agent 자신이다** — 차단하는 장치는 없다.

- `git commit --no-verify` / `git push --no-verify`
- `--no-gpg-sign` / `commit.gpgsign=false`
- `git push --force` / `--force-with-lease` 등 force-push 전 변종
- `git reset --hard` 의 remote-upstream target 형 — `FETCH_HEAD` / `ORIG_HEAD` /
  `@{u}` / `origin/<branch>` / `refs/remotes/<...>`
- `git pull` 모든 변종 (`--rebase`, `origin <branch>` 포함)
- 소스/앱 자산을 지우는 destructive command (`rm -rf` 로 트래킹 파일 제거 등)

시퀀스로 쓰든 두 단계로 쪼개 쓰든 같다. 긴급 복구도 hard-block 명령을 승인으로
우회하지 말고 사용자와 합의해 정책 자체를 바꾸고 여기에 기록한다. GPG signing
불가 시 unsigned commit 으로 진행하지 않는다.

## 절차는 skill 이 소유한다

막힌 push 를 푸는 명령 시퀀스는
`.agents/skills/recovering-push-rejects/SKILL.md` 가 SOT 다 — 4-step 회복, SHA
refspec push, closed-PR stale ref 청소, 외부 race 오진.
**어떤 harness 도 그 파일을 자동으로 안 읽는다**: `AGENTS.md` 매트릭스와 이
포인터가 유일한 도달 경로다. 이 방에는 그 절차가 지켜야 하는 계약만 둔다.

위 `keywords:` 줄은 절차가 나간 뒤에도 **그대로 둔다.** 기본 `rg` 는 dotfile 을
빼서 `.agents/` 를 못 보므로, 에러 문자열로 찾는 쪽이 닿는 곳은 이 방이고 방이
앞으로 넘긴다. 그 줄을 "낡았다" 며 지우면 도달이 끊긴다.

- **push reject 는 즉시 중단 사유가 아니다.** skill 의 4-step 을 먼저 밟고,
  그래도 안 풀리면 force/reset 을 시도하지 말고 보고하고 멈춘다.
- **push 는 항상 literal SHA refspec 으로 한다.** `HEAD:branch` 는 push 시점의
  `HEAD` 를 올려 race 에 열려 있다.
- **`gh pr close` 에는 반드시 `--delete-branch` 를 붙인다.** stale 로 남은 head
  ref 가 같은 작업의 다음 spawn 을 push reject 로 튕긴다.
- **push reject 를 "외부 race" 로 진단하지 않는다.** 거의 100% 본인의
  fetch+reset 또는 pull 이 진범이다.

## 책임 주체 — Assistant 직접 실행

TDD / 구현 / 버그 fix 완료 시 agent 가 직접 commit + push + PR + review + merge
자율 실행. 사용자에게 "이제 커밋해 주세요" 안내 금지 (사용자 2026-05-16 lock).

- 자율 범위 / 예외 / spawn 패턴: [delivery](../delivery/memory.md)
- 본 정책은 자율 실행의 조건 — 우회 금지와 hard block 은 아무도 막지 않으므로
  agent 가 스스로 지킨다.

## push 결과 확인 · stash 취급

- 파이프(`git push | tail` 등)는 실패 exit code 를 삼킨다 — 성공 보고 전에
  `git ls-remote origin <branch>` 로 원격 SHA 를 대조해 확인한다.
- **`git stash push` 는 저장할 게 없어도 exit 0 이다** ("No local changes to
  save"). exit 1 은 매칭 안 되는 pathspec 과 초기 커밋 없는 repo 에서만 나므로,
  저장 여부를 exit code 로 못 가른다. 아무것도 안 쌓였는데 무조건 `stash pop`
  하면 스택 맨 위의 남의 옛 entry 가 나온다 — `stash push` 전후로
  `git stash list | wc -l` 을 대조해 실제로 쌓였는지 확인하고, pop 은
  `stash@{N}` 으로 대상을 명시한다.

## 관련

- [recovering-push-rejects](../../../.agents/skills/recovering-push-rejects/SKILL.md)
  — 이 계약을 지키는 명령 시퀀스 (4-step · SHA refspec · stale ref)
- [ADR 0044](../../../docs/decisions/0044-e2e-smoke-remote-required/memory.md) —
  E2E smoke remote PR/main blocking check
- [ADR 0019](../../../docs/decisions/0019-e2e-pre-push-not-ci/memory.md) /
  [ADR 0020](../../../docs/decisions/0020-e2e-pre-push-host-docker/memory.md) —
  superseded 된 pre-push e2e 정책
- [delivery](../delivery/memory.md) — 자율 pipeline
- [worktree](../../runbook/worktree/memory.md) — 사본 격리 lifecycle, 같은
  무집행 상태
