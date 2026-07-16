---
title: Cross-paradigm UI Parity 머지 기준
type: product-rule
updated: 2026-07-17
surface: src/components/workspace/**, src/components/query/**
task: ui-parity, review, merge-gate, unsupported-convention
---

# Cross-paradigm UI Parity 머지 기준

같은 사용자 작업이 paradigm(rdb / document / kv / search)마다 다른 UI 위치·모델로
구현되는 것을 막는 merge gate. PR 머지 전 체크한다. code convention (TS/React) 과
직교.

## Ownership / SOT

- 이 파일은 cross-paradigm UI parity merge rule 만 소유한다.
- Paradigm UI *heuristic* (슬롯 재사용 등) 은
  [paradigms](../../engineering/architecture/paradigms/memory.md) 가 보존한다 —
  heuristic 은 게이트가 아니다.
- 현재 제품 지원 상태는 [docs/product](../../../docs/product/README.md),
  구현 정합성 evidence 는 source code 가 SOT 이다.

## 1. 같은 작업 = 같은 진입점

같은 사용자 작업(database 선택 · 값 편집 · 새 항목 생성 · 삭제 · 결과 export 등)은
모든 지원 paradigm 에서 **같은 UI 위치·모델**로 노출되는 것이 원칙이다.

**문서화된 예외 없이 paradigm 간 다른 진입점/모델을 도입 = PR 머지 보류.**

분기가 불가피하면 아래 §3 "예외 등록" 에 사유·범위를 명시한다. 예외는 "이 paradigm
은 이 작업을 달리 둔다, 왜냐하면 ~" 형태로 존재해야 한다. 이 작업이 해당 paradigm
에서도 가능한데 단순 숨김으로 끝내면 안 된다 — 진짜 미지원의 숨김 표현은 §4 를 따른다.

## 2. 기준 진입점 (reference, 예외로 덮을 수 있음)

| 작업            | 기준 진입점                              |
| --------------- | ---------------------------------------- |
| database 선택   | 상단 툴바 `DbSwitcher` (connection 전역)  |
| 값 편집         | 데이터 그리드 셀 (inline)                |
| 새 항목 생성    | 결과 툴바 `[+]`                          |
| 삭제            | 그리드 컨텍스트 메뉴 / 툴바 🗑           |
| 위험 write 확인 | `ConfirmDestructiveDialog` (Safe Mode 게이트) |
| 결과 export     | 결과 액션바                              |
| 서버 운영 뷰 (U1/U4/U5: activity / server info / slow query) | 상단 툴바 `Operations` 버튼 → flyout (`OperationsPanel`, #1054) — `operations.*` capability 게이트 |
| 컬렉션 통계 (U3: collection stats) | document 테이블 `Structure` 탭 → `Stats` 서브탭 (`CollectionStatsPanel`, #1054) — §3 예외: 컬렉션 컨텍스트 필요라 connection-level flyout 부적합, paradigm 게이트 |

기준은 rdb/document 의 현 구현에서 온다. 다른 paradigm 이 같은 작업을 다른 곳에
둘 때, capability 게이트(`switchDatabase` 등)만으로 위치를 정하면 안 된다 — 위치는
이 표 또는 등록된 예외를 따른다.

서버 운영 뷠(U1/U4/U5) 는 capability 가 없는 paradigm(kv/search)에서 버튼 자체가
숨겨진다 — disabled-only 진입점이 아니라 capability 부재 = 진입점 없음 (#1054).

## 3. 예외 등록

paradigm 특성상 기준 진입점이 의미 없으면(예: KV 의 값이 그리드가 아닌
type-aware 패널) 예외로 등록한다. 형식:

- **작업 / paradigm / 실제 진입점 / 사유** 한 줄.
- 사유는 사용자 관점이어야 한다 ("KV 값은 그리드보다 type-aware 패널이 의미있다"),
  내부 milestone 이 아니다.

등록된 예외 없이 분기하면 머지 보류.

### 등록된 예외 (#1051, 2026-07-17)

- **값 편집 / kv / 우측 detail 탭의 type-aware `KvMutationPanel` (string=SET,
  hash·list·set·zSet=행 편집, stream=reader) / 사유**: KV 값은 형(type)마다 구조가
  달라 단일 그리드 셀 inline 편집이 성립하지 않는다 — 형별 패널이 사용자에게 더
  명확하다. 생성·삭제 진입점은 예외가 아니라 기준 정합이다(아래 Known debt 참조).

## 4. Unsupported 표현 규약 (2026-07-10 소유자 결정)

미지원을 UI 로 표현하는 방식은 **숨김 우선 + 상태성 예외** 단일 규약을 따른다.

- **정적 미지원** — 해당 DBMS/paradigm 에서 영구적으로 안 되는 것(개념 부재 포함)
  → **숨김** (`return null`). 회복 경로 없음 = 진입점 없음.
- **상태성/일시적 불가** — 실행 중이라 취소 불가, 권한 부족, 연결 상태 등 회복
  경로가 있는 것 → **disabled + Radix 툴팁(사유 명시)**. 레이아웃 널뛰기 방지.
- **폐기 패턴 3종** — ① disabled + native `title` ② 클릭 후 백엔드 에러 ③ toast
  차단 — 전부 위 둘 중 하나로 수렴시킨다.
- **capability flag 유지** — 숨김 판정에도 프론트가 미지원 여부를 알아야 하므로
  capability flag 의 UI 소비 필요성은 유지. #1043 flag 정리와 결속.

정적 미지원 숨김이 §1 parity 를 은폐하면 안 된다: "다른 paradigm 엔 있는 작업인데
여기선 개념이 진짜 없는가?" 를 먼저 묻는다. 개념이 있는데 안 만든 것 = parity
부채(숨김 금지, §3 예외 등록), 개념이 없는 것 = 정적 미지원(숨김).

**개정 이력**: 종전 ui-parity 문구 "미지원이면 숨기지 말고 사유와 함께 표시" 는 이
결정으로 뒤집혔다 — discoverability 보다 깔끔한 UI 우선(트레이드오프 인지 하 결정,
2026-07-10 소유자). 후속 22.10 계열(#1052 등)은 이 규약 기준으로 처리한다.

## Why

2026-06-17 UI 일관성 감사에서 paradigm 간 불일치를 발견했다. 메타 분석
결과, memory 는 negative rule 위주이고 positive 횡단 invariant 가 부재했으며,
cross-paradigm heuristic 은 `paradigms/memory.md` 에 있었지만 *게이트가 아니라서*
회귀를 못 막았다. 같은 "database 선택" 작업이 rdb(상단 활성 `DbSwitcher`) ·
document(상단 미렌더, tab-local chip) · kv(상단 활성 `DbSwitcher` *와* 사이드바
로컬 state 이중 진입점) · search(상단 read-only + `_search` 하드코드) 로 네 갈래
난 것이 직접 계기다. capability 값(`switchDatabase` true/false)만으로 위치를
정하면 안 되는 이유 — kv 는 `true`(`dataSource.test.ts:461`)라 상단 스위처가
활성임에도 사이드바에 별도 state 가 또 있다.

## How to apply (PR 체크리스트)

새 UI 진입점을 추가하거나 기존 진입점을 옮기는 PR:

1. **전 paradigm 비교 표** — 이 작업이 rdb / document / kv / search 각각 어디서
   일어나는지 한 줄씩. (본 PR body 또는 review comment)
2. **capability 게이트만으로 위치 결정 금지** — `hasConnectionCapability` 결과로
   UI 위치를 정하지 말 것. 위치는 §2 표 또는 예외 기준.
3. **비활성 UI 추적** — `disabled` / `aria-disabled` / `return null` / read-only
   fallback 이 나오면, "그 기능이 다른 곳에 숨어있나?" 를 먼저 묻는다. 비활성 UI는
   흔히 다른 곳에 중복 구현됐다는 신호다. 미지원 표현 자체는 §4 규약(정적=숨김,
   상태성=disabled+툴팁)을 따르되, parity 위반(다른 paradigm 엔 있는 작업)을
   숨김으로 은폐하면 머지 보류.
4. **분기 시 예외 등록** — §3 형식으로 이 파일에 추가. 사유 없는 분기 = 보류.

## Known debt (2026-06-17 감사 — 진행 상황)

KV 진입점 3건은 #1050(파괴 게이트) · #1415/#1466(CRUD UI) · #1051(db scope 단일화)
으로 대부분 해소. 현행 상태 (file:line 은 직접 재검증):

- **db scope 4-way 분기** — rdb=상단 활성 `DbSwitcher`, document=상단 read-only
  chip → tab-local `TabDbChip`, search=상단 read-only + `_search` 하드코드,
  kv=상단 활성 `DbSwitcher`. **kv 이중 진입점 해소 (#1051)**: 사이드바 자체
  db-selector 제거(dead `switchKvDatabase`/`listKvDatabases` 폐기), db scope 를
  store `activeDb` 단일 파생 + `loadCatalog` 이 backend `current_kv_database` 로
  reconcile(toolbar 전환 mid-load 는 clobber 방지 가드) — DbSwitcher 와 동일 소스.
  네 paradigm 이 여전히 다른 model(connection-active / tab-local / synthetic)이나
  이는 의미상 별개 scope 라 억지 수렴 대상 아님(§3 예외/정합으로 대체).
- **값 편집** — kv type-aware 패널(`KvMutationPanel`) → **§3 예외 등록 완료 (#1051)**.
- **새 항목 생성** — kv `KvKeyActions` [+ New key] 툴바 버튼으로 기준표(`[+]`) 위치·
  모델 정합; 생성 폼은 #1075 개방 대기(현재 disabled).
- **삭제 / Safe Mode 게이트** — #1050 으로 `ConfirmDestructiveDialog` +
  `safeModeGate.decide` 경유(`KvMutationPanel.tsx` `confirmPendingMutation`)로 정합.
  종전 inline typing-confirm / `allowOverwrite` 우회 폐기 — 안전 게이트 정상 적용.

## 관련

- [paradigms](../../engineering/architecture/paradigms/memory.md) — paradigm UI heuristic (게이트 아님)
- [product](../memory.md) — reset-to-default 등 다른 product merge gate
- [engineering/conventions/frontend](../../engineering/conventions/frontend/memory.md) — TS/React UI 코드 룰
- [workflow/review](../../workflow/review/memory.md) — PR 정성 평가
