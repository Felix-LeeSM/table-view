# Sprint 142 Contract — Tab UX (#8 #9)

## Scope

`spec.md` 의 **AC-147-* (Sprint 147 — Tab UX)** 슬라이스. 사용자 피드백 #8 (PG 사이드바 단일 클릭 preview 탭 parity), #9 (dirty marker 가 dirty 탭이 아니라 focused 탭에 붙는 버그) 두 항목을 닫는다.

기존 Sprint 136 이 `addTab` 에 preview-slot swap 로직을 넣었기 때문에 데이터 모델은 이미 갖춰져 있다. 이 sprint 는 **(a) DOM 레벨에 `data-preview` 속성을 노출**하고 **(b) tab 전환 시 `useDataGridEdit` 의 pendingEdits 가 origin 탭과 함께 끝까지 따라가도록** 보장한다.

## Done Criteria (완료 기준)

1. **AC-147-1** PG sidebar 의 테이블 row 단일 클릭으로 새로 열린 탭의 DOM 엘리먼트가 `[data-preview="true"]` 속성을 가지며, 같은 connection 의 후속 단일 클릭은 새 탭을 추가하지 않고 preview 슬롯을 교체한다(총 탭 수 변동 없음).
2. **AC-147-2** Mongo `DocumentDatabaseTree` 의 컬렉션 단일 클릭과 PG `SchemaTree` 의 테이블 단일 클릭이 동일한 preview-tab 결과를 만든다 — 두 paradigm 의 탭이 모두 `data-preview="true"` 로 마크된다.
3. **AC-147-3** preview 탭 더블클릭(또는 sidebar row 더블클릭) 시 `data-preview` 속성이 제거되고 italic 스타일이 사라진다 (영구 탭으로 pin).
4. **AC-147-4** 두 table 탭 A, B 가 각각 자기 자신의 pendingEdits 상태를 가지며, A 에서 셀을 편집한 뒤 B 로 포커스를 옮기더라도 `data-dirty="true"` 마커는 **A 탭의 dirty dot 에만** 남고 B 에는 붙지 않는다. 다시 A 로 돌아오면 (의도된 동작에 따라) 새로운 mount 이므로 pendingEdits 는 초기화되어 dirty 마커도 사라진다 — 이 sprint 는 "dirty 가 잘못된 탭으로 옮겨가는 버그" 를 닫는 것이 목표이며, 편집 영속화는 별도 항목.

## Out of Scope

- Query 탭(SQL/MQL editor) 의 dirty marker 추가 — 현재 query 탭은 store 에 dirty 신호를 쓰지 않으며, 본 sprint 의 사용자 피드백은 table-edit grid 한정 관찰임.
- Table-edit pendingEdits 의 탭간 영속화(switch away → return 시 복원). 현재 의도된 동작은 unmount 시 정리.
- Preview 탭 전환 시 stale focus / 키보드 네비게이션 미세조정.

## Invariants

- 기존 tabStore semantics(`addTab` preview-slot swap, `promoteTab` flip, `setTabDirty` 멤버십) 는 변경하지 않는다 — DOM/wiring 레이어만 손본다.
- TabBar 의 close 버튼, 드래그 reorder, 미들 클릭 닫기, paradigm 아이콘 순서는 모두 유지.
- DataGridTable / DocumentDataGrid 의 commit / rollback / Cmd+S flow 는 회귀 금지.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run` — 새로 추가된 단위/통합 테스트 + 전체 회귀 모두 green.
  2. `pnpm tsc --noEmit` — exit 0.
  3. `pnpm lint` — exit 0.
- Required evidence:
  - 새로 추가된 실패 테스트(red phase) 의 첫 실행 결과 (변경 전 상태에서 fail 함을 보여야 함).
  - 구현 후 동일 테스트가 green 임을 보이는 vitest 출력.
  - 변경 파일 목록 + 한 줄 사유.
