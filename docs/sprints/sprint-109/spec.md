# Sprint 109: Structure SQL Preview syntax highlight (#STRUCT-2)

**Source**: `docs/ui-evaluation-results.md` #STRUCT-2
**Depends on**: —
**Verification Profile**: browser

## Goal

Structure SQL Preview 가 plain text 로 표시되어 가독성이 낮은 문제를 syntax highlight 적용으로 해결한다.

## Acceptance Criteria

1. Structure SQL Preview 가 syntax highlight 적용된 렌더(`SqlSyntax` 또는 codemirror static) 로 표시된다.
2. 키워드/문자열/주석/식별자 색상이 테마 토큰을 사용한다.
3. SQL Preview 의 복사/실행 버튼 동작은 회귀 없이 유지된다.
4. 기존 SqlPreviewDialog 테스트 회귀 0.

## Components to Create/Modify

- `src/components/structure/SqlPreviewDialog.tsx`: syntax highlight 렌더.
- 관련 테스트.
