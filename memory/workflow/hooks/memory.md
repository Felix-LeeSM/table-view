---
name: Hook validation gate principle
description: Hook은 read-only 검증 게이트다. 세부 판정은 hook script와 테스트가 source of truth다.
type: workflow-rule
updated: 2026-05-27
task: hook-design, lefthook, pre-push, pre-commit, verification-gate
trigger:
  signal: hook script 작성 / lefthook step 추가 / hook 실패 분석 시
  layer: index
---

# Hook validation gate principle

Hook memory는 hook의 판정표를 저장하지 않는다. Hook은 항상 실행되어 stdout/stderr와
exit code로 피드백하므로, 세부 판정은 hook script와 테스트가 source of truth다.

## 원칙

- Hook은 read-only validation gate다.
- Hook은 현재 state를 검사하고 PASS/FAIL과 actionable diagnostic만 반환한다.
- Hook은 repository state를 수정하지 않는다.
- Hook은 실패를 고치지 않는다. 실패 후 수정은 agent/user의 다음 작업이다.
- pass/fail 패턴은 `scripts/hooks/*`, `lefthook.yml`, hook tests에 둔다. memory에는
  복제하지 않는다.
- Formatter/fix step은 validation hook이 아니라 명시적 formatter step으로만 허용하며,
  범위와 동작은 `lefthook.yml`이 source of truth다.

## 읽을 때

- 새 hook을 만들거나 hook step을 추가할 때.
- hook 안에서 state repair나 automatic cleanup을 넣고 싶어질 때.
- hook 실패 메시지를 바꾸거나 hook test를 작성할 때.

## 관련

- `scripts/hooks/README.md`
- `lefthook.yml`
- [git-policy](../git-policy/memory.md) — hook 회피 금지
- [review](../review/memory.md) — hook/CI는 자동 검증 layer
