# Sprint 205 — Findings

silent `catch {}` 37곳 audit + 분류 + 주석 누락 13곳 보강. 행동 변경 0.

## §1 — audit 결과

37곳 분류:

| 카테고리 | 갯수 | 처리 |
|----------|------|------|
| A (silent OK, 사유 주석 있음) | 24 | 변경 없음 |
| A' (silent OK, 사유 주석 없음) | 13 | 사유 한 줄 추가 |
| B (DEV-log 권장) | 0 | — |
| C (잘못 silent — surface 필요) | 0 | — |

본 audit 의 근거: silent 37곳 모두 fallback path 가 명확하고 (return
default / null / empty / String(...) / 빈 set 등), 사용자 facing
영향은 toast 또는 caller 의 다른 경로로 이미 처리. DEV log 가 더 필요한
case 0건.

## §2 — 카테고리별 패턴

A / A' 의 silent 37곳 패턴 (중복 가능):

| 패턴 | 갯수 | 예시 |
|------|------|------|
| `localStorage` 환경 부재 / 손상 | 13 | tabStore:162/858, favoritesStore:31/41, mruStore:41/72/81/178, session-storage:41/61/72, themeBoot:59, ConnectionGroup:45, Sidebar:33/112 |
| `JSON.parse` / `JSON.stringify` fallback | 7 | favoritesStore:41, themeBoot:59, ConnectionGroup:45, ImportExportDialog:234, CellDetailDialog:25, BsonTreeViewer:42, QuickLookPanel:61/70 |
| Tauri runtime 부재 (vitest jsdom) | 4 | window-label:46, mruStore:166, favoritesStore:161, window-controls:81/95 |
| schemaStore optimistic mutation refresh | 3 | schemaStore:282/313/366 |
| Performance API 부재 / 한계 | 3 | bootInstrumentation:75/106/113 |
| `JSON.parse` URL / connection-string fallback | 1 | types/connection.ts:245 |
| `TextDecoder` fatal mode | 1 | BlobViewerDialog:70 |
| Clipboard 권한 / 환경 | 1 | BsonTreeViewer:139 |
| `view.focus()` jsdom | 1 | AddDocumentModal:212 |
| Verify-best-effort (Sprint 132 contract) | 1 | queryHelpers:110 |
| Outer guard | 1 | queryHelpers:125 |
| Cancel race | 1 | useQueryExecution:178 |
| Export toast 이미 처리 | 1 | ExportButton:63 |
| Test reset | 1 | mruStore:178 |

**중복**: `localStorage` 환경 부재 + `JSON.parse` fallback 가 같은 catch 안에
공존 (예: favoritesStore:41).

## §3 — A' 13곳 — 적용된 주석

| # | 파일 | 라인 | 주석 |
|---|------|------|------|
| 1 | `src/stores/favoritesStore.ts` | 41 | `localStorage entry corrupted or unavailable — start fresh.` |
| 2 | `src/stores/mruStore.ts` | 81 | `localStorage unavailable (SSR / private mode) — start with empty list.` |
| 3 | `src/lib/themeBoot.ts` | 59 | `localStorage unavailable or stored value malformed — fall back to defaults.` |
| 4 | `src/lib/window-label.ts` | 46 | `Tauri runtime unavailable (vitest jsdom) — caller falls back to launcher.` |
| 5 | `src/types/connection.ts` | 245 | `Input is not a parseable URL — caller will try other connection-string forms.` |
| 6 | `src/components/datagrid/CellDetailDialog.tsx` | 25 | `Object has cycles or non-serializable members — fall back to String().` |
| 7 | `src/components/datagrid/BlobViewerDialog.tsx` | 70 | `Bytes are not valid UTF-8 — caller renders only the hex pane.` |
| 8 | `src/components/connection/ConnectionGroup.tsx` | 45 | `localStorage unavailable or value corrupted — start with no collapse state.` |
| 9 | `src/components/layout/Sidebar.tsx` | 33 | `localStorage unavailable — fall back to the default sidebar width.` |
| 10 | `src/components/shared/BsonTreeViewer.tsx` | 42 | `Value has cycles — fall back to String() so the tree still renders.` |
| 11 | `src/components/shared/BsonTreeViewer.tsx` | 139 | `Clipboard permission denied or unavailable — caller surfaces a toast.` |
| 12 | `src/components/shared/QuickLookPanel.tsx` | 61 | `Value has cycles — fall back to String().` |
| 13 | `src/components/shared/QuickLookPanel.tsx` | 70 | `String didn't parse as JSON — render verbatim.` |

## §4 — 검증 결과

| 항목 | 결과 |
|------|------|
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm vitest run` | 189 files / 2732 tests pass |
| silent `catch { <빈 줄> }` grep | 0 match |

baseline: Sprint 204 = 189 files / 2732 tests. 회귀 0.

## §5 — Out-of-scope

- **localStorage helper 통일** (CODE_SMELLS §4 개선 방향): `localStorage`
  환경 부재 fallback 13곳, `JSON.parse` fallback 7곳 — 도합 17곳 (중복
  포함) 이 동일 패턴 ("localStorage 접근 + JSON.parse + fallback").
  helper 도입 시 의미 있는 단위 — 별도 sprint candidate (Sprint 209+).
- **`catch (e)` audit**: 본 sprint 는 silent (`catch {}`) 만 처리.
  parametric catch 54곳은 logger / toast / error state 처리가 일반적.
- **DEV-only telemetry**: logger 가 진입점이지만 본 sprint 는 audit +
  주석까지.

## §6 — CODE_SMELLS §4 처리

audit 결과로 §4 의 본질 ("정상적 silent vs DEV-log 필요 구분") 은
*의도가 코드 주석에서 보이는가* 로 환원. 13곳 주석 보강으로 모든 silent
가 사유와 함께 명시됨. CODE_SMELLS §4 처리 완료. 다만 같은 fallback 패턴
의 광범위 분산 (특히 localStorage 17곳) 은 helper 통일이 후속 작업으로
유효 — Sprint 209+ candidate.
