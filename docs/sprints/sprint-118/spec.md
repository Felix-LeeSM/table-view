# Sprint 118: Mongo 용어 정합성 — column/row → field/document (#PAR-2)

**Source**: `docs/ui-evaluation-results.md` #PAR-2
**Depends on**: —
**Verification Profile**: browser

## Goal

MongoDB 컬렉션 탭/도큐먼트 그리드에 RDB 용어("column", "row")가 노출되어 있는 부분을 "field"/"document" 로 교체해 paradigm 정합성을 확보한다.

## Acceptance Criteria

1. MongoDB 컬렉션 탭/도큐먼트 그리드에서 "column"/"row" 표기가 "field"/"document" 로 교체된다.
2. 빈 상태/에러 상태/페이지네이션 라벨도 일관되게 "document" 용어를 사용한다.
3. RDB 탭은 영향을 받지 않는다.
4. 기존 document UI 테스트 회귀 0 (문구 단언이 갱신).

## Components to Create/Modify

- 도큐먼트 paradigm UI 텍스트: column/row 용어 정합성.
- 관련 테스트.
