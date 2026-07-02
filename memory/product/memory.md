---
title: Product 머지 기준
type: product-rule
updated: 2026-07-02
task: ux-review, persistence-reset, merge-gate, safe-mode-severity
---

# Product 머지 기준

현재 제품 동작에 직접 영향을 주는 UX merge gate. PR 머지 전 체크한다. 코드 convention
(Rust/TS) 과 직교.

## Ownership / SOT

- 이 파일은 반복 적용되는 product merge rule 만 소유한다.
- 현재 제품 상태와 support claim 은 [docs/product](../../docs/product/README.md)
  가 소유한다.
- 미래 목표와 sequencing 은 [docs/ROADMAP.md](../../docs/ROADMAP.md) 가 소유한다.
- 과거 UX audit 는 historical evidence 로만 본다. active rule 로 복제하지 않는다.

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

State-management reset gate 는
[engineering/state-management](../engineering/architecture/state-management/memory.md)
와 함께 적용한다.

## 2. Safe Mode severity 배정 원칙

새 구문/명령/패러다임에 severity tier 를 배정하는 PR 은 다음 축을 따른다 (2026-07-02 결정, issue #1120):

- **danger 는 비가역 데이터 파괴 전용.** confirm 다이얼로그의 무게를 유지한다 — 파괴가 아닌 위험(권한 변경 GRANT/REVOKE 등)은 전 방언/패러다임 **warn 통일**.
- **parity 축은 구문 형태가 아니라 "영향 범위 × 손실성".** 같은 "upsert" 라도: 행 단위·지정 컬럼(INSERT ON CONFLICT) = info / 행 단위·전체 리셋(REPLACE INTO) = danger / 테이블·컬렉션 단위 덮어쓰기($merge, $out, WHERE-less DML) = danger.
- Redis 등 backend allowlist 가 실제 안전 경계인 패러다임은 frontend 분류기를 full 동기화하지 않고, backend 의 confirm 요구 집합(`required_confirmation_key`)만 mirror 해 SQL 과 동일한 confirm 다이얼로그로 라우팅한다.
  - **명시적 예외**: KV 경로는 warn→confirm 표면이 없어 `danger` tier 를 confirm 라우팅 레버로 재사용한다. 그래서 KEYS(전수 스캔)·PERSIST(TTL 제거)는 비파괴인데도 `danger` 로 분류된다 — 위 "danger=파괴" 규칙의 축(영향×손실)이 아니라 backend confirm 집합 mirror 결과다. 따라서 impact×손실성 parity 표에는 넣지 않고 `kvQueryExecution.test.ts` 로 고정한다.
- 새 tier 배정은 이 축으로 정당화하고 parity 표 테스트(`src/lib/safeModeParity.test.ts`)에 반영한다.

### Why

사용자 원칙 "같은 위험 = 같은 경고" (일관된 UX). tier 가 방언·패러다임별로 다르면 사용자 멘탈 모델이 깨지고, danger 남발은 confirm 피로로 보호 효과를 죽인다.

## 관련

- [engineering/conventions](../engineering/conventions/memory.md) — TS/React 코드 룰
- [workflow/delivery](../workflow/delivery/memory.md) — 머지 직전 checkpoint
- [docs/product](../../docs/product/README.md) — 현재 제품 상태
- [docs/ROADMAP.md](../../docs/ROADMAP.md) — 미래 목표 / sequencing
- [docs/archives/audits/ux-laws-mapping-2026-04-30.md](../../docs/archives/audits/ux-laws-mapping-2026-04-30.md) — historical UX audit snapshot
