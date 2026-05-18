---
title: Git 정책 — hook 회피 절대 금지 + 능동 enforcement
type: workflow-rule
updated: 2026-05-17
task: commit, push, hook, lefthook, push-reject, pr-close
trigger:
  signal: git commit / git push / hook 실패 / push reject / PR close 시
  layer: hook (.claude/hooks/pre-bash.sh + scripts/hooks/check-dangerous-bash.sh)
---

# Git 정책

`.claude/rules/git-policy.md` wrapper 가 가리키는 source. 모든 brain (Claude
Code / Codex / Cursor) 에 같은 룰 적용.

## 절대 금지 — Hook 회피

**`git commit --no-verify` / `git push --no-verify` 어떤 상황에서도 사용 금지.**
**환경 변수 `LEFTHOOK=0`, `LEFTHOOK_SKIP=...`, `HUSKY=0` 등 hook 비활성화도 금지.**

### Why

- pre-commit (`cargo fmt`, `cargo clippy -D warnings`, `prettier`, `eslint`,
  secret scan) = 품질 기준선.
- pre-push (`cargo test`, `npm run test`, `npm run lint`, `cargo check`,
  **e2e**) = 회귀 가드.
- ADR 0019 (2026-05-01) 이후 e2e 는 CI 에서 제거 → pre-push 가 유일한
  e2e 게이트. hook 우회 시 회귀가 production 빌드에 직접 반영.

## 강제 메커니즘 (2 레이어)

1. **Bash PreToolUse hook** — `scripts/hooks/check-dangerous-bash.sh` 의
   `DANGEROUS_PATTERNS` 에 `--no-verify`, `LEFTHOOK=0` 등록. `git commit` /
   `git push` 명령은 lefthook 바이너리 + git hook 파일 존재 확인
   (`check_git_hooks`).
2. **본 정책 문서** — 사람 / agent 모두 명문화 룰.

## Hook 한계 + Worktree (sprint-387)

본 hook 은 **부주의 방지** layer. 의도적 우회 (변수 substitution / 문자열
concat / bin alias / eval split / PATH override) 는 **차단 불가능** — hook
통과 = "agent 가 자기도 모르게 위반하지 않는다" 보장만. 정책 (본 문서) +
git log 가 최종 source of truth.

차단 가능 케이스: 평문 명령 / `bash -c "..."` 안 평문 / `$(echo ...)` 안 평문
/ alias 정의 본문 / heredoc / nohup / background.

Worktree: `$CLAUDE_PROJECT_DIR` 가 worktree root 절대경로 → worktree 사본의
`scripts/hooks/check-dangerous-bash.sh` 가 호출됨. tracked `settings.json` 만
hook 정의 → worktree drift 없음.

## Hook 실패 시 — 회피 X, 근본 fix

- 포맷 실패 → `cargo fmt` / `npx prettier --write`.
- 린트 실패 → 경고 수정. `eslint-disable` 은 사유 코멘트와 함께만.
- 테스트 실패 → 코드 수정 또는 (테스트가 틀렸으면) 테스트 + ADR 수정.
- e2e timeout → `e2e/_helpers.ts` + `wdio.conf.ts` timeout, docker daemon 확인.

## 예외 — 사용자 명시 승인 시만

다음 2 경우 한정, 사용자가 채팅에서 명시적 `--no-verify 써` / `hook 건너뛰어`
지시했을 때:

1. CI 에서 이미 검증된 머지 커밋 백포팅 (revert, cherry-pick 충돌 해결).
2. 시스템 장애 복구 (hook 자체 손상 + `lefthook install` 메타 커밋).

이 경우에도:
- (a) 회피 사유 commit body 에 1줄 기록
- (b) 후속 커밋에서 회피한 검사를 통과시키는 변경 push
- (c) `memory/lessons/` 에 사유 기록

## 책임 주체 — Assistant 직접 실행

TDD / 구현 / 버그 fix 완료 시 agent 가 직접 commit + push + PR + review +
merge 자율 실행. 사용자에게 "이제 커밋해 주세요" 안내 금지 (사용자 2026-05-16
lock).

- 자율 범위 / 예외 / spawn 패턴: [delivery](../delivery/memory.md)
- 본 정책 (hook 회피 금지) 은 자율 실행의 조건 — hook 통과 안 되면 commit/
  push 자체 안 됨. agent 가 hook 실패 회피 시도 = 본 정책 위반.

## Push reject 응급 처치 (sprint-389)

push 가 non-fast-forward 로 튕겼을 때 **절대** 즉시 `git reset --hard
FETCH_HEAD` 하지 말 것 — 본인 commit 을 wipe 하는 destructive 행동.
hook (`check-dangerous-bash.sh`) 가 이제 차단 메시지에 본 sequence 를 직접
출력함 (능동 enforcement, sprint-389).

### 4-step 진단 + 회복

1. **remote 상태부터 확인**

   ```bash
   git ls-remote origin <branch>
   ```

   결과의 SHA 가 local `HEAD` 와 다르면 → 누가 / 무엇이 다른가 파악.

2. **closed-PR 의 stale head ref 인 경우** — `gh pr close <N>` 가
   `--delete-branch` 없이 호출되어 remote 에 ref 가 남아있을 때:

   ```bash
   gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>
   ```

   이후 다시 `git push origin <branch>` 시도. (예방: PR close cleanup 절.)

3. **legit non-fast-forward** — 다른 작업자가 같은 branch 에 push:

   ```bash
   git pull --rebase origin <branch>
   # 충돌 해결 후
   git push origin <branch>
   ```

4. **본인 commit 보존하면서 ref 만 옮길 때** — `git reset --hard` 가 정말
   필요한 것 같으면 한 단계 부드러운 옵션부터:

   ```bash
   git reset --soft <sha>   # working tree 보존
   git stash                 # 작업 보호
   ```

   여전히 hard 가 필요하다고 판단되면 **사용자 승인 후** 진행.

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

agent 가 작업 중에 새 commit 을 만든 뒤 push 하기 직전에 *다른* 에이전트
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
"sha 의 root extension 제거 + refs/heads/foo" 로 변환되어 깨짐.
**single-quote 로 escape 필수**:

```bash
git push origin 'abc1234':'refs/heads/feat/foo'   # OK
git push origin abc1234:refs/heads/feat/foo       # zsh 에서 깨짐
```

bash 에서는 위 quote 가 무해 (no-op) → cross-shell 호환 위해 항상 single-quote.

## 관련

- ADR 0019 — E2E 를 CI 에서 pre-push 로 이동
- ADR 0020 — pre-push e2e 는 host docker 한정 (tauri-driver macOS 미지원)
- `scripts/hooks/check-dangerous-bash.sh` — 차단 패턴 (platform-neutral)
- `.claude/hooks/pre-bash.sh` — Claude Code wrapper
- `lefthook.yml` — hook 정의
- [delivery](../delivery/memory.md) — 자율 pipeline
- `.claude/agents/delivery.md` — enforce agent
