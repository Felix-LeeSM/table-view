# Sprint 124 — E2E 갭 분석 (sprint 88-123 산출물 대비)

## 컨텍스트

`/Users/felix/Desktop/study/view-table/.github/workflows/ci.yml` 의 `e2e` 잡은
PostgreSQL 컨테이너만 띄움. MongoDB 미가용 → MongoDB-only sprint 산출물은
e2e 직접 커버 불가.

| Spec 파일 | active | skip | 커버 영역 |
|---|---|---|---|
| `app.spec.ts` | 7 | 0 | smoke (title, sidebar mode, theme toggle, resize handle) |
| `connection.spec.ts` | 3 | 0 | PG 연결 생성 → connect → query tab 오픈 |
| `data-grid.spec.ts` | 6 | 0 | 테이블 클릭 → grid, conn name in header, tab color, Format btn, SELECT 실행, tab close |
| `import-export.spec.ts` | 4 | 0 | dialog smoke, generate JSON (no passwords), uncheck excludes, paste import |
| `keyboard-shortcuts.spec.ts` | 2 | 0 | Cmd+N (New Conn), Cmd+P (Quick Open) |
| `raw-query-edit.spec.ts` | 2 | 1 | Read-only banner, cell detail dialog |
| `schema-tree.spec.ts` | 5 | 3 | 카테고리 expand, table list, highlight, search filter, no match |

## 갭 (PG-only CI 에서 e2e 가능한 항목만)

| Sprint | 산출물 | 현재 e2e? | 비고 |
|---|---|---|---|
| 97 | tab dirty 가드 (Discard unsaved changes? 다이얼로그) | ❌ | 셀 편집 트리거 필요 — 복잡, 우선순위 낮음 |
| 98 | Cmd+S 즉시 시각 피드백 + 토스트 | ❌ | 셀 편집 트리거 필요, sprint 97 와 동일 이슈 |
| 99 | DataGrid 빈 상태 분기 (필터 vs 빈 테이블) | ❌ | 빈 테이블 fixture 필요 — CI seed 에 없음 |
| 100 | 다중 statement 결과 분리 (TabsList) | ❌ | **추가 가능 — `SELECT 1; SELECT 2;` 로 검증** |
| 103 | Keyboard cheatsheet (Cmd+/, ?) | ❌ | **추가 가능 — Cmd+/ → "Keyboard shortcuts" 다이얼로그** |
| 104 | input-focus shortcut guard | ❌ | 우회 방식 (dispatchEvent) 와 충돌 — e2e 신뢰도 낮음 |
| 106 | DataGrid roles + aria-rowindex/colindex | ❌ | 단위 테스트 (`DataGridTable.aria-grid.test.tsx`) 가 이미 강력히 커버 — 중복 |
| 107 | F2 rename dialog | ❌ | 우선순위 낮음 |
| 109 | Review SQL syntax highlight | ❌ | UI 흐름 복잡 (Structure → Review) — 우선순위 낮음 |
| 119 | MRU connection policy in EmptyState | ❌ | 복수 연결 + 활성 → 닫기 흐름 — 우선순위 중간 |
| 123 | Paradigm 시각 cue (TabBar Leaf, QueryLog SQL/MQL 뱃지) | ❌ | **negative guard 추가 가능 — RDB 탭에 MongoDB 라벨 부재** |

## 추가 결정 (sprint 124 스코프)

다음 3개 시나리오를 새 spec `paradigm-and-shortcuts.spec.ts` 에 추가:

1. **Sprint 123 RDB 부재 가드** — 활성 RDB 탭에 `[aria-label*="MongoDB"]` 가 존재하지 않음 (Leaf 마커 누출 회귀 방지).
2. **Sprint 103 Keyboard cheatsheet** — Ctrl+/ 키 dispatch → "Keyboard shortcuts" 다이얼로그 노출 + 그룹 헤더 (Tabs/Editing/Navigation/Panels/Misc) 중 최소 하나 visible.
3. **Sprint 100 multi-statement TabsList** — `SELECT 1 AS a; SELECT 2 AS b;` 실행 → `[role="tablist"][aria-label="Statement results"]` + 2 개 `TabsTrigger` 확인.

## 추가 안 한 이유

- **sprint 97/98 (dirty/Cmd+S)** — 셀 편집 트리거가 비결정적 (CodeMirror inside cell, focus 경합). 기존 단위 테스트 + `DataGridTable.test.tsx` / `TabBar.test.tsx` 가 이미 강력 커버.
- **sprint 99 (empty filter)** — CI seed (users/orders/products) 에 빈 테이블 없음. 시나리오 추가 시 seed SQL 수정 필요 → 별도 sprint.
- **sprint 106 (ARIA grid roles)** — `DataGridTable.aria-grid.test.tsx` (jsdom) + `DataGridTable.virtualization.test.tsx` 가 이미 콘텐츠 + 행 인덱스를 커버. e2e 추가는 중복.
- **sprint 119 (MRU EmptyState)** — 시나리오 셋업 비용이 높고 (복수 연결, 닫기 시퀀스), 단위 테스트로 충분히 커버.

## 결론

3 개 새 e2e 시나리오 추가 → 25 → 28 active. CI 환경에서 안정 동작 가능 + sprint 100/103/123 회귀를 브라우저 레벨에서 가드.
