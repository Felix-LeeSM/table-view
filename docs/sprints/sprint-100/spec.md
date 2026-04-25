# Sprint 100: 다중 statement 결과 분리 (P1 #10)

**Source**: `docs/ui-evaluation-results.md` P1 #10
**Depends on**: —
**Verification Profile**: mixed

## Goal

쿼리 편집기 다중 statement 실행 결과를 statement 별 탭/리스트로 보여주어, 각 statement 의 verb/rows/ms/Pass-Fail 을 사용자가 식별할 수 있게 한다.

## Acceptance Criteria

1. 다중 statement 실행 시 결과 영역이 statement 별 탭/섹션으로 분리되며 각 statement 의 verb/rows/ms/Pass-Fail 이 노출된다.
2. 부분 실패 시 실패 statement 인덱스 + 에러 메시지가 강조된다.
3. 단일 statement 실행 시 기존 단일 결과 그리드 동작 회귀 0.
4. 결과 탭 간 전환이 키보드(좌/우 화살표)로 가능하다.

## Components to Create/Modify

- `src/components/query/QueryResultGrid.tsx` 또는 `src/components/query/QueryTab.tsx`: 다중 statement 결과 분리.
- 관련 테스트.
