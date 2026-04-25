# Sprint 104: 입력 중 단축키 차단 (#KEY-1)

**Source**: `docs/ui-evaluation-results.md` #KEY-1
**Depends on**: —
**Verification Profile**: browser

## Goal

INPUT/TEXTAREA 포커스 중 Cmd+I/W/T 등 글로벌 단축키가 발화해 사용자 입력을 가로채는 문제를 단축키 라우터의 일괄 가드로 차단한다.

## Acceptance Criteria

1. INPUT/TEXTAREA 가 포커스인 상태에서 Cmd+I/W/T 가 발화하지 않는다.
2. contenteditable 이 포커스인 경우에도 동일한 가드가 적용된다.
3. 단축키 라우터에서 가드가 일괄 정책으로 구현되며, 신규 단축키 추가 시 자동으로 보호된다.
4. 가드 정책에 대한 단위 테스트가 추가된다.

## Components to Create/Modify

- 단축키 라우터 (글로벌 keydown 핸들러): INPUT/TEXTAREA/contenteditable 가드 일괄.
- 관련 단위 테스트.
