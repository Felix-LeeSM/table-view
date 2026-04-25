# Sprint 116 → next Handoff

## Sprint 116 Result

- **PASS** (Generator 직접 적용 + Evaluator 8.85/10, 1 attempt) — 1829/1829 tests, tsc/lint 0. 정적 문서 sprint, 코드 변경 0.
- Evaluator follow-up 적용분: (a) 담당 컬럼 관례 1 줄 명시, (b) `deferred` 행 형식 예시 1 줄 — 모두 `docs/ui-evaluation-followup.md` 상태 어휘 직후에 추가.

## 산출물

- `docs/ui-evaluation-followup.md` (신규):
  - 머리말 — 출처 (`ui-evaluation-results.md` §8) + 목적 + 갱신 정책.
  - 상태 어휘 표 — `active` / `verified` / `deferred` 정의.
  - 추적 항목 표 — UI-FU-01 ~ UI-FU-09 (총 9 행) × 7 필드 (ID / 한 줄 요약 / 출처 / 검증 절차 / 담당 / 종결 조건 / 상태). 모두 초기 상태 `active`.
  - 신규 ⚠️ 추가 절차 — 7 단계.
  - 참조 — `ui-evaluation-results.md` / `RISKS.md` / `memory/roadmap/memory.md`.
- `docs/RISKS.md`:
  - 머리말 `Last updated` 갱신 (2026-04-19 → 2026-04-25 + Sprint 116 사유).
  - "참고 문서" 섹션 신설 → `ui-evaluation-followup.md` 1 줄 링크.
- `docs/sprints/sprint-116/{contract.md, execution-brief.md, handoff.md}`.

## 9 ⚠️ 항목 매핑

| ID       | §8 line | 한 줄 요약                                                            | 종결 조건 (요약)                                                |
|----------|---------|-----------------------------------------------------------------------|-----------------------------------------------------------------|
| UI-FU-01 | 352     | 72 테마 × light/dark WCAG AA 실측                                    | `contrast:check` allowlist stale 0 + axe 핵심 화면 AA 통과       |
| UI-FU-02 | 353     | SchemaTree 1k/10k 테이블 스크롤 FPS                                  | 1k ≥ 60 FPS, 10k ≥ 45 FPS 또는 가상화 발동 + DOM 행 ≤ 200       |
| UI-FU-03 | 354     | DataGrid page 1000 휠 지연                                            | 휠 → 다음 paint ≤ 16 ms, DOM `<tr>` ≤ 101                       |
| UI-FU-04 | 355     | VoiceOver / NVDA 실제 발화                                           | combobox / grid / tree 핵심 경로의 명사+상태 발화 일관           |
| UI-FU-05 | 356     | 1024 × 600 에서 Sidebar MAX + Dialog 겹침                             | X / 액션 버튼 미클립 + Dialog 가 위에 떠 outside-click / Esc OK |
| UI-FU-06 | 357     | Cmd+Shift+I prod 빌드 DevTools 충돌                                  | prod 빌드에서 단일 동작 + 충돌 시 키 재배정                      |
| UI-FU-07 | 358     | EmptyState MRU 정책 결정                                             | MRU 도입 / 미도입 결정 + ADR 또는 sprint-119 path                |
| UI-FU-08 | 359     | Sprint 67 이후 Mongo 편집 P0 정의                                    | Mongo 편집 P0 ADR 또는 roadmap 갱신                              |
| UI-FU-09 | 360     | `pendingEditErrors` 좁은 컬럼 시각화                                | 메시지 미클립 또는 hover/tooltip 으로 전체 접근                  |

## AC Coverage

- AC-01 ✅ — `ui-evaluation-followup.md` line 1-3 머리말이 출처 + 목적 + 갱신 정책 명시. line 9-15 가 상태 어휘 정의.
- AC-02 ✅ — `grep -nE 'UI-FU-0[1-9]' docs/ui-evaluation-followup.md` → 9 줄. §8 의 9 개 ⚠️ 항목 (line 352-360) 누락 없이 매핑.
- AC-03 ✅ — 추적 항목 표가 검증 절차 / 담당 / 종결 조건 컬럼을 항상 채움 (행별 7 필드).
- AC-04 ✅ — 모든 항목 상태 컬럼 = `active` (초기). 어휘 정의 머리말에 명시.
- AC-05 ✅ — `docs/RISKS.md` 9 행 "참고 문서" 섹션이 `ui-evaluation-followup.md` 링크.
- AC-06 ✅ — `docs/ui-evaluation-followup.md` 의 "신규 ⚠️ 항목 추가 절차" 섹션 (7 단계).
- AC-07 ✅ — `pnpm vitest run` 1829/1829, `pnpm tsc --noEmit` 0, `pnpm lint` 0.

## 검증 명령 결과

- `pnpm vitest run` → 107 files / **1829 / 1829** tests pass.
- `pnpm tsc --noEmit` → 0.
- `pnpm lint` → 0.
- `grep -nE 'UI-FU-0[1-9]' docs/ui-evaluation-followup.md | wc -l` → **9**.
- `grep -nE 'ui-evaluation-followup' docs/RISKS.md` → 1 줄 매치.

## 가정 / 리스크

- 담당자는 모두 "메인테이너" 로 통일 (현 단일-인 메인테이너). 팀 확장 시 행별로 변경 필요.
- UI-FU-02 / UI-FU-03 은 sprint-114 / sprint-115 가상화로 부분 완화되었으나 실측은 별도 — 본 추적은 "측정 의무" 자체.
- UI-FU-07 (EmptyState MRU) 은 sprint-119 가 의사결정 sprint 로 예정. 본 추적은 결정 자체를 강제하지 않고 "잊히지 않게" 하는 역할.

## 회귀 0

- 코드 변경 0. 1829/1829 통과 (sprint-115 baseline 유지).
