# Sprint 124 → Handoff

## Sprint 124 Result

- **PASS** — e2e 시나리오 갭 분석 + 새 spec 추가 (`paradigm-and-shortcuts.spec.ts`).
  - vitest 1882/1882 pass (회귀 0)
  - tsc 0, lint 0
  - 25 → 28 active e2e tests (+3)

## 산출물

- **NEW** `e2e/paradigm-and-shortcuts.spec.ts` — 3 시나리오:
  1. **Sprint 123 negative paradigm guard (RDB)** — 활성 PG 테이블 탭의 TabBar tablist 안에 `[aria-label*="MongoDB"]` 가 0 개임을 단언. Leaf 마커가 RDB 로 누출되는 회귀를 잡음.
  2. **Sprint 103 keyboard cheatsheet** — `pressCtrl("/")` (5회 retry) → `"Keyboard shortcuts"` 헤더 노출 + `[aria-label="Search shortcuts"]` 검색 입력 visible. `?` (Shift+/) 는 editable-target guard 가 있어 pressCtrl 경로만 e2e 커버.
  3. **Sprint 100 multi-statement TabsList** — 새 query tab 에 `SELECT 1 AS a; SELECT 2 AS b;` 입력 → `[role="tablist"][aria-label="Statement results"]` 노출, `[role="tab"]` 트리거 정확히 2 개, 각 트리거의 `data-status="success"`.

- **NEW** `docs/sprints/sprint-124/findings.md` — sprint 88-123 산출물 대비 e2e 갭 표 + sprint 124 스코프 결정 + 미포함 이유.

## 갭 분석 결론

CI e2e 잡은 PG only — MongoDB-only sprint 산출물 (101, 121, 122, 일부 123) 은 e2e 직접 커버 불가. PG 환경에서 e2e 가능한 회귀 가드 중 가장 가치-위험비 높은 3 개 (sprint 100/103/123) 만 추가. 나머지 갭 (sprint 97/98/99/104/106/107/109/119) 은 단위 테스트 레벨에서 이미 강력히 커버되거나 (sprint 106), seed 변경/복잡한 셋업이 필요해 (sprint 99/119) 이번 sprint 스코프에서 의도적 제외 — `findings.md` 에 명시.

## 검증 명령 결과

- `pnpm test` → 112 files / **1882/1882 pass** (sprint-123 baseline 유지).
- `pnpm tsc --noEmit` → exit 0 (root `tsconfig.json` 은 `src` 만 include — e2e 는 wdio 가 런타임에 `tsx` 로 transpile).
- `pnpm lint` → exit 0 (eslint 가 e2e/ 도 lint 함, `paradigm-and-shortcuts.spec.ts` 무경고).

## 패턴 일치성

새 spec 의 모든 helper / 호출 패턴은 기존 e2e 와 동일:

| 패턴 | 기존 spec | 새 spec |
|---|---|---|
| `import { expect } from "@wdio/globals"` | data-grid, raw-query, ... | ✓ |
| `ensureConnectionsMode` / `ensureConnected` | data-grid, schema-tree, raw-query | ✓ (재구현) |
| `pressCtrl(key)` via `browser.execute` + `KeyboardEvent` | keyboard-shortcuts | ✓ (재구현) |
| Top-level `$$(selector)` 스코핑 | data-grid (`[role="tablist"][aria-label="Open connections"] [role="tab"]`) | ✓ |
| `waitForDisplayed` + retry loop for race | keyboard-shortcuts (pressUntilDialog) | ✓ |
| `clear → type → run` for query input | data-grid, raw-query (`Cmd+A` → `Delete` → text → `Run query`) | ✓ |

## 다음 단계

- [ ] git push origin main → CI 4 개 잡 (frontend / rust / integration / e2e) 모니터링.
- [ ] e2e 실패 시 (가장 가능성 높음: tauri-driver 환경 race), 후속 sprint 에서 retry/지연 폭 조정.
