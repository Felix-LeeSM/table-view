# 리팩토링 계획 (2026-05-02)

> **Status: 시한부 — Sprint 189–198 전용.** Sprint 198 closure 직후
> retire (`docs/archive/` 이동 또는 삭제). 각 sprint 의 실행 결과는
> 해당 sprint 의 `handoff.md` / `findings.md` 가 source of truth 이며,
> 본 문서는 진입 시점 sequencing 만 책임진다. 진행 중 발견된 smell /
> 결정 변경은 본 문서 갱신이 아니라 해당 sprint findings 에 기록.

`docs/refactoring-smells.md` 의 9 카테고리 스멜을 **다음 10 sprint
(189 ~ 198)** 의 feature work 와 매핑한 sequencing 계획. 리팩토링 그
자체가 목적이 아니라 **곧 손댈 surface 를 정리해 feature work 의 회귀
risk 를 낮추는 것** 이 목적.

본 문서는 **sequence / process** 기준 (어떤 순서로, 어떤 게이트로). 각
sprint 안에서 **코드를 어떻게 작성할지** 의 product 기준은
[`memory/conventions/refactoring/memory.md`](../memory/conventions/refactoring/memory.md)
참고 (B Store 결합도 / D lib·hook 경계 / C Hook API shape / A 분해 boundary).

> **Sprint 명명 규칙** — `memory/conventions/memory.md` 의 "정수 번호만"
> 룰에 따라 모든 sprint 는 `sprint-N` (정수). suffix (`-followup`, `.5`,
> `-prep`) 금지. 부속 ID (FB-*) 는 본문에서 `Sprint N (FB-1b)` 형태로 병기.

---

## 원칙

1. **다음 10 sprint 가 건드릴 surface 만 우선.** 미래 phase 가 닿지 않는
   god file (ConnectionDialog 등) 은 defer.
2. **Just-in-time refactor.** 각 feature sprint 의 첫 commit 을 surface
   정리에 쓰고, 2번째 commit 부터 feature 추가. PR 단위가 "refactor (테스트
   그대로 통과)" + "feature (테스트 추가)" 로 깔끔히 쪼개진다.
3. **별도 refactor-only sprint 는 god surface 2 곳만.** SchemaTree (Sprint
   192 토대), useDataGridEdit (Sprint 194 토대). 나머지는 feature sprint
   의 prep commit 으로 흡수.
4. **Drive-by trivial dedup.** §4.1 BLOB, §4.2 rowKeyFn, §4.3 PAGE_SIZE
   는 어느 sprint 든 통과하는 path 에 한 commit 으로 묶어 처리.
5. **Defer 는 명시적 차단.** 예: ConnectionDialog 분해 / module-load IPC
   bridge attach / `any` 확산 / 초대형 test 파일 분할 — 이 4건은 본 계획
   범위 밖. 후속 10 sprint 어떤 commit 도 이 표면을 건드리지 않음.

---

## 스멜 → Sprint 매핑

| Smell § | 항목 | 처리 sprint | 처리 방식 |
|---------|------|-------------|-----------|
| §4.4 | Safe Mode 게이트 산재 (RDB 5 사이트 inline) | **Sprint 189** | refactor-only sprint. 5 사이트 → `useSafeModeGate`. |
| §4.3 | `DEFAULT_PAGE_SIZE` 중복 (rdb / document grid) | Sprint 189 drive-by | 단일 상수 (`src/lib/grid/policy.ts`) 신설, 두 grid import. |
| §4.1 | `isBlobColumn` 중복 (QuickLookPanel / DataGridTable) | Sprint 193 | `src/lib/db/cellFormat.ts` 로 통합. Quick Look edit 합류 직전 단일화. |
| §4.2 | `rowKeyFn` 중복 (useDataGridEdit / DataGridTable) | Sprint 193 | useDataGridEdit 의 export 만 사용하도록 정리. (Quick Look edit 이 같은 키 규칙을 공유해야 하므로 prep 의 일부.) |
| §2 + §3.1 + §5 + §6 (SchemaTree) | 1963 줄 god + UI 가 `useSchemaStore.setState` 로 캐시 직접 무효화 + `.catch(() => {})` 다수 + exhaustive-deps ignore | **Sprint 191** | (a) 데이터 레이어 hook 추출 (`useSchemaCache` — 로딩/프리패치/무효화), (b) UI 트리는 순수 props 컴포넌트로, (c) `evictSchemaCache` 액션을 store 에 노출, (d) `.catch(() => {})` → `toast.error` + dev console. Sprint 192 (DB 단위 export) 가 sidebar context menu 진입점을 추가하기 직전. |
| §2 + §4.1 + §4.2 (useDataGridEdit) | 1160 줄 dual-paradigm hook | **Sprint 193** | (a) `useDataGridEditRdb` / `useDataGridEditDocument` 로 분기, (b) 공통 인터페이스 (`PendingChange`, `commit()`, `rollback()`) 만 상위 hook 으로 노출, (c) Sprint 194 의 Quick Look edit 합류는 paradigm 별 hook 에 붙는다. |
| §3.1 (QueryTab 직접 setState) + §3.1 (history) | UI 가 `tabStore.setState` 로 queryState/history 직접 교체 | **Sprint 195** | "intent-revealing actions" 추출 — `tabStore.completeQuery(tabId, queryId, result)` / `failQuery(...)` / `recordHistory(tabId, source, ...)`. Sprint 196 의 `source` 필드 추가는 액션 시그니처에만 붙으므로 callsite 변경 최소. |
| §9 (Rust 대형 모듈) | `db/mongodb.rs` 1809줄 / `db/postgres.rs` 3684줄 / `commands/connection.rs` 1710줄 | **Sprint 197** | mongodb.rs 만 우선 — `db/mongodb/{queries,mutations,connection,schema}.rs` 로 4 분할. Sprint 198 (bulk-write 3 신규 command) 가 mutations.rs 에만 추가되도록. postgres.rs / connection.rs 는 Phase 25 이후 별도 결정. |

---

## 시퀀싱 (실행 순서)

| # | Sprint | 종류 | 예상 size | 비고 |
|---|--------|------|-----------|------|
| 1 | **Sprint 189** (Phase 23 closure refactor) | refactor | 1~2 일 | RDB 5 사이트 → `useSafeModeGate`. drive-by: §4.3 `DEFAULT_PAGE_SIZE` 통합 + §8.2 `test-utils.tsx` 채택/제거 결정. |
| 2 | **Sprint 190** (FB-1b) | feature | 1~2 일 | prod-auto SafeMode. SafeModeStore 만 surface — Safe Mode 컨텍스트가 따끈할 때 묶음. |
| 3 | **Sprint 191** (SchemaTree refactor) | refactor | 3~5 일 | SchemaTree 분해 (1963줄 god → `useSchemaCache` hook + 순수 트리 컴포넌트 + `evictSchemaCache` 액션 + `.catch(()=>{})` → toast). Sprint 192 의 sidebar 진입점 추가 토대. |
| 4 | **Sprint 192** (FB-3) | feature | 3~4 일 | DB 단위 export. 정리된 SchemaTree 위에서 sidebar context menu 진입점 + 백엔드 `pg_dump` / `mongodump` shell-out (또는 sqlx COPY). |
| 5 | **Sprint 193** (useDataGridEdit refactor) | refactor | 2~3 일 | `useDataGridEdit` 분해 (1160줄 dual-paradigm → RDB / Document hook 분기) + §4.1 `isBlobColumn` dedup + §4.2 `rowKeyFn` 단일화. Sprint 194 의 Quick Look 합류 토대. |
| 6 | **Sprint 194** (FB-4) | feature | 2~3 일 | Quick Look 편집 모드 — paradigm 별 hook 에 합류. |
| 7 | **Sprint 195** (tabStore refactor) | drive-by | 0.5~1 일 | `tabStore` intent-revealing actions 추출 (`completeQuery` / `failQuery` / `recordHistory`). 액션 시그니처에 `source` 자리 마련. |
| 8 | **Sprint 196** (FB-5b) | feature | 1~2 일 | query history `source` 필드 — 액션 시그니처에 인자만 추가, callsite 변경 최소. |
| 9 | **Sprint 197** (mongodb.rs split) | refactor | 0.5 일 | `db/mongodb.rs` 4분할 (`{queries, mutations, connection, schema}.rs`). 순수 git mv — 행동 변경 0. |
| 10 | **Sprint 198** (Mongo bulk-write) | feature | 3~5 일 | Mongo bulk-write 3 신규 command (`delete_many` / `update_many` / `drop_collection`) + UI 진입점 결정 (sidebar context vs Quick Look 모드 vs aggregate stage extension) + `analyzeMongoOperation` analyzer. |

**총 4 refactor-only (Sprint 189, 191, 193, 197) + 1 prep drive-by (Sprint
195) + 5 feature (Sprint 190, 192, 194, 196, 198).** 누적 예상 17~28 일
(sprint 단위 작업, 동시 작업 없음 가정).

### 순서 결정 근거

- **189 → 190 묶음**: Sprint 189 와 Sprint 190 모두 Safe Mode 컨텍스트.
  189 의 `useSafeModeGate` 마이그레이션 직후 prod-auto 가 같은 hook 의
  mode-resolution path 를 확장하므로 cache 효율.
- **191 → 192 묶음**: SchemaTree 분해를 export 진입점 추가와 같은 sprint
  에 넣으면 review 단위가 너무 커짐 (god file 분해 + 신규 IPC + 신규 UI
  진입점). 분리.
- **193 → 194 묶음**: useDataGridEdit 분해도 동일 이유. Quick Look 합류는
  paradigm 별 hook 에 신규 site 만 추가하는 형태로 깔끔히 떨어진다.
- **195 → 196 묶음**: tabStore 액션 추출은 작아서 별도 sprint 가 과함.
  196 진입 첫 commit 으로 흡수.
- **197 → 198 (마지막)**: Mongo bulk-write 는 Sprint 188 §10 의 내부
  followup 일 뿐 외부 사용자 요청 아님. FB-1b/3/4/5b 가 모두 닫힌 후 처리.
  사용자 가치 priority 마지막. (Phase 24 = Index Write UI 와 명명 충돌
  방지 — bulk-write 는 Phase 신설 없이 Sprint 단위로 처리.)

---

## 명시적 Defer (본 계획 밖)

다음은 스멜이지만 10 sprint 어디에도 닿지 않으므로 미루고, 닿는 시점에
재평가:

- **§2 ConnectionDialog (829줄)** — 향후 10 sprint 가 connection 폼을
  건드리지 않음. 현재 주석에 "escape hatch" 정당화 있음. Phase 13 (PG
  preview tab parity) 또는 connection group DnD (Phase 15) 진입 시 재평가.
- **§3.2 module-load IPC bridge attach** — 테스트/번들 모두 문제 없음.
  bug 가 surface 하기 전에 손대지 않음.
- **§7.1 `useSqlAutocomplete` any 확산** — CodeMirror 외부 타입에 갇혀
  있어 격리됨. 자동완성 기능 변경 시점에 재평가.
- **§8.1 초대형 test file (SchemaTree.test 2721줄, QueryTab.test 2296줄,
  StructurePanel.test 2156줄)** — 해당 prod 컴포넌트가 분해되는 sprint
  (191 / 193) 에 따라가게 하되, 별도 분해는 안 함.
- **`commands/connection.rs` 1710줄, `db/postgres.rs` 3684줄** — Sprint
  198 은 mongodb 만 건드림. postgres 분할은 Phase 25 (Constraint Write
  UI) 또는 Phase 27 (Table/Column DDL UI) 진입 시 재평가.

---

## 리스크

- **191 / 193 가 일정에 들어가면 사용자 피드백 (FB-3, FB-4) 이 늦어짐.**
  대안: refactor 를 feature sprint 의 첫 PR 로 흡수하고 같은 sprint 번호
  유지. 단 god surface 2곳 (SchemaTree, useDataGridEdit) 은 분해 자체가
  3+ 일 작업이라 sprint 번호 분리가 책임 분리에 더 안전. 현재 **별도 번호
  분리 권장**.
- **테스트 깨짐 위험.** Sprint 191 의 SchemaTree 분해는 `SchemaTree.test.tsx`
  2721줄을 동반 수정해야 함. mitigation: TDD strict 정책 (PLAN.md §TDD)
  대로 red→green 흔적 남기고 progressive split.
- **mongodb.rs 분할 시 cargo check 회귀.** Sprint 197 은 순수 module
  이동이므로 git mv + use 경로 갱신만. 행동 변경 0.

---

## 다음 액션

1. **Sprint 189 contract 작성 → 진입.** 위 표 1번. AC:
   - AC-189-01: `useDataGridEdit` 의 inline gate → `useSafeModeGate`.
   - AC-189-02: `EditableQueryResultGrid` 동일.
   - AC-189-03: `ColumnsEditor` 동일 (Sprint 187 inline gate 제거).
   - AC-189-04: `IndexesEditor` 동일.
   - AC-189-05: `ConstraintsEditor` 동일.
   - AC-189-06: drive-by — `DEFAULT_PAGE_SIZE` 단일화, dead `test-utils.tsx`
     처리, `useSafeModeGate` 의 D-4 적용 (decision matrix → `decideSafeModeAction`
     pure function), D-6 lib sub-grouping (`lib/sql/`, `lib/mongo/`,
     `lib/safeMode.ts`).
   - 회귀 0: 5 사이트의 기존 strict block / warn confirm / off allow 테스트
     모두 그대로 통과.
2. **PLAN.md 표 등재 + sync.** 본 시퀀싱 표를 PLAN.md FB 표 위에 등재.
   FB-1b/3/4/5b 의 sprint 번호 정정 (189 → 190, 190 → 192, 191 → 194,
   192 → 196).
3. **phase-23.md / memory/roadmap / memory/conventions / CLAUDE.md sync** —
   Phase 23 종료 마킹 + sprint 번호 stale 정정 + 본 plan + standards 참조.
4. **Sprint 190 종료 후 재평가.** 190 끝나면 SchemaTree 분해 (Sprint 191)
   와 DB export (Sprint 192) 사이 swap 가능성 다시 본다 — Sprint 190 이
   SafeModeStore 만 건드리고 SchemaTree 표면 변경 없으므로 순서 바꿔도
   안전.
