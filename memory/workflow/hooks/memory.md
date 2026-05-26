---
name: Git hook — ref mutation 금지 (read-only verification)
description: Hook script 는 검증 only. ref mutation (fetch/reset/push 등) 금지 — 부수효과 cascade + 자살 trigger.
type: workflow-rule
updated: 2026-05-26
task: hook, hook-design, lefthook, pre-push, pre-commit, race-trace, destructive-action
surface: lefthook.yml, scripts/hooks/check-dangerous-bash.sh, scripts/hooks/pre-push-path-router.sh, scripts/hooks/test-pre-push-path-router.sh, scripts/worktree-spawn.sh, scripts/hooks/test-worktree-push-ref-safety.sh
trigger:
  signal: hook script 작성 / lefthook step 추가 / pre-push 차단 동작 분석 시
  layer: agent-prompt
---

# Git hook 작성 룰 — Read-only verification

## 핵심 룰

**Hook script (pre-commit / pre-push / commit-msg / post-*) 안에서 git ref
mutation 명령 금지.**

Destructive action 은 prompt 정책보다 hook/blocking script 로 먼저 막는다. Prompt 는
2차 reminder 이고, 실질 enforcement 는 hook 이다. Hook 으로 잡기 어려운 intentional
우회는 git log/PR review/user review 에서 다룬다.

차단 대상:
- `git fetch`, `git pull`, `git remote update`
- `git reset --hard`, `git reset --keep`, `git reset --merge`
- `git push`, `git push --force`
- `git checkout <other-branch>`, `git switch <other-branch>`
- `git branch -D / -d / -m / -c`, `git update-ref`
- `git tag`, `git rebase`, `git cherry-pick`, `git am`, `git apply`
- `git stash` (working tree 변형)

허용:
- Read-only inspection: `git rev-parse`, `git log`, `git ls-tree`,
  `git diff --cached`, `git merge-base`, `git for-each-ref` 등
- **Working-tree mutation by formatter** (industry standard 예외):
  `prettier --write {staged_files}` + `eslint --fix {staged_files}` +
  lefthook 의 `stage_fixed: true`. 이는 *pre-commit 단계의 의도된
  side-effect* — ref 영향 X, staged file 만 수정 후 자동 재 stage.

## Why

Hook 은 *검증 게이트*. 의무:
- **Idempotent**: 여러 번 호출해도 결과 같아야
- **Side-effect free**: ref / remote / FETCH_HEAD / working-tree 변경 X
- **Read-only**: 현재 state 만 inspection 후 PASS/FAIL 판단

Hook 안 mutation 의 부수효과 cascade:
- 예 (실제 발생, 2026-05-19): `scripts/hooks/check-tdd-cycle.sh:62` 의
  `git fetch --quiet origin main` 이 매 push 마다 `.git/FETCH_HEAD` 를
  origin/main 의 head 로 갱신 → 그 직후 외부 process 의
  `git reset --hard FETCH_HEAD` 호출 시 → sprint branch 가 origin/main 의
  squash-commit 으로 강제 reset → push 한 commit 이 ref 에서 사라진 듯한
  자살 패턴.
- 본 fetch 가 *자살의 연료* 제공. read-only `git merge-base` 로 교체 후
  부수효과 차단 (PR #41, 2026-05-19).
- 예 (실제 발생, 2026-05-21): pre-push `cargo-deny` 가 advisory DB 갱신 중
  nested Git 을 실행했고 hook 의 outer repo Git-local env 를 상속했다. nested
  Git 이 outer worktree metadata 를 바라보며 `reset: moving to FETCH_HEAD` 를
  만들었다. hook 안에서 nested Git 을 실행할 수 있는 도구는
  `unset $(git rev-parse --local-env-vars)` 후 실행한다.
- PreToolUse bash guard 는 부주의 방지 layer 다. 따옴표/괄호/절대경로 안의
  위험 git token 도 잡도록 command anchor 는 `(^|[^a-zA-Z0-9_])` 류의
  punctuation-safe 경계로 테스트한다. string concat / variable substitution /
  PATH override 같은 의도적 우회는 hook 이 아니라 PR review / git log / user
  review 에서 다룬다.
- pre-push path router 는 비용 최적화 layer 이지만, signed commit / TDD-cycle
  guard 는 항상 실행한다. docs-only 만 heavy stack 을 생략하고, hook/workflow/
  unknown/new-branch/rename/delete 는 fail-open to full stack 으로 처리한다.

## How to apply

### 새 hook step 추가 시 체크리스트

1. `grep -E 'git (fetch|reset|push|checkout|switch|branch|update-ref|tag|rebase|cherry-pick|am|apply|stash)' <script>` — ref mutation 자가 검출
2. 발견 시 read-only 대체 검토:
   - `git fetch origin <branch>` → `git merge-base HEAD origin/<branch>` 또는 local mirror 사용
   - `git pull` → hook 안에서는 절대 불필요. user task 로 분리
   - `git reset` → 검증 단계에서 reset 필요한 시나리오 없음
   - nested Git 도구 (`cargo deny`, package manager, advisory DB updater 등)
     → `unset $(git rev-parse --local-env-vars)` 로 outer repo env 차단
3. Formatter 외 working-tree mutation 도 의심 — staged file 변형이 *의도된
   pre-commit 패턴* 인지 확인. 의도 외면 제거.
4. path routing 을 추가하면 old path + new path 를 모두 classification input 으로
   쓰고, unknown 은 full stack 으로 보낸다.

### 기존 hook audit (2026-05-19, lefthook.yml + scripts/ 전수)

| Hook step | Mutation | 분류 |
|---|---|---|
| pre-commit/ts-format | `prettier --write` + `stage_fixed: true` | 의도된 formatter (예외) |
| pre-commit/ts-lint | `eslint --fix` + `stage_fixed: true` | 의도된 formatter (예외) |
| pre-push/7_check-tdd-cycle | (former) `git fetch origin main` | ★ Anti-pattern, PR #41 에서 제거 |
| 그 외 모든 step | none | read-only |

## 관련

- `memory/workflow/git-policy/memory.md` — hook *회피* 금지 (agent 행동 룰).
  본 룰은 hook *작성자* 관점.
- `scripts/hooks/check-tdd-cycle.sh` — hook design 의 적용 사례 (PR #41 에서
  fetch 제거).
- `scripts/hooks/check-dangerous-bash.sh` — PreToolUse hook. agent 의 reset
  명령 차단.
- auto-memory `diag/race-trace` — 자살 패턴의 진단 history.
