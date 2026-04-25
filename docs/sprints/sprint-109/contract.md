# Sprint Contract: sprint-109

## Summary
- Goal: Structure SqlPreviewDialog 의 plain `<pre>` 블록을 syntax-highlighted 렌더로 교체. 키워드/문자열/주석/식별자 색상은 테마 토큰 (`text-syntax-keyword`, `text-syntax-string` 등 — 기존 `SqlSyntax` 컴포넌트 사용).
- Profile: `command`

## In Scope
- `src/components/structure/SqlPreviewDialog.tsx`:
  - import `SqlSyntax` (`@components/shared/SqlSyntax`).
  - `preview` prop 의 `<pre>` 안 텍스트를 `<SqlSyntax sql={sql} />` 로 교체. 단, sql 비어있을 때 placeholder "-- No changes to preview" 는 muted-foreground italic 으로 노출 (현재 `<pre>` 의 기본 색).
  - 외부 컨테이너 (`<pre>` 또는 `<div>`) 는 스크롤/배경/border 유지.
- 테스트:
  - `SqlPreviewDialog.test.tsx` (있으면 갱신, 없으면 신규):
    - sql 에 `CREATE TABLE` 포함 시 `text-syntax-keyword` 클래스 적용된 span 존재.
    - sql 비어있을 때 placeholder 텍스트 노출.
    - 기존 onConfirm/onCancel 동작 회귀.

## Out of Scope
- CodeMirror 통합 (read-only).
- MQL preview syntax highlight (별도 sprint).
- 색상 토큰 자체 변경.

## Invariants
- 회귀 0 (1792 통과 유지).
- PreviewDialog 의 props (title/description/error/commitError/onConfirm/onCancel) 동일.
- DDL preview 의 데이터 흐름 (props.sql) 변경 금지.

## Acceptance Criteria
- AC-01: sql="CREATE TABLE foo (id INT);" 입력 시 dialog body 에 `text-syntax-keyword` 클래스 가진 span 존재.
- AC-02: sql="" → 기존 "-- No changes to preview" 메시지 표시.
- AC-03: onConfirm/onCancel 콜백 정상 호출.
- AC-04: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass + AC-01..04 evidence in handoff.md.
