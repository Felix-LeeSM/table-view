# Sprint 191 — Handoff

Sprint: `sprint-191` (SchemaTree 분해 — 데이터 레이어 hook 추출 +
schema-단위 cache eviction 액션화 + silent failure → toast 정리 +
exhaustive-deps ignore 정정).
Date: 2026-05-02.
Type: refactor.

## Files changed

| 파일 | Purpose |
|------|---------|
| `src/stores/schemaStore.ts` | `evictSchemaForName(connectionId, schemaName)` 액션 추가 — `tables` / `views` / `functions` 의 `${connectionId}:${schemaName}` 키 한 번의 set 으로 제거. 기존 SchemaTree 의 직접 setState 누설 차단. |
| `src/stores/schemaStore.test.ts` | `[AC-191-01]` — 액션이 (a) 타깃 (conn, schema) 의 3 cache 모두 비우고 (b) 다른 schemaName / conn 의 entry 는 보존하는지 단언. |
| **NEW** `src/hooks/useSchemaCache.ts` | SchemaTree 의 데이터 레이어 hook. `(schemas, loadingSchemas, loadingTables, refreshConnection, refreshSchema, expandSchema)` return. mount auto-load + per-schema lazy expand + 단일 schema refresh + silent failure → toast 정리. |
| **NEW** `src/hooks/useSchemaCache.test.ts` | 4 case (`AC-191-02-1~4`) — mount load / refresh evict-then-reload / expand cached-skip / store-swallowing 분기 단언. |
| `src/components/schema/SchemaTree.tsx` | 데이터 레이어 호출지 → hook 위임. 직접 setState 제거 (액션 호출). 9개 `.catch(() => {})` 중 hook 으로 옮긴 7개 + UI dialog catch 2개 (drop/rename) toast 화. exhaustive-deps ignore 1건 정정. line 1963 → 1915 (-48). |
| `src/components/schema/SchemaTree.test.tsx` | `[AC-191-03-1,2]` — dropTable / renameTable rejection → toast.error 단언 신규 2건. |
| `docs/sprints/sprint-191/contract.md` | 본 sprint contract. |
| `docs/sprints/sprint-191/findings.md` | 9 섹션 (god decomposition / line count 실측 / store-swallowing 발견 / evictSchemaForName / exhaustive-deps / 후속 / AC 매핑 / diff 통계 / 4-set). |
| `docs/sprints/sprint-191/handoff.md` | 본 파일. |

총 코드 6 modified/new (lib/hook 2 NEW + store 2 modified + UI 2
modified), docs 3 신설.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-191-01 | `pnpm vitest run src/stores/schemaStore.test.ts -t "AC-191-01"` | **1 passed** (액션 단위). |
| AC-191-02 | `pnpm vitest run src/hooks/useSchemaCache.test.ts` | **4 passed** (mount / refresh / expand-skip / store-swallow). |
| AC-191-03 | `pnpm vitest run src/components/schema/SchemaTree.test.tsx -t "AC-191-03"` | **2 passed** (drop/rename failure toast). 단, hook level 의 5개 catch 는 store-swallowing 으로 dead branch 임을 finding §3 에 기록. |
| AC-191-04 | `pnpm lint` | 0 warnings. SchemaTree 의 exhaustive-deps ignore 가 제거되어도 lint clean. |
| AC-191-05 | line count | 1963 → 1915 (-48). 목표 ~1700 미달, finding §2 에 정당화. |
| Sprint 191 전체 | `pnpm vitest run` + `tsc` + `lint` + `git diff src-tauri/` | **183 files / 2652 tests passed** (+1 file, +7 cases vs Sprint 190 2645); tsc 0; lint 0; src-tauri/ empty. |

## Required checks (재현)

```sh
pnpm vitest run src/stores/schemaStore.test.ts \
  src/hooks/useSchemaCache.test.ts \
  src/components/schema/SchemaTree.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
git diff --stat src-tauri/
```

기대값: 모두 zero error / empty diff.

## 후속 (sequencing 계속)

- **Sprint 192** (FB-3): DB 단위 export. SchemaTree 의 sidebar context
  menu 진입점 추가. 본 sprint 가 표면을 정리해 둔 위에서 진입점만
  추가하면 review 단위가 작아진다.
- **Sprint 193** (refactor): `useDataGridEdit` 자체 분해 (1160+ 줄).
- finding §6 의 4 followup (UI props 분리 / store error 가시화 / store
  contract throw / SchemaTree.test 분할) 은 별 sprint 단위로 재평가.
