# Sprint 190 — Findings

## 1. FB-1b 의 1차 정의 — Hard auto

`docs/PLAN.md:41` 의 "Hard auto 정책" 표현을 다음과 같이 정의했다:

> production 으로 태그된 연결에서는 사용자의 SafeMode toolbar 설정을
> **무시하고** danger 분류 statement 를 자동 block. mode `off` 가 무효.

대안 ("Soft auto" — production + off → confirm 으로 부드러움) 은 사용자
피드백 없이 가정으로 결정하지 않고 후속으로 미뤘다. lib-level 결정으로
모았기 때문에 정책 변경이 필요해질 경우 `decideSafeModeAction` 한
함수만 수정하면 된다.

## 2. lib 변경: 분기 추가, store 무변경

`src/lib/safeMode.ts` 의 decision matrix 가 다음과 같이 진화했다:

| environment | mode | severity | Sprint 189 | Sprint 190 |
|-------------|------|----------|-----------|------------|
| any | any | safe | allow | allow |
| !production | any | danger | allow | allow |
| production | warn | danger | confirm | confirm |
| production | strict | danger | block (toolbar copy) | block (toolbar copy) |
| **production** | **off** | **danger** | **allow** | **block (prod-auto copy)** |

`useSafeModeStore` 자체는 무변경. 사용자가 toolbar 에서 "off" 로 토글한
글로벌 preference 는 그대로 유지되고, 결정 시점에만 production 컨텍스트
가 이를 무효화한다. 사용자가 non-production 연결로 돌아오면 자동으로
off 가 다시 효력을 갖는다.

## 3. block 카피 분기

strict 와 off 가 둘 다 block 으로 떨어지지만 사용자에게 안내해야 할
"override 경로" 가 다르다:

| mode | reason text |
|------|-------------|
| strict | `Safe Mode blocked: {reason} (toggle Safe Mode off in toolbar to override)` |
| off (prod-auto) | `Safe Mode blocked: {reason} (production environment forces Safe Mode — change connection environment tag to override)` |

`strict` 카피는 사실상 정확하지 않은 hint 가 되었지만 (prod-auto 후
toggle off 도 무효), 사용자가 한 번 toggle 하면 warn → confirm dialog
를 통해 우회 가능하기 때문에 "type-to-confirm 으로 진행" 이라는 escape
가 살아 있다. strict 카피의 추가 정정은 후속 sprint 에서 검토.

## 4. SafeModeToggle off-tooltip 갱신 (AC-190-04)

기존: `Safe Mode: Off (click to re-enable production guard)\n\nNo guard.
Use only for one-off destructive maintenance.`

신규: `Safe Mode: Off (click to re-enable for non-production)\n\nProduction-
tagged connections still force Safe Mode automatically.\nUse Off only for
one-off destructive maintenance on local / testing\n/ development /
staging.`

이유: "No guard" 카피가 prod-auto 후 거짓이 됨. production-에서 자동
guard 가 켜지므로 사용자가 토글의 의미를 오해할 위험 — 명시적으로
non-production 한정임을 안내.

`SafeModeToggle.test.tsx` 의 `[HF-187-A1]` tooltip verbatim assertion 도
동반 갱신 (regex 두 줄로 분할 — newline 끼어있어 한 정규식으로 묶이지
않음).

## 5. 5 사이트 무변경, 회귀 테스트만 정정

5 사이트 (`useDataGridEdit`, `EditableQueryResultGrid`, `ColumnsEditor`,
`IndexesEditor`, `ConstraintsEditor`) + Mongo aggregate (QueryTab) 의
**소스 코드는 1 라인도 손대지 않았다**. Sprint 189 의
`useSafeModeGate` → `decideSafeModeAction` 마이그레이션 덕분에 lib 한
줄 변경이 6 사이트 모두에 자동 반영.

영향 받은 회귀 테스트 5개 (정확히 production + off + danger 분기를
단언하던 것들):

| 테스트 | 기존 단언 | Sprint 190 단언 |
|--------|-----------|-----------------|
| `safeMode.test.ts` `[AC-189-06a-5]` | allow | block + 카피 verbatim. `[AC-190-01-1]` 로 rename. |
| `useSafeModeGate.test.ts` "reads mode" | off → allow | warn → confirm. 분기를 다른 mode 로 옮김. |
| `useDataGridEdit.safe-mode.test.ts` `[AC-185-04d]` | allow | block + 카피. `[AC-190-01-3]` 로 rename. |
| `EditableQueryResultGrid.safe-mode.test.tsx` `[AC-185-05d]` | allow | block + 카피. `[AC-190-01-4]` 로 rename. |
| `QueryTab.test.tsx` `[AC-188-03d]` | dispatch proceeds | dispatch blocked + queryState.error 카피 verbatim. `[AC-190-01-5]` 로 rename. |

신규 case 추가: `[AC-190-01-2]` (production + off + safe → allow) — Hard
auto 가 danger 한정이고 SELECT / read-only 는 production 에서도
proceed 한다는 것을 negative case 로 고정.

## 6. AC → 테스트 매핑

| AC | 검증 위치 | 케이스 수 |
|----|-----------|-----------|
| AC-190-01 | `src/lib/safeMode.test.ts` AC-190-01-1, -2 | 2 (prod-auto block + safe negative) |
| AC-190-01 | `useDataGridEdit.safe-mode.test.ts` AC-190-01-3 | 1 |
| AC-190-01 | `EditableQueryResultGrid.safe-mode.test.tsx` AC-190-01-4 | 1 |
| AC-190-01 | `QueryTab.test.tsx` AC-190-01-5 | 1 |
| AC-190-02 | (위 5 케이스에 카피 verbatim 단언이 모두 포함) | 0 별도 |
| AC-190-03 | `useSafeModeGate.test.ts` "reads mode" 갱신 | 0 신규 |
| AC-190-04 | `SafeModeToggle.test.tsx` `[HF-187-A1]` 갱신 | 0 신규 |

## 7. Out of Scope 재확인 (이번 sprint 후속)

- **Strict copy 정정**. 현재도 "toggle Safe Mode off" 라고 안내하지만
  off 도 prod-auto 로 block. 두 단계 click 후에 진정한 정보를 보게 됨.
  follow-up: warn 으로 가는 hint 로 강제하거나 (`toggle to warn for
  type-to-confirm dialog`) 환경 태그 변경 path 를 합치는 통합 카피.
- **Toolbar 의 connection-aware visual**. SafeModeToggle 이 active
  connection 의 environment 를 알면 production 에서 visual 을 자동
  잠금 표시할 수 있음. UI 디자인 합의 필요.
- **Per-connection mode override**. production 인데 한 번만 prod-auto
  를 우회해야 하는 시나리오. 현재 escape hatch 는 environment 태그
  변경뿐. user feedback 후 결정.
- **Telemetry**. prod-auto block 이 trigger 됐을 때 로컬 audit log /
  query history 에 source="prod-auto" 마커. Sprint 196 (FB-5b query
  history source 필드) 에서 함께 처리.

## 8. 코드 변경 통계

- `src/lib/safeMode.ts`: +9 / -5 lines (matrix 분기 + 카피 분기 + 도크).
- `src/lib/safeMode.test.ts`: +14 / -3 (신규 case + AC rename).
- `src/hooks/useSafeModeGate.test.ts`: +5 / -3 (assertion flip).
- `src/components/datagrid/useDataGridEdit.safe-mode.test.ts`: +14 / -2.
- `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`: +12 / -3.
- `src/components/query/QueryTab.test.tsx`: +14 / -7.
- `src/components/workspace/SafeModeToggle.tsx`: +4 / -2 (tooltip).
- `src/components/workspace/SafeModeToggle.test.tsx`: +9 / -1 (assertion).

총 ~80 line diff, 8 파일. behavior change 1 (production + off + danger:
allow → block). store / hook signature / 5 사이트 코드 무변경.
