# Sprint 205 — Contract

Sprint: `sprint-205` (refactor — `catch {}` audit + 사유 주석 정합).
Date: 2026-05-05.
Type: refactor (행동 변경 0; audit + 주석 추가만).

[`docs/PLAN.md`](../../PLAN.md) Sprint 205 row + [`/CODE_SMELLS.md`](../../../CODE_SMELLS.md) §4 / 부록 A.
짧은 sprint. silent `catch {}` 37곳 audit + 분류 + 주석 누락된 13곳에 사유 한 줄 추가.

## 배경

CODE_SMELLS §4 의 본질: silent `catch {}` 가 (a) 너무 광범위하게 퍼져
있고 (b) "정상적 silent vs DEV-log 필요" 구분이 코드에서 보이지 않음.
즉시 통일된 `localStorage` helper 도입은 별도 sprint (Sprint 209+ 후보)
로 미루고, 본 sprint 는 audit + 사유 주석으로 *의도가 명시되어 있는지*
만 보장한다.

## Sprint 안에서 끝낼 단위

### audit 분류 frame

각 silent `catch {}` 를 4 카테고리로 분류:

- **A** — silent OK, 사유 주석 **있음**. 변경 없음.
- **A'** — silent OK, 사유 주석 **없음**. 한 줄 주석 추가.
- **B** — best-effort, DEV-log 권장. `logger.warn` 추가.
- **C** — silent 가 잘못 — surface to user / logger 필요. 변경 적용.

### audit 결과 (37곳)

| 카테고리 | 갯수 | 처리 |
|----------|------|------|
| A (주석 있음) | 24 | 변경 없음 |
| A' (주석 없음) | 13 | 사유 주석 한 줄 추가 |
| B (DEV-log 권장) | 0 | — |
| C (잘못 silent) | 0 | — |

본 audit 의 결론: silent 37곳 모두 정상적 fallback (localStorage 환경
부재 / `JSON.parse` 실패 / `JSON.stringify` 순환 참조 / `TextDecoder`
fatal / `clipboard.writeText` 권한 / `view.focus()` jsdom 한계 / Tauri
runtime 부재 / `verify` best-effort / `cancel` race 등). DEV 에서 log
가 더 필요한 case 0건.

### A' 13곳 — 주석 추가

| # | 파일 | 라인 | 컨텍스트 | 추가 사유 |
|---|------|------|----------|-----------|
| 1 | `src/stores/favoritesStore.ts` | 41 | `loadPersistedFavorites` `JSON.parse` fallback | localStorage 비어있거나 손상 — 빈 array 로 시작 |
| 2 | `src/stores/mruStore.ts` | 81 | `loadPersistedMruList` outer try | localStorage 환경 부재 — 빈 list 로 시작 |
| 3 | `src/lib/themeBoot.ts` | 59 | `readStoredState` `JSON.parse` fallback | 손상 / 환경 부재 — DEFAULT_STATE 로 복귀 |
| 4 | `src/lib/window-label.ts` | 46 | `getCurrentWebviewWindow()` 실패 | Tauri runtime 부재 (vitest jsdom) — null 반환 |
| 5 | `src/types/connection.ts` | 245 | URL parse 실패 | 입력이 URL 아님 — null 반환, caller 가 다른 경로 시도 |
| 6 | `src/components/datagrid/CellDetailDialog.tsx` | 25 | `JSON.stringify` fallback | 순환 참조 객체 — `String(value)` 으로 fallback |
| 7 | `src/components/datagrid/BlobViewerDialog.tsx` | 70 | `TextDecoder` fatal mode | 비-UTF8 byte sequence — null 반환, hex pane 만 표시 |
| 8 | `src/components/connection/ConnectionGroup.tsx` | 45 | `loadCollapsedState` localStorage fallback | 환경 부재 / 손상 — 빈 state 로 시작 |
| 9 | `src/components/layout/Sidebar.tsx` | 33 | `readWidth` localStorage fallback | 환경 부재 — DEFAULT_WIDTH 로 복귀 |
| 10 | `src/components/shared/BsonTreeViewer.tsx` | 42 | `canonicalStringify` JSON.stringify fallback | 순환 참조 — `String(value)` 으로 fallback |
| 11 | `src/components/shared/BsonTreeViewer.tsx` | 139 | `copyToClipboard` writeText | 권한 거부 / 환경 부재 — false 반환, caller 가 toast 처리 |
| 12 | `src/components/shared/QuickLookPanel.tsx` | 61 | `JSON.stringify` fallback | 순환 참조 — `String(value)` 으로 fallback |
| 13 | `src/components/shared/QuickLookPanel.tsx` | 70 | `JSON.parse` fallback | 보관된 문자열이 JSON 아님 — `String(value)` 으로 fallback |

각 주석은 한 줄 / 두 줄, 형식: `// <사유 — silent 의도적>` 또는 동등
한 표현. 기존 24곳 (A) 의 주석 톤과 일치.

## Acceptance Criteria

### AC-205-01 — 13곳 주석 보강

- 위 13곳 모두 `catch {` 다음 줄 사이에 사유 한 줄 주석 존재.
- audit table 의 사유 표현이 코드 주석과 *대응* (의역 OK, 의미 일치).

### AC-205-02 — 잔존 silent `catch {}` 0 (주석 누락)

- `grep -rnE "} catch \{\s*$" src/` (즉 `catch {` 직후 빈 줄 / 닫는 괄호
  바로 오는 패턴) → 0 match. (주석 / 코드 라인 둘 중 하나는 있음).

### AC-205-03 — 회귀 0

- 전체 vitest baseline 통과 (Sprint 204 baseline = 189 files / 2732 tests).
- `pnpm tsc --noEmit` exit 0.
- `pnpm lint` exit 0.

## Out of scope

- **localStorage 접근 helper 통일** — CODE_SMELLS §4 개선 방향의 큰
  변경. 별도 sprint (Sprint 209+ 후보). audit 결과 17곳이 `localStorage`
  접근, 7곳이 `JSON.parse/stringify` fallback — helper 도입 시 의미 있는
  단위.
- **DEV-only telemetry 추가** — logger 가 단일 fan-out 진입점이지만 본
  sprint 는 console wrapper 까지 (Sprint 204).
- **`catch (e)` 의 audit** — 본 sprint 는 silent (`catch {}`) 만 처리.
  parametric catch 는 logger / toast / state 처리가 일반적.

## 검증 명령

```sh
pnpm tsc --noEmit
pnpm lint
pnpm vitest run
grep -rnE "} catch \{\s*$" --include="*.ts" --include="*.tsx" src/ | grep -v "\.test\." | grep -v "__tests__"
```

기대값: tsc 0 / lint 0 / vitest 189 files 2732 tests pass / silent 빈
catch 0 match.
