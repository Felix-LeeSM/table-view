# Sprint 102: ColumnsEditor Save 아이콘 교정 (P1 #9)

**Source**: `docs/ui-evaluation-results.md` P1 #9
**Depends on**: —
**Verification Profile**: browser

## Goal

Structure ColumnsEditor 의 Save 버튼 아이콘이 Eye(미리보기 의미) 로 잘못 표시되고 있어 Check (또는 Save 의미 통용 아이콘) 으로 교정한다.

## Acceptance Criteria

1. Structure ColumnsEditor 의 Save 버튼 아이콘이 Eye 가 아닌 Check (또는 Save 의미 통용 아이콘) 이다.
2. aria-label / title 도 "Save" 등 의미에 맞게 갱신된다.
3. 아이콘 변경으로 인한 레이아웃 회귀가 없다.
4. 기존 ColumnsEditor 테스트 회귀 0.

## Components to Create/Modify

- `src/components/structure/ColumnsEditor.tsx`: 아이콘 교체 + aria-label 갱신.
- 관련 테스트.
