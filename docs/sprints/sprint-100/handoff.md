# Sprint 100 → next Handoff

## Sprint 100 Result
- **PASS** (8.5/10, 1 attempt)
- 4 AC 모두 PASS, 회귀 0 (1744 / 1744 tests, +9 신규).

## 산출물
- `src/types/query.ts`: 새 `QueryStatementResult { sql; status; result?; error?; durationMs }` + `QueryState.completed` 에 `statements?: QueryStatementResult[]` (옵셔널, 단일 statement backwards compat).
- `src/components/query/QueryTab.tsx`:
  - 다중 루프가 statement 별 결과 수집 (성공/실패 무관).
  - 부분 실패 → `status: "completed" + statements` (의미 변경: 이전엔 `"error"`).
  - 모두 실패 → `status: "error"` (legacy shape 보존).
  - `addHistoryEntry` 는 부분 실패 시 여전히 `"error"` 로 기록 (history marker 호환).
- `src/components/query/QueryResultGrid.tsx`:
  - `CompletedSingleResult` 추출 + 신규 `CompletedMultiResult` (Radix Tabs).
  - `statements.length >= 2` 게이트 — length 0/1 은 단일 그리드 fallback.
  - 탭 트리거: `Statement {n} {verb}` + rows/ms/✕ 뱃지. 실패 탭에 `data-status="error"` + destructive 클래스.
  - 콘텐츠: 성공 → 기존 `SelectResultArea`/`DmlMessage`/`DdlMessage` 재사용. 실패 → "Statement {n} failed: {error}" 빨간 배너.
- `src/components/query/QueryTab.test.tsx`: 기존 `combines errors` 테스트 → 새 의미로 갱신 (3 신규: partial-failure-stays-completed / all-fail-still-error / all-success-happy-path) + non-Error rejection 갱신.
- `src/components/query/QueryResultGrid.multi-statement.test.tsx` (신규, 7 케이스): AC-01..04 + content-swap.

## 인계
- **부분 실패 status 시맨틱 변화**: top-level `status: "error"` 가 아니라 `"completed" + statements`. 외부 소비자가 `queryState.status === "error"` 로 분기하면 이전엔 catch 됐지만 이제 안 됨 → `statements.some(s => s.status === "error")` 로 보강 필요. 현재는 `QueryResultGrid` 만 production 소비자.
- **History marker**: `addHistoryEntry` 가 여전히 `"error"` 로 기록 — UI history panel 의 fail-marker 동작은 보존됨.
- **Radix Tabs activationMode**: default `"automatic"` — ArrowLeft/Right 가 즉시 탭 전환. manual 로 바꾸면 Enter/Space 로만 활성화.
- **Tab 활성화는 mouseDown** (Radix 동작, click 아님): 테스트는 `fireEvent.mouseDown` 사용.
- **`statements.length === 1` 엣지케이스**: 명시적으로 단일 그리드 경로 — multi-statement.test.tsx 가 이를 테스트.
- **EditableQueryResultGrid 미수정**: 자체 데이터 흐름 (편집 grid). 다중 결과 적용 시 sprint 후속 후보.

## 다음 Sprint 후보
- sprint-101 ~ 123: 잔여 ui-evaluation findings.
- 후속: EditableQueryResultGrid 다중 결과 지원, history panel 의 partial-fail 표시 일관화.
