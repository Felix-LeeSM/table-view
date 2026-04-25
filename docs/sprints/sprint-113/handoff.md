# Sprint 113 → next Handoff

## Sprint 113 Result
- **PASS** (직접 적용, 1 attempt) — 1815/1815 tests, tsc/lint 0, contrast:check 0 new violations.

## 산출물
- `scripts/check-theme-contrast.ts`: themes.css 파싱 + WCAG AA 4.5:1 검증 + allowlist + stale detection. exported helpers (`parseHex`, `relLuminance`, `contrastRatio`, `parseThemes`, `check`, `entryKey`, `AA_THRESHOLD`) + thin CLI wrapper.
- `scripts/theme-contrast-allowlist.json`: 64개 brand-color 절충 entry 캡처. policy/schema/reason 메타데이터 포함.
- `scripts/__tests__/check-theme-contrast.test.ts`: 16개 단위 테스트 (parseHex, contrastRatio, parseThemes, check 의 4 개 시나리오: 실 themes.css 0 위반, 신규 위반 검출, allowlist 흡수, stale 검출, 미정의 pair 무시, AA_THRESHOLD 상수, entryKey).
- `package.json`: `pnpm contrast:check` 명령 추가.
- `.github/workflows/ci.yml`: Frontend job 의 `Test` 와 `Build` 사이에 `Theme contrast (WCAG AA)` 단계 추가.

## AC Coverage
- AC-01: `pnpm contrast:check` exit 1 with `[NEW]` 메시지가 미달 entry 시 출력. 단위 테스트 (`flags a NEW violation when allowlist is empty`) 가 검증.
- AC-02: CI Frontend job 에 `Theme contrast (WCAG AA)` 단계 포함 — 36+ 테마 추가/색 변경 시 즉시 가시화.
- AC-03: 신규 위반 시 `[NEW] {theme}/{mode} — {pair}: {fg} on {bg} = {ratio}:1` 포맷으로 출력 (script line 198-202). stale entry 도 별도 표시.
- AC-04: themes.css 의 `[data-theme="X"][data-mode="Y"]` 블록을 정규식으로 동적 수집 (parseThemes). 신규 테마 추가 시 자동 포함. 단위 테스트가 72 테마 × 2 모드 = 144 블록 캡처를 단언.

## 검증
- `pnpm contrast:check`: `72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted)`.
- `pnpm vitest run`: 1815/1815 (1799 baseline → +16 contrast tests).
- `pnpm tsc --noEmit`: 0.
- `pnpm lint`: 0.

## 메모
- 64 allowlist entry 는 모두 "primary button" 페어 (white text on brand color: Stripe purple, MongoDB green, Spotify, NVIDIA, etc.). body/card/popover/secondary/accent text 는 모두 AA 통과.
- 향후 brand-color 수정 또는 darker primary-foreground 도입으로 allowlist 가 줄어들면 stale detection 이 강제 정리.
