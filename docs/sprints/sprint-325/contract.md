# Sprint 325 Contract — Slice H (Field projection dialog)

## Scope

Document grid 의 toolbar 에 "Projection" 버튼 → 다이얼로그.

- columns 의 visible/hidden 과 별도로 **server-side** projection 지정.
- include mode: 선택한 field 만 `{ field: 1 }` 으로 보냄 → `_id` 자동 포함
  (Mongo 기본).
- exclude mode: 선택한 field 만 `{ field: 0 }` 으로 보냄.
- Apply → `findDocuments` body 의 `projection` 으로 wire-up → re-fetch.
- 다이얼로그 안에서 "Clear" → projection 비움 (= no projection).

## Done Criteria

1. `src/components/document/ProjectionDialog.tsx` — RTL 가능한 controlled
   dialog. Props: `open`, `onOpenChange`, `columns`, `initial`, `onApply`,
   `onClear`.
2. include vs exclude 라디오 + per-column checkbox.
3. `useDocumentGridData` 가 `projection?: Record<string, 0 | 1>` 받아 body
   에 전달, dependency 에 추가.
4. DocumentDataGrid 의 toolbar 에 trigger 버튼 + state 통합.
5. ≥ 5 RTL (dialog) + ≥ 2 통합 (grid → fetch projection 전달).
6. tsc / lint / vitest exit 0.

## Out of Scope

- nested-path projection (e.g. `meta.role: 1`). v0 는 top-level only.
- Aggregate 의 `$project` stage (별도 토픽).
- 사용자별 persist (per-collection localStorage 보관) — 후속 sprint.

## Invariants

- 기존 sort / filter / hide-column 회귀 0.
- projection 비어있을 때 (`undefined`) backend 가 모든 field 반환 (기본).

## Verification Plan

- Profile: `command`
- Required checks: scoped vitest + 전체 sweep + tsc + lint
- Evidence: 변경 파일 + 신규 RTL + decisions D-65..D-??
