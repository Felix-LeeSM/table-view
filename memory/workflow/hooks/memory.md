---
name: Hook taxonomy — git hooks vs agent hooks
description: Git/verification hook은 read-only gate이고, agent hook은 명시된 formatter/linter 보조를 허용한다.
type: workflow-rule
updated: 2026-05-28
task: hook-design, lefthook, pre-push, pre-commit, verification-gate
trigger:
  signal: hook script 작성 / lefthook step 추가 / hook 실패 분석 시
  layer: index
---

# Hook taxonomy — git hooks vs agent hooks

Hook memory는 hook의 판정표를 저장하지 않는다. Hook은 항상 실행되어 stdout/stderr와
exit code로 피드백하므로, 세부 판정은 hook script와 테스트가 source of truth다.

## 원칙

- **Git / verification hook** (`lefthook.yml`, `.githooks/*`, check scripts):
  read-only validation gate. 현재 state를 검사하고 PASS/FAIL과 actionable
  diagnostic만 반환한다. repository state를 수정하지 않는다.
- **Agent hook** (`.codex/hooks.json`, `.claude/settings.json`): agent 작업 중
  안전장치와 가벼운 품질 보조 layer. Linter/check와 명시된 formatter는 허용한다.
- Formatter/fix step은 숨은 repair가 아니라 명시된 agent post-tool 또는 formatter
  step이어야 한다. 현재 dispatcher는 `scripts/hooks/post-tool-use.sh`다.
- pass/fail 패턴과 formatter 범위는 `scripts/hooks/*`, `lefthook.yml`, hook tests에
  둔다. memory에는 복제하지 않는다.
- Repo path taxonomy 는 `scripts/hooks/path-classifier.sh` 가 source of truth다.
  `pre-push-path-router.sh` 와 `check-main-worktree-source-edit.sh` 는 같은 classifier를
  source 해서 route/guard class drift를 막고, test는 classifier-visible cases를
  같이 고정한다.

## 읽을 때

- 새 hook을 만들거나 hook step을 추가할 때.
- git/verification hook 안에서 state repair나 automatic cleanup을 넣고 싶어질 때.
- agent hook 에 formatter/linter/check를 추가할 때.
- hook 실패 메시지를 바꾸거나 hook test를 작성할 때.

## 관련

- `scripts/hooks/README.md`
- `lefthook.yml`
- [git-policy](../git-policy/memory.md) — hook 회피 금지
- [review](../review/memory.md) — hook/CI는 자동 검증 layer
