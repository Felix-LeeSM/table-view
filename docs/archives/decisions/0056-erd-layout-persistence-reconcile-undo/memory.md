---
id: 0056
title: ERD 레이아웃 상태 계약 — connection별 persist + 명시적 자동정렬 + reconcile + undo
status: Accepted
date: 2026-07-17
supersedes: null
superseded_by: null
---

**결정**: ERD 레이아웃 상태 계약 4 (2026-07-17, 오너): (1) 노드 위치·가상 FK 는 connection 단위 로컬 persist — workspace persist 패턴 재사용. (2) 암묵 자동 재배치 금지 — 전체 재레이아웃은 명시적 "자동 정렬" 버튼으로만. (3) 스키마 변경 reconcile: 기존 테이블 = best-effort 위치 복구 / 신규 테이블 = 기존 이웃 근처 자동 배치 / 사라진 테이블·컬럼 = 노드 및 참조 가상 FK 정리. (4) 배치 이동·가상 FK 생성/삭제·자동 정렬 전부 undo/redo 스택 — 로컬 상태만 조작(ADR 0048/0050 undo 계약과 동형), datagrid undo slice 패턴 준용.

**이유**: 손으로 만든 배치는 사용자 자산 — 새로고침/스키마 변경마다 증발하면 수동 배치·수동 링크 기능 자체가 무의미. 암묵 재배치는 자산 파괴라 명시 버튼 + undo 가 방어선.

**트레이드오프**:
- **+** 손 배치 보존과 스키마 진화 공존. 자동 정렬 버튼이 reconcile 휴리스틱 불만족 시 escape hatch.
- **−** persistence 포맷 버저닝 비용(레이아웃 스키마 변경 시 마이그레이션 필요).
- **−** "이웃 근처 자동 배치" 휴리스틱은 완벽 불가 — best effort 로 명시.

**관련**:
- ADR 0048/0050 — undo 계약 선례(로컬 상태만, 저장은 명시적).
- ADR 0054/0055/0057 — 같은 ERD 재설계 세트.
- zustand workspace persist 패턴, `src/stores/dataGridEditStore.ts` undo slice 선례.
