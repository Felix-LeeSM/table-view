---
title: Git 정책
type: workflow-rule
updated: 2026-08-01
task: commit, push, signing, push-reject, pr-close, race-trace
keywords: non-fast-forward, push reject, force-push, --no-verify, --no-gpg-sign, FETCH_HEAD, ORIG_HEAD, update-ref, ls-remote, stale ref, pinentry, gpg failed, exit code, 파이프, stash, stash pop
trigger:
  signal: git commit / git push / push reject / PR close 시
  layer: none — 집행 훅 없음, 규율만
---

# Git 정책

이 파일이 git 정책의 **유일한 SOT** 다 — 절차, 근거, 차단 목록 전부.

**집행 장치는 없다.** 아래 금지 항목을 **아무도 막지 않는다** — 실행되기 전에
스스로 멈춰야 한다. 이 방은 `CLAUDE.md` → `AGENTS.md` import 를 타고 오는 포인터를
보고 직접 열어야 닿는다.

## 절대 금지 — 검증 우회

**`git commit --no-verify` / `git push --no-verify` 어떤 상황에서도 사용 금지.**
**`--no-gpg-sign` / `commit.gpgsign=false` 등 signing 우회도 금지.**

### Why

- push 직전 로컬 검증은 **`lefthook.yml` 의 pre-push 훅이 전부다** — 그 파일의
  `pre-push.jobs` 가 목록의 SOT 이고, 지금 걸린 것은 `biome check .
  --error-on-warnings` (포맷 + 일반 lint, 전체 트리), push 대상 변경 파일 한정
  `eslint --quiet` (repo 고유 가드), 그리고 manifest 마다 도는
  `cargo fmt --manifest-path <manifest> --check`. `--no-verify` 는 통째로 끈다.
- 나머지 — `cargo clippy -D warnings`, `cargo test`, vitest, 커버리지 —
  는 여전히 **CI 에서만 돈다.** 깨진 코드를 push 하면 CI 에서 처음 드러난다.
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

- 포맷 실패 → `pnpm format` (= `biome format --write .`) / rust 는 `pnpm format:rust`
  — 맨 `cargo fmt` 는 루트에 `Cargo.toml` 이 없어 실패한다. manifest 경로는 그 스크립트에 있다.
- 린트 실패 → 경고 수정. 억제는 사유 코멘트와 함께만 —
  일반 규칙은 `biome-ignore`, repo 고유 가드는 `eslint-disable`.
- 테스트 실패 → 코드 수정 또는 (테스트가 틀렸으면) 테스트 + ADR 수정.
- e2e timeout → `e2e/smoke/_helpers.ts` + `wdio.smoke.conf.ts` timeout, docker daemon 확인.
- GPG pinentry timeout → 즉시 중단. 사용자에게 signing cache warm-up 필요를
  보고하고 unsigned commit 으로 진행하지 않음.

## Hard block — 승인으로도 우회 불가

아래는 사용자 승인 요청 대상이 아니라 **수행 금지**다. **이 목록이 SOT 이고
집행자는 agent 자신이다** — 차단하는 장치는 없다.

- `git commit --no-verify` / `git push --no-verify`
- `--no-gpg-sign` / `commit.gpgsign=false`
- `git push --force` / `--force-with-lease` 등 force-push 전 변종
- `git reset --hard` 의 remote-upstream target 형(아래 fetch/reset/pull 절)
- 소스/앱 자산을 지우는 destructive command (`rm -rf` 로 트래킹 파일 제거 등)

긴급 복구도 hard-block 명령을 승인으로 우회하지 말고 사용자와 합의해 정책 자체를
바꾸고 여기에 기록한다. GPG signing 불가 시 unsigned commit 으로 진행하지 않는다.

## 책임 주체 — Assistant 직접 실행

TDD / 구현 / 버그 fix 완료 시 agent 가 직접 commit + push + PR + review +
merge 자율 실행. 사용자에게 "이제 커밋해 주세요" 안내 금지 (사용자 2026-05-16
lock).

- 자율 범위 / 예외 / spawn 패턴: [delivery](../delivery/memory.md)
- 본 정책은 자율 실행의 조건 — 우회 금지와 hard block 은 아무도 막지 않으므로
  agent 가 스스로 지킨다.

## 외부 race 가짜 신호 (sprint-402)

push reject / 알 수 없는 remote SHA 를 "외부
race" (다른 작업자 / 다른 brain 의 동시 push) 로 오인하는 사례 = 거의 100%
**본인 (agent) 의 fetch + reset 또는 pull 자체가 진범**. 즉, race 가
_감지되는 시점_ 에는 이미 본인 명령이 원인. 외부 race 가설은 가짜 신호.

실제 진단: push reject 시 reflog (`git reflog --all`) 의 직전 entry 가 본인
commit 인지 확인 → 거의 항상 yes. 그렇다면 외부 race 아님, _본인의 fetch +
reset 으로 ref 가 옮겨진 결과_ 의 push reject.

## Push reject 응급 처치 (sprint-389, sprint-402 update)

push 가 non-fast-forward 로 튕겼을 때 **절대** `git reset --hard FETCH_HEAD`
/ `git pull --rebase` 하지 말 것 — 본인 commit wipe 또는 silent rebase.
금지 대상 — 시퀀스로 쓰든 두 단계로 쪼개 쓰든 같다. race-trace 가 그 2 단계
분리를 push reject 의 진범으로 확정했다:

- `git reset --hard FETCH_HEAD` / `ORIG_HEAD` / `@{u}` / `origin/<branch>`
  / `refs/remotes/<...>`
- `git pull` 모든 변종 (`--rebase`, `origin <branch>` 포함)

막아 주는 장치는 없다. 위 명령이 손에 떠오르면 그 자체가 진단 신호다 —
아래 4-step 으로 간다.

### 회복 정답 (4-step)

1. **remote 상태 진단**

   ```bash
   git ls-remote origin <branch>     # remote 의 SHA 확인
   ```

2. **본인 reflog 의 직전 commit SHA 확인**

   ```bash
   git reflog                         # 직전 본인 commit SHA 찾기
   ```

3. **ref 만 본인 SHA 로 fix** — working tree / index / commit 보존:

   ```bash
   git update-ref refs/heads/<branch> <local-sha>
   ```

4. **SHA refspec push inline** — race 발생해도 의도한 commit 만 올라감:

   ```bash
   SHA="$(git rev-parse HEAD)"
   git push origin "$SHA":refs/heads/<branch>
   ```

closed-PR stale ref 가 의심되면 (PR close 시 `--delete-branch` 누락):
`gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>` 후 재시도.
여전히 안 풀리면 force/reset 을 시도하지 말고 상황 보고 후 별도
복구 절차를 합의한다.

## PR close cleanup (sprint-389)

`gh pr close` 시 **반드시** `--delete-branch` 동반. closed-PR 의 head ref 가
remote 에 stale 로 남으면, 같은 작업이 재 spawn 될 때 새 branch 의 SHA 와
non-fast-forward 충돌 → push reject. 누락을 경고해 주는 것은 없다.

```bash
gh pr close <N> --delete-branch --comment "<reason>"
```

### 재 spawn 시 stale ref 검증

새 사본(clone) / 새 branch 작업 시작 전:

```bash
# remote 에 같은 branch ref 가 살아있는지 검사
git ls-remote origin <branch>

# stale 발견 시 삭제
gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>
```

## SHA refspec push 패턴 (sprint-389)

agent 가 작업 중에 새 commit 을 만든 뒤 push 하기 직전에 _다른_ 에이전트
세션이 같은 branch 에 push 해버리는 race 가 가능. 이 race 를 막기 위한
SHA refspec push 패턴:

```bash
git rev-parse HEAD                                          # 1) 로컬 SHA 확보
git push origin '<literal-sha>':'refs/heads/<branch-name>'  # 2) literal SHA → branch
```

### Why

- `git push origin HEAD:branch` 는 push 시점 `HEAD` 가 무엇이든 거기를
  올림 → race 발생 가능.
- literal SHA 를 명시하면 SHA-to-ref mapping 이 결정적 — race 발생해도
  의도한 commit 만 올라가고, 그 사이 새 commit 이 추가됐다면 push 가
  자동으로 reject (non-fast-forward) → 사용자가 진단 가능.

### zsh `:r` 모디파이어 trap

zsh 는 word 안의 `:` 를 modifier 로 해석 → `<sha>:refs/heads/foo` 가
깨짐. **single-quote escape 필수** (bash 에선 무해): `git push origin
'abc1234':'refs/heads/feat/foo'`.

## push 결과 확인 · stash 취급

- 파이프(`git push | tail` 등)는 실패 exit code 를 삼킨다 — 성공 보고 전에
  `git ls-remote origin <branch>` 로 원격 SHA 를 대조해 확인한다.
- **`git stash push` 는 저장할 게 없어도 exit 0 이다** ("No local changes to save").
  exit 1 은 매칭 안 되는 pathspec 과 초기 커밋 없는 repo 에서만 나므로, 저장
  여부를 exit code 로 못 가른다. 아무것도 안 쌓였는데 무조건 `stash pop` 하면 스택
  맨 위의 남의 옛 entry 가 나온다 — `stash push` 전후로 `git stash list | wc -l`
  을 대조해 실제로 쌓였는지 확인하고, pop 은 `stash@{N}` 으로 대상을 명시한다.

## 관련

- [ADR 0044](../../../docs/decisions/0044-e2e-smoke-remote-required/memory.md) — E2E smoke remote PR/main blocking check
- [ADR 0019](../../../docs/decisions/0019-e2e-pre-push-not-ci/memory.md) / [ADR 0020](../../../docs/decisions/0020-e2e-pre-push-host-docker/memory.md) — superseded 된 pre-push e2e 정책
- [delivery](../delivery/memory.md) — 자율 pipeline
- [worktree](../../runbook/worktree/memory.md) — 사본 격리 lifecycle, 같은 무집행 상태
