---
title: Git 정책 — hook 회피 절대 금지 + 능동 enforcement
type: workflow-rule
updated: 2026-05-20
task: commit, push, hook, lefthook, push-reject, pr-close, race-trace
trigger:
  signal: git commit / git push / hook 실패 / push reject / PR close 시
  layer: hook (.claude/settings.json + scripts/hooks/check-dangerous-bash.sh)
---

# Git 정책

`.claude/rules/git-policy.md` wrapper 가 가리키는 source. 모든 brain (Claude
Code / Codex / Cursor) 에 같은 룰 적용.

## 절대 금지 — Hook 회피

**`git commit --no-verify` / `git push --no-verify` 어떤 상황에서도 사용 금지.**
**`--no-gpg-sign` / `commit.gpgsign=false` 등 signing 우회도 금지.**
**환경 변수 `LEFTHOOK=0`, `LEFTHOOK_SKIP=...`, `HUSKY=0` 등 hook 비활성화도 금지.**

### Why

- pre-commit (`cargo fmt`, `cargo clippy -D warnings`, `prettier`, `eslint`,
  secret scan) = 품질 기준선.
- pre-push (`cargo test`, `npm run test`, `npm run lint`, `cargo check`) =
  로컬 회귀 가드.
- ADR 0044 (2026-05-20) 이후 runtime e2e smoke 는 GitHub Actions
  PR/main blocking check 가 source of truth. hook 우회 시 로컬 가드가
  빠지므로 여전히 production 빌드 위험으로 간주한다.

## 강제 메커니즘 (2 레이어)

1. **Bash PreToolUse hook** — `scripts/hooks/check-dangerous-bash.sh` 의
   `DANGEROUS_PATTERNS` 에 `--no-verify`, `--no-gpg-sign`, `LEFTHOOK=0`
   등록. `git commit` / `git push` 는 lefthook 바이너리 + hook 파일 확인.
2. **본 정책 문서** — 사람 / agent 모두 명문화 룰.

## Hook 한계 + Worktree (sprint-387)

본 hook 은 **부주의 방지** layer. 변수 substitution / 문자열 concat / bin
alias / PATH override 같은 의도적 우회는 **차단 불가능** — hook 통과 =
"agent 가 자기도 모르게 위반하지 않는다" 보장만. 정책 (본 문서) + git log 가
최종 source of truth.

차단 가능 케이스: 평문 명령 / `bash -c "..."` 안 평문 / `$(echo ...)` 안 평문
/ alias 정의 본문 / heredoc / nohup / background / `base64 -d | bash` 류 script-smuggling / `eval $(...)` / remote-upstream target-only `git reset/checkout`.

Worktree: `$CLAUDE_PROJECT_DIR` 가 worktree root 절대경로 → worktree 사본의
`scripts/hooks/check-dangerous-bash.sh` 가 호출됨. tracked `settings.json` 만
hook 정의 → worktree drift 없음.

## Hook 실패 시 — 회피 X, 근본 fix

- 포맷 실패 → `cargo fmt` / `npx prettier --write`.
- 린트 실패 → 경고 수정. `eslint-disable` 은 사유 코멘트와 함께만.
- 테스트 실패 → 코드 수정 또는 (테스트가 틀렸으면) 테스트 + ADR 수정.
- e2e timeout → `e2e/_helpers.ts` + `wdio.conf.ts` timeout, docker daemon 확인.
- GPG pinentry timeout → 즉시 중단. 사용자에게 signing cache warm-up 필요를
  보고하고 unsigned commit 으로 진행하지 않음.

## 예외 — 사용자 명시 승인 시만

다음 2 경우 한정, 사용자가 채팅에서 명시적 `--no-verify 써` / `hook 건너뛰어`
지시했을 때:

1. CI 에서 이미 검증된 머지 커밋 백포팅 (revert, cherry-pick 충돌 해결).
2. 시스템 장애 복구 (hook 자체 손상 + `lefthook install` 메타 커밋).

이 경우에도:

- (a) 회피 사유 commit body 에 1줄 기록
- (b) 후속 커밋에서 회피한 검사를 통과시키는 변경 push
- (c) `docs/archives/incidents/` 에 사유 기록

GPG signing 우회는 위 예외에 포함하지 않음. signing 불가 시 멈춤.

## 책임 주체 — Assistant 직접 실행

TDD / 구현 / 버그 fix 완료 시 agent 가 직접 commit + push + PR + review +
merge 자율 실행. 사용자에게 "이제 커밋해 주세요" 안내 금지 (사용자 2026-05-16
lock).

- 자율 범위 / 예외 / spawn 패턴: [delivery](../delivery/memory.md)
- 본 정책 (hook 회피 금지) 은 자율 실행의 조건 — hook 통과 안 되면 commit/
  push 자체 안 됨. agent 가 hook 실패 회피 시도 = 본 정책 위반.

## 외부 race 가짜 신호 (sprint-402)

`diag/race-trace` agent 결과: push reject / 알 수 없는 remote SHA 를 "외부
race" (다른 작업자 / 다른 brain 의 동시 push) 로 오인하는 사례 = 거의 100%
**본인 (agent) 의 fetch + reset 또는 pull 자체가 진범**. 즉, race 가
_감지되는 시점_ 에는 이미 본인 명령이 원인. 외부 race 가설은 가짜 신호.

실제 진단: push reject 시 reflog (`git reflog --all`) 의 직전 entry 가 본인
commit 인지 확인 → 거의 항상 yes. 그렇다면 외부 race 아님, _본인의 fetch +
reset 으로 ref 가 옮겨진 결과_ 의 push reject.

## Push reject 응급 처치 (sprint-389, sprint-402 update)

push 가 non-fast-forward 로 튕겼을 때 **절대** `git reset --hard FETCH_HEAD`
/ `git pull --rebase` 하지 말 것 — 본인 commit wipe 또는 silent rebase.
sprint-402 부터 hook 이 다음 단독 명령도 모두 block (이전엔 `git fetch &&
git reset --hard FETCH_HEAD` sequence 만 차단 → agent 가 2 단계 분리로
우회 → race-trace 가 진범 확정):

- `git reset --hard FETCH_HEAD` / `ORIG_HEAD` / `@{u}` / `origin/<branch>`
  / `refs/remotes/<...>`
- `git pull` 모든 변종 (`--rebase`, `origin <branch>` 포함)

agent 는 위 명령 _어느 것으로도_ 본 hook 우회 불가능 — single-cmd 도 block.

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
여전히 안 풀리면 **사용자 승인 요청**.

## PR close cleanup (sprint-389)

`gh pr close` 시 **반드시** `--delete-branch` 동반. closed-PR 의 head ref 가
remote 에 stale 로 남으면, 같은 sprint 가 재 spawn 될 때 새 branch 의 SHA 와
non-fast-forward 충돌 → push reject. hook 이 본 호출을 detection 해 stderr
WARNING 출력 (block 아님, exit 0).

```bash
gh pr close <N> --delete-branch --comment "<reason>"
```

### 재 spawn 시 stale ref 검증

새 worktree / 새 branch 작업 시작 전:

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

## 관련

- ADR 0044 — E2E smoke remote PR/main blocking check
- ADR 0019 / 0020 — superseded 된 pre-push e2e 정책
- `scripts/hooks/check-dangerous-bash.sh` — 차단 패턴 (platform-neutral)
- `.claude/settings.json` — Claude Code hook wrapper
- `lefthook.yml` — hook 정의
- [delivery](../delivery/memory.md) — 자율 pipeline
- `.claude/agents/delivery.md` — enforce agent
