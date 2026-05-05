# Sprint 217 — Handoff (retroactive)

> 본 sprint 의 작업은 Sprint 212 commit 과 동일 hash. Sprint 212 진행 중 Generator 가 P9 사전 처리로 함께 수행. atomic 분리는 sub-file dependency build 무결성 비용으로 단일 commit 채택. PLAN.md 의 Sprint 212 + Sprint 217 두 행 모두 같은 hash 가리킴.

## 완료 산출물

- `src/components/schema/DocumentDatabaseTree.tsx` (entry, 263 lines, 582 → -55%): 두 hook 호출 (`useDocumentDatabaseTreeData`, `useDocumentDatabaseDrop`) + 두 row 컴포넌트 (`DatabaseRow`, `CollectionRow`) + 한 dialog (`DropCollectionDialog`) + tab-open inline wrapper 만 보존. (Sprint 212 P3 의 `useMruStore` selector + `markConnectionUsed` 호출 통합.)
- `src/components/schema/DocumentDatabaseTree/useDocumentDatabaseTreeData.ts` (181): databases / collections selector + load + 검색 필터 + 자동 expand + activeDb 추적.
- `src/components/schema/DocumentDatabaseTree/useDocumentDatabaseDrop.ts` (109): Safe Mode gate + `dropCollection` Tauri call + history record + toast.
- `src/components/schema/DocumentDatabaseTree/rows.tsx` (130): `DatabaseRow` + `CollectionRow` presentational.
- `src/components/schema/DocumentDatabaseTree/dialogs.tsx` (67): destructive `DropCollectionDialog`.
- `docs/sprints/sprint-217/{spec,contract,execution-brief,findings,handoff}.md` (retroactive).

## 검증 결과

| 명령 | 결과 |
|------|------|
| `wc -l src/components/schema/DocumentDatabaseTree.tsx` | 263 (< 300 ✓) |
| `ls src/components/schema/DocumentDatabaseTree/*` | 4/4 존재 |
| sub-file max line | 181 (< 300 ✓) |
| `git diff --stat src/components/schema/DocumentDatabaseTree.test.tsx` | 0 changes |
| `pnpm vitest run src/components/schema/DocumentDatabaseTree.test.tsx` | 21/21 pass, exit 0 |
| `pnpm vitest run` (full suite) | 189 files / 2720 tests pass, exit 0 |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `grep "from \"@components/schema/DocumentDatabaseTree/\"" src/ e2e/` | 0 매치 (sub-file internal) |
| `git diff` 변경 파일 grep `^+.*eslint-disable` | 0 추가 |

## Acceptance Criteria 결과

- AC-01 entry path + props 보존 ✓
- AC-02 5 파일 모두 존재 + 비어있지 않음 ✓
- AC-03 entry 263 < 300 + sub-file max 181 < 300 ✓
- AC-04 regression test 21건 통과 + test 파일 0 변경 ✓
- AC-05 프로젝트 회귀 0 ✓ (tsc/lint exit 0; 새 eslint-disable 0)

Evaluator: **PASS 8/10** (retroactive). 1 P3 informational (Sprint 번호 라벨링 retroactive 정합).

## 미완 / 후속

- 없음 (분해 자체 완료 + 행동 보존).
- 다음 sprint = Sprint 213 (P5 step 2: `db/mod.rs` 551 trait/DTO 분리 + `export.rs` 879 writer 분리).
