# Sprint 170 — E2E `skip()` Inventory Triage (decision frozen)

- **Date**: 2026-04-30
- **Source-of-truth principles**: [`memory/conventions/e2e-scenarios/memory.md`](../../../memory/conventions/e2e-scenarios/memory.md)
- **Trigger**: `e2e/` 의 28개 unconditional `skip()` 부채 정리. P6 (`skip()`은
  부채) 적용.

이 표는 결정 동결물이다. 분류를 바꾸려면 이 sprint 의 후속 sprint 에서 새 ADR/triage
를 추가한다.

---

## 분류 결과 (28 unconditional skip → 4 분류)

### (a) DELETE — e2e 제거, 권위 component test 이미 존재 (8)

| # | spec | 시나리오 | 권위 위치 | 사유 |
|---|---|---|---|---|
| 1 | `schema-tree.spec.ts` | context menu (table) | (component test 신규 필요 — sprint-171에 등록) | tauri-driver 한계 |
| 2 | `schema-tree.spec.ts` | open data tab via context menu | `data-grid.spec.ts` 가 click 경로로 결과 커버 | 결과는 이미 e2e 커버, 컨텍스트 메뉴 자체는 tauri-driver 한계 |
| 3 | `schema-tree.spec.ts` | context menu (schema) Refresh | (component test 신규 필요) | tauri-driver 한계 |
| 4 | `raw-query-edit.spec.ts` | Editable badge | `queryAnalyzer.test.ts`, `EditableQueryResultGrid.test.tsx` | spec 코멘트 명시 |
| 12 | `feedback #3` | MySQL autocomplete | (DBMS 미지원, Phase 17~20 예정) | 재도입 시 신규 spec |
| 22 | `feedback #8` | preview single-click | `SchemaTree.preview.test.tsx`, `tabStore.test.ts` (AC-S136-01/02/03) | spec 코멘트 명시 |
| 23 | `feedback #8` | preview swap | 같음 | 같음 |
| 24 | `feedback #8` | preview pin (double-click) | 같음 | 같음 |
| 25 | `feedback #9` | dirty indicator | `TabBar.test.tsx` AC-01/03/04 + AC-S134-06 (sprint 134) | EVAL 결과 — *완벽 커버*, sprint-134 가 이미 active 와 dirty 분리 검증 |

→ 1, 3 은 권위 component test가 *없어서* 신규 작성이 필요. 분류는 DELETE 이지만
sprint-171 (MOVE 작업) 에 SchemaTree context menu component test 신규 작성이 함께 들어감.

### (b) MOVE — e2e 제거, component test 신규 작성/이전 (9)

| # | spec | 시나리오 | 이전 위치 (제안) |
|---|---|---|---|
| 10 | `feedback #3` | PG autocomplete | `src/components/query/QueryEditor.autocomplete.test.tsx` |
| 11 | `feedback #3` | Mongo autocomplete | 같음 (paradigm 분기) |
| 13 | `feedback #4` | MySQL default user | `src/components/connection/NewConnectionDialog.test.tsx` |
| 14 | `feedback #4` | SQLite form (host/port 숨김) | 같음 |
| 15 | `feedback #4` | MongoDB default user | 같음 |
| 19 | `feedback #5` | plaintext NOT offered | `src/components/import-export/ImportExportDialog.test.tsx` |
| 20 | `feedback #7` | no sprint copy in tooltips | static lint + component (`UI tooltip audit`) |
| 21 | `feedback #7` | schema selection 한 곳 | `src/components/workspace/Workspace.test.tsx` |
| 27 | `feedback #11` | Functions sidebar layout | `src/components/schema/SchemaTree.layout.test.tsx` |

### (c) REVIVE — 진짜 e2e 여정, 본문 작성 (8)

| # | spec | 시나리오 | 흡수 spec / 신규 위치 |
|---|---|---|---|
| 5 | `db-switcher.spec.ts` | PG DB 목록 | 그대로 (본문 작성) |
| 6 | `db-switcher.spec.ts` | Mongo DB 목록 | 그대로 |
| 7 | `raw-query-db-change.spec.ts` | `\c admin` round-trip | 그대로 |
| 9 | `feedback #2` | connection swap from Home | `connection-switch.spec.ts` 흡수 |
| 16 | `feedback #5` | encrypted export round-trip (single + group + password 통합) | `import-export.spec.ts` 흡수, 17/18 흡수 |
| 26 | `feedback #10` | sidebar 행수 정확성 | `schema-tree.spec.ts` 흡수 |
| 28 | `feedback #12` | Mongo db 지속 | `connection-switch.spec.ts` 흡수 |
| 8 | `feedback #1` | Home picker size | `app.spec.ts` 흡수 — RISK-025 resolved (sprint 155 Phase 12 종결, launcher 720x560 / workspace 1280x800), 검증 가능 |

### (d) ENV-GATED (정상, 부채 아님 — 5)

| spec | 게이트 |
|---|---|
| `connection-switch.spec.ts` (suite) | `E2E_MONGO_HOST` |
| `db-switcher.spec.ts` (suite) | `E2E_PG_HOST` ‖ `PGHOST` |
| `raw-query-db-change.spec.ts` (suite) | 같음 |
| `keyboard-shortcuts.spec.ts` Cmd+, | `PGHOST` ‖ `E2E_PG_HOST` |
| `feedback #3` Mongo / `feedback #12` | `E2E_MONGO_HOST` |

---

## 후속 sprint 매핑

- **sprint-170 (현재)** — DELETE 8 + DEFERRED 0 + EVAL 결정 적용. 가벼움.
- **sprint-171** — MOVE 9 + SchemaTree context menu component test 신규 (DELETE #1, #3 의 후속)
- **sprint-172** — REVIVE 8 본문 작성 + CUJ 5 종 디렉토리 정착 (Step 2)
- **sprint-173** — 누락 e2e (셀편집 / preview / 에러 회복) 채움 (Step 3)
- **sprint-174** — 누락 e2e (페이지네이션 / 워크스페이스 라이프) + Step 4 flakiness

---

## 결정 사유 메모

- **#9 dirty indicator EVAL → DELETE**: `TabBar.test.tsx` (AC-01/03/04 sprint 97 +
  AC-S134-06 sprint 134) 이 두 탭 시나리오에서 active-vs-dirty 분리를 정확히
  검증. e2e 추가는 P1 (피라미드) 위반.
- **#1 Home picker size DEFERRED → REVIVE**: RISK-025 가 sprint 155 에 resolved
  되어 launcher (720x560 fixed) / workspace (1280x800 resizable) 가 분리됨.
  검증 사실이 명확해 e2e 가능. sprint-172 에 흡수.
- **DELETE 인데 component test 가 없는 #1, #3 (schema context menu)**: 분류는
  DELETE (e2e 에서는 제거) 지만 sprint-171 작업 항목으로 component test 신규
  작성을 등록한다 — 그래야 P1 (단위 레이어로 강등) 이 실제로 충족된다.

## 후속 sprint 작업 시 이 표를 어떻게 사용하는가

각 후속 sprint 시작 시 이 triage.md 의 해당 항목 (#) 을 인용한다. 분류를
바꾸려면 *새* triage 를 같은 디렉토리 패턴 (`docs/sprints/sprint-N/triage.md`)
으로 만들고 사유를 명시한다.
