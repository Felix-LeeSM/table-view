# Sprint Contract: sprint-111

## Summary
- Goal: FavoritesPanel 의 고정 `w-80 max-h-96` 을 viewport 비율 기반 가변 크기 (`w-[clamp(20rem,32vw,32rem)]` + `max-h-[60vh]`) 로 변경. 각 favorite 의 sql preview 에 `title={fav.sql}` 추가해 hover tooltip.
- Profile: `command`

## In Scope
- `src/components/query/FavoritesPanel.tsx`:
  - line 39 root `<div>` className: `w-80 max-h-96` → `w-[clamp(20rem,32vw,32rem)] max-h-[min(60vh,40rem)]`. min/max 폭은 320px ~ 512px, 높이는 60vh ~ 640px.
  - line 88 Button `<Button>`: `aria-label` 외에 `title={fav.name + " — " + fav.sql}` 도 추가 (또는 sql preview 부분에 별도 title). 더 간결하게: line 112 `<div>` 에 `title={fav.sql}`. 이름은 line 97 `<span>` 의 `title={fav.name}` 도 추가 (truncate 보호).
  - 이름 line 97 `<span>` 에 `title={fav.name}` 추가.
- 테스트:
  - panel root 가 `w-[clamp(20rem,32vw,32rem)]` 와 `max-h-[min(60vh,40rem)]` 를 보유.
  - sql preview `<div>` 의 `title` = `fav.sql`.
  - 이름 `<span>` 의 `title` = `fav.name`.
  - 빈 / 다수 favorites 회귀.

## Out of Scope
- 사용자 드래그 리사이즈 핸들.
- shadcn Tooltip 컴포넌트 도입.
- 컬럼/리스트 정렬.

## Invariants
- 회귀 0 (1797 통과 유지).
- onLoadSql / onClose 동작 유지.
- 빈 상태/다수 상태 모두 렌더 정상.

## Acceptance Criteria
- AC-01: 패널 root 의 className 에 `w-[clamp(20rem,32vw,32rem)]` 포함, `max-h-[min(60vh,40rem)]` 포함, `w-80` 또는 `max-h-96` 미포함.
- AC-02: sql preview `<div>` 의 `title` 속성 = `fav.sql`.
- AC-03: 이름 `<span>` 의 `title` 속성 = `fav.name`.
- AC-04: 빈 상태 ("No favorites yet") 렌더.
- AC-05: 다수 favorites 렌더 (각 `Load favorite: …` aria-label).
- AC-06: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass + AC-01..06 evidence in handoff.md.
