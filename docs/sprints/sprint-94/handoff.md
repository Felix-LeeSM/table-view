# Sprint 94 → next Handoff

## Sprint 94 Result
- **Generator hand-off** (1 attempt)
- 6 AC 전부 hookup 완료, 회귀 0 (1679 / 1679 tests, sprint-93 대비 +19 신규).

## 산출물
- `src/lib/toast.ts` (신규): Zustand 기반 toast API. `toast.success/error/info/warning/dismiss/clear`, `useToastStore`, `roleForVariant`. caller-supplied id 충돌 시 in-place 교체 (pending → done update 패턴 지원). `durationMs: null` sticky.
- `src/components/ui/toaster.tsx` (신규): toast 컨테이너. `fixed top-4 right-4 z-100` (dialog overlay z-50 위). 각 토스트 `role={status|alert}` + `aria-live={polite|assertive}`. Esc LIFO dismiss (큐 비어있으면 preventDefault 안 함). dismiss 버튼 `aria-label="Dismiss notification"`.
- `src/App.tsx`: `<Toaster />` App root 마운트 (modal portal 외부).
- `src/components/datagrid/useDataGridEdit.ts`: SQL/MQL 양쪽 branch 의 `handleExecuteCommit` 에 toast hookup. SQL 부분 실패 메시지 "executed: N, failed at: K of M" 포함. MQL 빈 catch 도 toast.error 로 채움.
- `src/stores/connectionStore.ts`: `addConnection/updateConnection/removeConnection` 에 success toast. remove 는 mutation 전 이름 캡쳐.
- `src/lib/toast.test.ts` (신규, 8 테스트).
- `src/components/ui/toaster.test.tsx` (신규, 11 테스트).

## 인계
- **확장 가능 hookup**: query 실행 성공/실패, schema 변경, copy 완료 등은 sprint-94 범위 외 — 후속 sprint 에서 동일한 `toast.*` API 로 추가 가능. `connectionStore` 와 동일하게 store 레벨에서 hookup 하면 caller 가 자동 혜택.
- **action 버튼 미지원**: sonner / react-hot-toast 의 `toast.success("msg", { action: { label, onClick } })` 같은 액션 버튼은 미구현. 필요 시 `Toast` 인터페이스에 optional `action?: { label, onClick }` 추가 + ToastItem 에서 렌더하면 OK. 기존 caller 영향 없음.
- **에러 toast 의 sticky 정책**: 현재 default 6 초. partial-failure 같은 긴 메시지는 caller 에서 `toast.error(msg, { durationMs: null })` 로 sticky 처리 가능.
- **Toaster Esc handler 와 dialog Esc 충돌**: 토스트가 있을 때만 Esc 를 swallow. Radix dialog 가 열려있고 토스트도 떠있을 때, Esc 한 번이면 토스트가 먼저 사라지고 두 번째 Esc 가 dialog 를 닫음. 사용자 리포트가 발생하면 토스트 컨테이너에 `data-prevent-dialog-esc="false"` 같은 opt-out 도입 검토.
