# Sprint Contract: sprint-113

## Summary
- Goal: themes.css 의 모든 [data-theme][data-mode] 블록 × 6 principal foreground/background 페어에 대해 WCAG AA 4.5:1 대비 검증을 자동화. brand-color 절충은 allowlist 로 추적, 신규 위반은 CI fail.
- Profile: `command`

## In Scope
- `scripts/check-theme-contrast.ts`: themes.css 파싱 + WCAG luminance / contrast 계산 + allowlist 매칭 + stale detection.
- `scripts/theme-contrast-allowlist.json`: 64개 brand-color 절충 entry baseline.
- vitest 단위 테스트 (스크립트 helpers).
- `pnpm contrast:check` 명령 + CI Frontend job step 추가.

## Out of Scope
- 기존 brand color 팔레트 수정.
- AA Large (3:1) 또는 AAA (7:1) 검증.
- `--tv-muted-foreground` (의도적 저대비).

## Invariants
- 1799 baseline tests 회귀 0.
- tsc/lint 0.
- 신규 테마/색 추가 시 자동 검증 흐름 (allowlist 비교 + stale detection).

## Acceptance Criteria
- AC-01: `pnpm contrast:check` 가 미달 시 exit 1.
- AC-02: CI Frontend job 에 contrast:check step 포함.
- AC-03: 미달 시 어떤 theme/mode/pair 인지 명확히 출력.
- AC-04: parseThemes 가 themes.css 의 [data-theme][data-mode] 블록을 동적 수집 → 신규 테마 추가 시 자동 포함.

## Verification Plan
1. `pnpm contrast:check` (현재 상태: 0 new, 64 allowlisted).
2. `pnpm vitest run` (1799 → 1815).
3. `pnpm tsc --noEmit`.
4. `pnpm lint`.

## Exit Criteria
- All checks pass + AC-01..04 evidence in handoff.md.
