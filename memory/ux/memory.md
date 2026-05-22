---
title: UX 머지 기준
type: ux-rule
updated: 2026-05-17
task: ux-review, persistence-reset, merge-gate
---

# UX 머지 기준

제품 UX 의무 — PR 머지 전 체크. 코드 convention (Rust/TS) 과 직교.

## 1. 영속 상태는 reset-to-default UI 필수

영속되는 모든 사용자 상태 (settings / per-table prefs / collapse 상태 등) 는 사용자가 직관적 위치에서 default 로 되돌릴 affordance 가 같이 머지되어야 함. **Reset UI 없는 영속 상태 = PR 머지 보류.**

### 위치 룰

| 영속 단위                                               | Reset 위치                            |
| ------------------------------------------------------- | ------------------------------------- |
| Tiny UI 가구 (collapse / width)                         | 더블클릭 또는 우클릭 메뉴 "Reset"     |
| Per-entity prefs (table column widths / hidden columns) | 그 entity 의 헤더 우클릭 메뉴         |
| Global settings (theme / safe mode / retention 등)      | 설정 패널 안 "Reset to defaults" 버튼 |
| Workspace layout (sidebar expand 상태 등)               | sidebar 헤더 메뉴                     |

### Why

사용자 2026-05-16 state-management grill Q21 명시 요구. 영속 가치만 보고 reset path 누락하면 사용자가 "한 번 잘못 조절하면 영원히 그 상태" 라고 느끼게 됨 (LS / SQLite 직접 편집 외 escape hatch 없음).

### How to apply

새 영속 상태 추가 PR 마다 reset affordance 위치 명시. 미커버 항목 발견 시 그 PR 에서 같이 추가. 별도 PR 미루지 마 — "추가하겠다" 약속만 남으면 잊힘.

Phase 6 audit (`docs/state-management-strategy-2026-05-15.md` F.6) 에 사이트별 체크리스트 박힘.

## 관련

- [decisions](../decisions/memory.md) — 영속 상태 ADR (0032 SQLite atomic snapshot, 0035 corrupt recovery, 0038 theme/safemode SOT, 0040 file-key keyring, 0042 query history)
- [conventions](../conventions/memory.md) — TS/React 코드 룰
- [workflow/delivery](../workflow/delivery/memory.md) — 머지 직전 checkpoint
- `docs/ux-laws-mapping.md` — UX 법칙 매핑 source. Action plan 은
  sprint-176~180 분해 완료 후 retire 됨.
