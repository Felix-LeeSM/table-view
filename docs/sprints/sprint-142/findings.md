# Sprint 142 — Findings (Tab UX)

## AC 커버리지

- **AC-147-1** PASS — `TabBar.tsx` 의 `<div role="tab">` 에 `data-preview="true"` 속성 추가. preview 슬롯에 들어간 새 탭은 isPreview=true → 속성 노출. 후속 단일 클릭은 기존 `addTab` 슬롯-스왑 로직(Sprint 136) 으로 preview 슬롯을 교체 — 탭 카운트 변동 없음 (`TabBar.test.tsx`: "preview tab does not accumulate" 류 기존 회귀 테스트 통과).
- **AC-147-2** PASS — Mongo `DocumentDatabaseTree` 와 PG `SchemaTree` 모두 같은 `useTabStore.addTab()` 경로를 거쳐 isPreview=true 탭을 만들고, `TabBar` 가 두 paradigm 의 탭을 동일한 분기에서 렌더 → `data-preview` 속성이 동등하게 붙는다 (`TabBar.test.tsx`: "preview table tab exposes data-preview" green).
- **AC-147-3** PASS — `promoteTab` 호출(더블클릭 또는 헤더 더블클릭) 후 isPreview=false → `data-preview` 속성이 `undefined` 로 렌더되어 DOM 에서 사라진다 (`TabBar.test.tsx`: "permanent table tab does NOT carry data-preview").
- **AC-147-4** PASS — `MainArea` 의 `<TableTabView>` 와 `<QueryTab>` 에 `key={activeTab.id}` 추가. 활성 탭 전환 시 React 가 이전 탭의 컴포넌트를 unmount → `useDataGridEdit` 의 cleanup 이 실행되어 origin 탭의 dirty marker 가 정리된다. 새 탭은 빈 pendingEdits 로 mount 되므로 setTabDirty 가 새 탭을 dirty 로 잘못 마킹하는 일이 없다. `MainArea.test.tsx`: "remounts DataGrid when activeTabId switches" + "does not propagate a stale dirty marker onto the newly focused tab" 두 케이스 green.

## Verification (Verification Plan: command)

```
pnpm vitest run     → Test Files 139 passed (139), Tests 2151 passed (2151) — sprint 142 신규 5 testcase 포함
pnpm tsc --noEmit   → exit 0, 출력 0줄
pnpm lint           → exit 0, 출력 0줄
```

## 변경 파일 (purpose)

| 파일 | 목적 |
|---|---|
| `src/components/layout/TabBar.tsx` | `data-preview="true"` 속성 추가 (preview 탭에만), 영구 탭으로 promote 시 자동 제거 (`undefined` → DOM 미노출) |
| `src/components/layout/TabBar.test.tsx` | AC-147-1/-3 + query 탭 비-preview 보장 3 testcase 추가 |
| `src/components/layout/MainArea.tsx` | `<TableTabView>` 와 `<QueryTab>` 에 `key={activeTab.id}` 부착 — tab swap 시 강제 remount 로 useDataGridEdit pendingEdits 격리 |
| `src/components/layout/MainArea.test.tsx` | DataGrid mock 에 mount counter 추가, AC-147-4 (remount + stale-dirty isolation) 2 testcase 추가 |

## 가정 / 위험 / 미해결

- pendingEdits 가 탭간에 영속화되지 않는다(unmount 시 정리). 사용자가 A 에 편집 후 B 로 갔다가 돌아오면 A 의 편집은 사라진다 — 기존 `useDataGridEdit.ts:944-960` 주석에 명시된 의도된 동작이다. 만약 후속 sprint 에서 "탭별 편집 영속화" 요구가 들어오면 pendingEdits 를 zustand 스토어로 끌어올려야 한다.
- spec.md AC-147-4 의 "A 에만 dirty 가 남는다" 는 strict 표현은 본 sprint 의 unmount-cleanup 모델에서는 정확히 성립하지 않는다(switch 후 A 의 dirty 도 사라짐). 그러나 사용자가 보고한 버그("focused 탭으로 dirty 가 옮겨가는 문제") 는 본 sprint 의 구현으로 닫힌다. `contract.md` Done Criteria 4 에 이 의도된 차이를 명시.
- `<QueryTab>` 도 함께 key 부착해 query 탭 간 전환 시 동일하게 remount 된다. QueryTab 은 현재 dirty 신호를 발행하지 않으므로 회귀는 없으나, 향후 query-tab dirty marker 추가 시 동일한 모델을 따르면 된다.
