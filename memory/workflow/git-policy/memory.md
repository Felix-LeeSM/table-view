---
title: Git 정책 — hook 회피 절대 금지
type: workflow-rule
updated: 2026-05-18
task: commit, push, hook, lefthook
trigger:
  signal: git commit / git push / hook 실패 시
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

## Hook 한계 (sprint-387 명시)

본 hook 은 **부주의 방지** layer. 의도적 우회는 **차단 불가능**:

- 변수 substitution: `CMD="git push --force"; $CMD` — 호출 부에 패턴 없음.
- 문자열 concat: `python -c "import os; os.system('git ' + 'push --force')"`.
- bin alias: `cp $(which git) /tmp/g; /tmp/g push --force`.
- eval split: `eval "git $(printf 'push --force')"`.
- PATH override: `PATH=. fakegit push origin main --force`.

차단 가능:

- 평문 명령 / `bash -c "..."` 안의 평문 / `$(echo ...)` 안의 평문 / alias 정의
  본문 / heredoc / nohup / background.

따라서 hook 통과 = 안전 보장이 아니라 "agent 가 *자기도 모르게* 위반하지
않는다" 보장. 정책 (본 문서) + 사람 / agent 의 commit 메시지 + git log 가
최종 source of truth.

## Worktree 동작 (sprint-387 검증)

- `.claude/settings.json` 의 hook command: `"$CLAUDE_PROJECT_DIR"/.claude/hooks/pre-bash.sh`
- `$CLAUDE_PROJECT_DIR` 는 worktree root 의 절대 경로 → worktree 사본의
  hook 호출 → worktree 사본의 `scripts/hooks/check-dangerous-bash.sh` 실행.
- worktree 는 git checkout 으로 두 파일 모두 보유 → 격리된 worktree 에서도
  동일 차단.
- `.claude/settings.local.json` 만 worktree 별 다를 수 있음 (gitignored).
  hook 정의는 tracked `settings.json` 이라 worktree 간 drift 없음.

## Hook 실패 시 — 회피 X, 근본 fix

- **포맷 실패** → `cargo fmt` / `npx prettier --write` 재실행
- **린트 실패** → 경고 수정. `// eslint-disable-next-line` 은 분명한 사유 +
  코멘트와 함께만.
- **테스트 실패** → 테스트 옳다면 코드 수정. 테스트 틀렸으면 테스트 수정 +
  ADR/sprint 코멘트.
- **e2e cold-boot timeout** → `e2e/_helpers.ts` timeout, `wdio.conf.ts` mocha
  timeout, `scripts/e2e-host.sh` docker daemon/psql 사전조건 확인.

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

## 관련

- ADR 0019 — E2E 를 CI 에서 pre-push 로 이동
- ADR 0020 — pre-push e2e 는 host docker 한정 (tauri-driver macOS 미지원)
- `scripts/hooks/check-dangerous-bash.sh` — 차단 패턴 (platform-neutral)
- `.claude/hooks/pre-bash.sh` — Claude Code wrapper
- `lefthook.yml` — hook 정의
- [delivery](../delivery/memory.md) — 자율 pipeline
- `.claude/agents/delivery.md` — enforce agent
