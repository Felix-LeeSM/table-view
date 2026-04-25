# Sprint 111 → next Handoff

## Sprint 111 Result
- **PASS** (직접 적용, 1 attempt) — 1799/1799 tests, tsc/lint 0.

## 산출물
- `src/components/query/FavoritesPanel.tsx`:
  - root `<div>` className: `w-80 max-h-96` → `w-[clamp(20rem,32vw,32rem)] max-h-[min(60vh,40rem)]`.
  - 이름 `<span>` 에 `title={fav.name}` 추가.
  - sql preview `<div>` 에 `title={fav.sql}` 추가.
- `src/components/query/FavoritesPanel.test.tsx`: 2개 신규 케이스 (panel sizing + title tooltip).

## AC Coverage
- AC-01: root className 단언 (clamp + min(vh,rem) 포함, 고정 80/96 미포함).
- AC-02: sql `<div>` `title` = fav.sql.
- AC-03: 이름 `<span>` `title` = fav.name.
- AC-04: 기존 "No favorites yet" 케이스 회귀 통과.
- AC-05: 기존 다수 favorites 케이스 회귀 통과.
- AC-06: 1797 → 1799 (회귀 0).
