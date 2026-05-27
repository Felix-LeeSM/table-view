---
id: 0025
title: DataGrid 의 layout / sorting / filtering / virtualization 은 자체 관리 — TanStack Table 도입 안 함
status: Accepted
date: 2026-05-11
supersedes: null
superseded_by: null
---

**결정**: DataGrid (RDB / Document / Query 4 종) 의 column model · sorting · filtering · pagination · virtualization · drag-resize · column reorder 는 **자체 코드로 관리**한다. TanStack Table v8 (`@tanstack/react-table`) 은 도입하지 않는다. virtualization 만은 `@tanstack/react-virtual` 을 그대로 사용 (table model 과 분리된 thin lib).

**이유**: (1) Sprint 258 (`<table>` → CSS Grid + ARIA divs) 가 5 가지 width 회귀를 한 결정으로 해결했고, layout engine 의 통제권이 우리에게 있다 — TanStack 의 headless model 은 column / row 의 모델 정의를 lib 안에 위임하므로 sprint-258 류의 "layout engine 자체를 떠난다" 식 단일 fix 가 불가능해진다. (2) Sorting / filtering / pagination 은 backend SQL · Mongo pipeline 이 처리하고 frontend 는 columnOrder · sorts · activeFilter 같은 얇은 state 만 보유 — TanStack 의 client-side query engine 은 over-spec. (3) virtualization 은 이미 `@tanstack/react-virtual` (separate package) 로 적용 — table model 도입은 virtualization 과 무관. (4) column reorder · resize · width persistence 는 sprint-238/258/259 누적으로 자체 구현돼 있고 4 grid 가 일관된 패턴 (`useColumnWidths` + `useColumnResize` + `--cols` CSS variable cascade) 을 공유. lib 마이그레이션 비용 대비 추가 가치 없음.

**트레이드오프**: + layout engine 자체에 회귀가 들어왔을 때 sprint-258 류의 _engine swap_ 으로 정면 돌파 가능, sorting / filtering / pagination 의 server-driven 흐름이 frontend state 와 깔끔히 분리, virtualization 만 외부 lib 의존 (verified working) / - column model 의 정형 abstraction 부재 — 4 grid 사이 column 정의 형태 (RDB ColumnInfo · Document DocumentColumn · QueryColumn) 가 union 으로 흩어져 있어 type-guard / cast 비용. lib 도입 시 ColumnDef<T> 로 통일됐을 가치는 미실현.

**관련**: Sprint 258 (spec.md / findings.md / handoff.md), Sprint 259 follow-up. `@tanstack/react-virtual` 사용 site = `src/components/datagrid/DataGridTable.tsx` (virtualizer scrollContainer = outer `<div role="grid">`).
