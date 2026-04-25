# UI Evaluation Follow-up — ⚠️ 실측 추적 (§8)

> **출처**: [`docs/ui-evaluation-results.md`](./ui-evaluation-results.md) §8 ("실사용 확인이 필요한 항목").
> **목적**: 정적(코드 기반) 평가로는 판정 불가하여 `⚠️` 가 붙은 9 개 항목을 별도 큐로 외화해, 실측이 잊히지 않도록 한다. 항목별 검증 절차 / 담당 / 종결 조건을 둔다.
> **갱신**: 항목이 종결되면 `상태` 만 갱신하고 본문은 보존 (재현 가능성 확보).

---

## 상태 어휘

| 상태       | 의미                                                                                    |
|------------|-----------------------------------------------------------------------------------------|
| `active`   | 미검증. 실측 또는 결정 대기.                                                             |
| `verified` | 실측 / 결정 완료, 종결 조건 충족. 별도 sprint 로 후속 작업이 따를 수 있음.                |
| `deferred` | 의도적으로 미루기로 결정. 사유 + 재개 조건 명시 필수.                                    |

> **담당 컬럼 관례** — 현재 단일 메인테이너(Felix) 운영. 팀 확장 시 행별로 실제 담당자를 갱신한다.
> **deferred 행 형식 예시** — `상태 = deferred` 인 행은 같은 셀에 (사유: ...) (재개 조건: ...) 두 토큰을 함께 기재. 예: `deferred — 사유: Phase 7 까지 우선순위 낮음. 재개 조건: Phase 7 진입 또는 사용자 5명 이상 동일 보고`.

---

## 추적 항목

| ID         | 한 줄 요약                                                              | 출처 (§8) | 검증 절차                                                                                                                                                                 | 담당          | 종결 조건                                                                                                                                                          | 상태     |
|------------|-------------------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| UI-FU-01   | 72 테마 × light/dark 의 WCAG AA 실측                                    | line 352  | (1) `pnpm contrast:check` (sprint-113 도입) 로 6 핵심 페어 baseline 확인. (2) `pnpm tauri dev` 후 각 테마 핵심 화면(연결 다이얼로그, DataGrid, Sidebar) 캡처 → axe-devtools 또는 Stark 로 실제 텍스트/배경 페어 검사. | 메인테이너    | (a) 모든 신규 페어가 4.5:1 이상이거나 (b) allowlist 에 `policy:brand-floor` 등 사유 명시되어 등재. CI 의 `contrast:check` 가 stale entry 없이 통과.                 | active   |
| UI-FU-02   | SchemaTree 대량 DB(테이블 1k/10k) 의 스크롤 FPS                         | line 353  | (1) Sprint 115 가상화 도입 (✅) 후, 시드 스크립트로 PG 테이블 1000+/10000+ 생성. (2) `pnpm tauri dev` 후 macOS Chromium DevTools (또는 Tauri WebView Inspector) 의 Performance 패널로 스크롤 FPS / 메인스레드 점유율 측정.   | 메인테이너    | (a) 1k 테이블에서 스크롤 평균 ≥ 60 FPS, (b) 10k 테이블에서 ≥ 45 FPS 또는 가상화 path 가 발동되어 DOM 행 수 ≤ 200 유지.                                              | active   |
| UI-FU-03   | DataGrid page size 1000 의 마우스 휠 지연                              | line 354  | (1) Sprint 114 가상화 도입 (✅) 후, page size 1000 시드 + 응답 모킹. (2) DevTools Performance 로 휠 → 첫 paint 까지 latency 측정. (3) `aria-rowcount` 정확도 단언.        | 메인테이너    | (a) 휠 입력 → 다음 paint 의 latency ≤ 16 ms (60 FPS 한 프레임), (b) DOM `<tr>` 수 ≤ 101 (header + viewport).                                                       | active   |
| UI-FU-04   | VoiceOver / NVDA 로 Quick Open / DataGrid / SchemaTree 실제 발화 경로 | line 355  | (1) macOS VoiceOver (Cmd+F5) + Windows NVDA. (2) Quick Open Cmd+P → 결과 행 ↑↓, Enter. DataGrid 셀 ↑↓→← + Enter 편집. SchemaTree 펼침 / F2 rename. (3) 각 단계의 발화를 메모. | 메인테이너    | (a) 핵심 경로(combobox, grid, tree) 가 명사+상태(예: "Connections, expanded, 3 of 12") 형태로 발화. (b) `aria-expanded`, `aria-rowcount`, `aria-activedescendant` 가 실제 SR 에서 일관 작동. | active   |
| UI-FU-05   | 창 최소 크기(1024 × 600) 에서 Sidebar MAX + Dialog 겹침               | line 356  | (1) `pnpm tauri dev` → `tauri.conf.json` 의 minSize 까지 창 축소. (2) Sidebar 폭 최대로 드래그 + ConnectionDialog / FavoritesDialog / SqlPreviewDialog 순차 오픈. (3) overflow / 클리핑 / 버튼 가림 스크린샷.        | 메인테이너    | (a) 1024×600 에서 어느 다이얼로그도 X 닫기 / 액션 버튼이 잘리지 않음. (b) Sidebar 폭과 Dialog 가 겹쳐도 Dialog 가 위에 떠 있고 outside-click / Esc 동작.            | active   |
| UI-FU-06   | Cmd+Shift+I 가 Tauri prod 빌드에서 DevTools 와 충돌하지 않는지        | line 357  | (1) `pnpm tauri build` (release) → 산출물 실행. (2) 앱 안에서 Cmd+Shift+I 입력 → DevTools 가 열리는지 + 같은 키바인딩에 매핑된 앱 내부 액션이 함께 발화하는지 확인. (3) `tauri.conf.json` 의 devtools 플래그도 검토. | 메인테이너    | (a) prod 빌드에서 Cmd+Shift+I 가 의도된 단일 동작만 수행 (앱 액션 또는 DevTools 단독), (b) 충돌 시 키바인딩 재배정 또는 prod-only 차단 로직 적용 결정.            | active   |
| UI-FU-07   | `MainArea.tsx:115-153` EmptyState 가 MRU 정책 도입 필요 여부        | line 358  | (1) 현재 `firstConnected` (단순 first) 동작 확인. (2) 사용자 (메인테이너 / 베타 그룹) 에게 "마지막 사용 연결 자동 선택" vs "명시적 선택 강제" 선호 청취. (3) Sprint 119 spec 으로 결정 사항 인계.            | 메인테이너    | (a) MRU 도입 / 미도입 결정 + 근거. (b) 도입이면 sprint-119 가 구현 path. 미도입이면 본 항목 verified + 사유 기록.                                                  | active   |
| UI-FU-08   | Sprint 67 이후의 Mongo 편집 경로 계획 확정                            | line 359  | (1) `memory/roadmap/memory.md` Phase 6/7 검토. (2) Sprint 117/118 (DocumentDataGrid pagination, Mongo 용어) 결과를 반영. (3) Mongo 편집의 P0 milestone 결정 (read-only banner / partial update / full CRUD). | 메인테이너    | (a) Mongo 편집 P0 가 정의된 ADR 또는 roadmap 항목 존재. (b) 결정된 path 가 `paradigm-ui-map.md` 에 반영.                                                              | active   |
| UI-FU-09   | `pendingEditErrors` 표시가 좁은 컬럼에서 실제로 어떻게 보이는지       | line 360  | (1) DataGrid 에서 폭 80 px 미만 컬럼에 invalid edit 입력 → 에러 메시지 표시. (2) 스크린샷 + 텍스트 클리핑 / 줄바꿈 / overlay 거동 기록. (3) tooltip / popover 보강 필요 여부 판단.                                | 메인테이너    | (a) 에러 메시지가 잘리지 않거나 (b) hover/tooltip 으로 전체 메시지 접근 가능. 미달 시 sprint 신설.                                                                  | active   |

---

## 신규 ⚠️ 항목 추가 절차

1. **ID 부여**: 마지막 ID 다음 번호로 `UI-FU-NN` (zero-pad 두 자리).
2. **출처 링크**: `docs/ui-evaluation-results.md` (또는 후속 평가 문서) 의 line 또는 §번호 명시.
3. **7 필드 채우기**: 한 줄 요약 / 출처 / 검증 절차 / 담당 / 종결 조건 / 상태(`active`).
4. **종결 조건은 측정 가능하게**: "60 FPS 이상", "WCAG AA 4.5 : 1", "ADR 존재" 등 임계값 / 산출물 명시.
5. **RISKS.md cross-link**: 본 문서 (`docs/ui-evaluation-followup.md`) 가 RISKS.md / PLAN.md 에서 참조되어 있음을 확인. 없으면 추가.
6. **종결 시**: 본문 보존 + `상태` 컬럼만 `verified` / `deferred` 로 변경. `deferred` 면 사유 + 재개 조건을 같은 행에 추기.
7. **신규 sprint 가 항목을 해결하면**: 해당 sprint 의 `handoff.md` 에서 `UI-FU-NN` 을 인용하고, 본 문서의 `상태` 를 `verified` 로 갱신.

---

## 참조

- [`docs/ui-evaluation-results.md`](./ui-evaluation-results.md) §8 (출처).
- [`docs/RISKS.md`](./RISKS.md) — 코드 측 잔여 위험. 본 문서는 "정적 분석으로 판정 불가한 UX/A11y/성능 실측 큐" 로 역할 분담.
- [`memory/roadmap/memory.md`](../memory/roadmap/memory.md) — Phase 진행 상태와 교차 확인.
