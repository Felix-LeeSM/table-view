# Sprint 92: ConnectionDialog Test 슬롯 안정화 (#CONN-DIALOG-6)

**Source**: `docs/ui-evaluation-results.md` #CONN-DIALOG-6
**Depends on**: sprint-88
**Verification Profile**: command

## Goal

Test Connection 버튼 연타 시 alert 영역이 unmount/remount 되며 다이얼로그 높이가 점프하는 현상을 제거한다. alert 슬롯은 항시 마운트, `testResult` 를 idle/pending/success/error 4-state 로 모델링, pending 시 스피너+"Testing…" 표시.

## Acceptance Criteria

1. ConnectionDialog 오픈 직후, Test 버튼 클릭 직후, 응답 도착 후 세 시점 모두에서 alert 슬롯 selector (`[data-slot="test-feedback"]` 또는 등가) 가 동일한 DOM 노드 identity 를 유지한다 (sprint 88 `expectNodeStable` 헬퍼로 단언).
2. Test 버튼 3회 연속 클릭 시 alert 영역의 `offsetHeight` 가 클릭 사이에 동일하다 (높이 점프 0).
3. testing 중에는 alert 슬롯 안에 스피너 + "Testing..." 텍스트가 노출된다.
4. Test 결과 상태 모델이 `idle | pending | success | error` 4-state 로 명시적이다 (`null` 만 사용하지 않음).
5. 기존 ConnectionDialog 테스트 happy path (성공/실패 alert 표시) 회귀 0.

## Components to Create/Modify

- `src/components/connection/ConnectionDialog.tsx`: alert 영역 항시 마운트 (`min-h` reserve), testResult state 4-state 화, `handleTest` 가 pending 상태 먼저 발행 후 응답으로 전이.
- `src/components/connection/ConnectionDialog.test.tsx`: `expectNodeStable` 단언, 높이 불변 단언, pending state 단언 추가.

## Edge Cases

- 테스트 연타로 인한 race — alert 슬롯 stable + 마지막 응답만 상태 반영.
