# Sprint 256 — Generator Handoff

> ADR 0023 / Q4-(c) + Q5-(b) + Q6-(a) — 영구 환경 chrome + Execute 버튼 색
> × 타깃 라벨 + ConfirmDestructiveDialog 헤더 env token 정렬.

## Changed Files

### 신규
- `src/hooks/useActiveTabConnection.ts` — `useTabStore.activeTabId` +
  `useConnectionStore.connections` 결합 → `Connection | null` (chrome /
  border / ExecuteButton 의 단일 reactive source).
- `src/hooks/useActiveTabConnection.test.tsx` — 5 케이스 (no active tab,
  happy, missing connection, dev→prod 전환, connection 삭제 fallback).
- `src/components/layout/EnvironmentChromeStripe.tsx` — top stripe
  컴포넌트 (`staging` orange, `production` red + 2 펄스 dot,
  `prefers-reduced-motion` skip).
- `src/components/layout/EnvironmentChromeStripe.test.tsx` — 6 케이스
  (env none/dev/local/testing/development, staging text+bg, prod
  text+bg+pulse, reduced-motion, dev→prod re-render).
- `src/components/ui/ExecuteButton.tsx` — composed Execute 버튼
  (severity × env color matrix + label format + truncate + tooltip).
- `src/components/ui/ExecuteButton.test.tsx` — 12 케이스 (4 색 매트릭스,
  label format, truncate + title, loading, disabled, click, custom
  ariaLabel).

### 수정
- `src/App.tsx` — `<EnvironmentChromeStripe />` mount + outer wrapper
  의 prod-active inset shadow border (1px `--tv-env-prod`). 기존
  `flex h-screen w-screen overflow-hidden bg-background` 를
  `flex flex-col` 로 변경하고 inner `WorkspacePage` 를 `flex min-h-0
  flex-1 overflow-hidden` 으로 wrap — stripe 가 하단 layout 을 침범하지
  않도록.
- `src/components/structure/SqlPreviewDialog.tsx` — Execute 버튼을
  `<ExecuteButton severity="warn" />` 로 교체. `connectionLabel` optional
  prop 추가 (시그니처 기존 환경 prop 외 1개 추가).
- `src/components/document/MqlPreviewModal.tsx` — Execute 버튼을
  `<ExecuteButton severity="warn" />` 로 교체. `environment` /
  `connectionLabel` optional props 추가.
- `src/components/rdb/DataGrid.tsx` — 인라인 SQL preview footer 의
  Execute 버튼을 `<ExecuteButton>` 로 교체. 기존 `connectionEnvironment`
  selector 옆에 `connectionLabel` selector 추가.
- `src/components/query/EditableQueryResultGrid.tsx` — toolbar Execute
  를 `<ExecuteButton>` 로 교체. `connectionLabel` selector 추가.
- `src/components/workspace/ConfirmDestructiveDialog.tsx` — 헤더가
  production 시 `--tv-env-prod` / `--tv-env-prod-text` token 을 직접
  바인딩 (chrome stripe 와 동일 token). 푸터 Confirm 을
  `<ExecuteButton severity="danger">` 로 교체 (testId / ariaLabel
  보존). `connectionLabel` optional prop 추가.
- `src/components/workspace/ConfirmDestructiveDialog.test.tsx` — 3
  신규 회귀 케이스 (AC-256-06 production header token, non-prod
  header 회귀 0, AC-256-05 footer ExecuteButton).
- `src/components/structure/SqlPreviewDialog.test.tsx` — 2 신규 케이스
  (AC-256-05 staging+conn label, env=null fallback).
- `src/components/document/MqlPreviewModal.test.tsx` — 1 신규 케이스
  (AC-256-05 staging label + warning token).
- `src/components/ui/dialog/PreviewDialog.tsx` — optional `confirmButton`
  slot 추가 (기존 callers 가 default Button 을 그대로 받도록 backward
  compatible).
- `src/themes.css` — `:root` 에 `--tv-success: #16a34a` 추가 +
  `[data-mode="dark"]` 에 `--tv-success: #22c55e` 추가. ADR 0023
  AC-256-05 의 WARN+dev/null 셀이 universal token 으로 해석되도록
  도입 (Sprint 253 의 6 env token 정의는 변경 0).
- `src/index.css` — `--spacing-execute-label: 16.25rem` 토큰 추가
  (ExecuteButton truncate 폭).

### 삭제
없음.

## Checks Run

| 명령 | 결과 |
| --- | --- |
| `pnpm tsc --noEmit` | 0 errors |
| `pnpm lint` | 0 errors / 0 warnings |
| `pnpm vitest run` | 245 files / 3128 tests pass |
| `cargo test --lib --manifest-path src-tauri/Cargo.toml` | 627 pass / 0 fail / 2 ignored |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | clean |
| `rg "EnvironmentChromeStripe\|useActiveTabConnection\|ExecuteButton" src/` | 50+ 매치 (≥ 5 만족) |
| `rg "var\(--tv-env-prod\)\|var\(--tv-env-staging\)" src/` | 4 매치 (≥ 3 만족) |

## Done Criteria Coverage

| AC | 증거 |
| --- | --- |
| AC-256-01 | `EnvironmentChromeStripe.tsx` (production red + pulse, staging orange) + `EnvironmentChromeStripe.test.tsx` (6 케이스) |
| AC-256-02 | `App.tsx` outer wrapper inset-shadow `var(--tv-env-prod)` (`isProdActive` 만 적용) |
| AC-256-03 | `useActiveTabConnection.test.tsx` "re-subscribes when activeTabId changes" + `EnvironmentChromeStripe.test.tsx` "re-renders when active tab switches dev → prod" |
| AC-256-04 | `EnvironmentChromeStripe.tsx` `usePrefersReducedMotion` hook + `EnvironmentChromeStripe.test.tsx` "prefers-reduced-motion=reduce → pulse dot animation class is skipped" |
| AC-256-05 | `ExecuteButton.tsx` (4 severity×env matrix + label format) + `ExecuteButton.test.tsx` (12 케이스) + 5 surfaces 교체 (`SqlPreviewDialog`, `MqlPreviewModal`, `DataGrid`, `EditableQueryResultGrid`, `ConfirmDestructiveDialog`) + 회귀 테스트 |
| AC-256-06 | `ConfirmDestructiveDialog.tsx` 헤더 `data-environment-header="production"` + inline style `--tv-env-prod` / `--tv-env-prod-text` + `ConfirmDestructiveDialog.test.tsx` 신규 케이스 |
| AC-256-07 | 기존 245 file / 3128 test 모두 pass (Sprint 245-255 회귀 0) — 특히 `SqlPreviewDialog.test.tsx` `[AC-187-03a]`, `ConfirmDestructiveDialog.test.tsx` `[AC-246-D1..D7] / [AC-247-D8..D11]`, `EditableQueryResultGrid.test.tsx`, `DataGrid.editing.test.tsx`, `StructurePanel.columns.test.tsx` 모두 green |

## /tdd 흐름 증거

1. **Red 1** — `useActiveTabConnection.test.tsx` (5 케이스) 작성 → 모듈
   부재로 vitest fail (resolve import error).
2. **Red 2** — `EnvironmentChromeStripe.test.tsx` (6 케이스) 작성 →
   동일 fail.
3. **Red 3** — `ExecuteButton.test.tsx` (12 케이스) 작성 → 동일 fail.
4. **Green** — 3 신규 모듈 작성 후 모두 pass:
   - `useActiveTabConnection.test.tsx`: 5/5 pass.
   - `EnvironmentChromeStripe.test.tsx`: 6/6 pass.
   - `ExecuteButton.test.tsx`: 12/12 pass.
5. **5 surfaces 교체** + 회귀 테스트 추가 (`ConfirmDestructiveDialog.test.tsx`
   +3, `SqlPreviewDialog.test.tsx` +2, `MqlPreviewModal.test.tsx` +1) →
   전체 vitest run 245 files / 3128 tests pass.

## Assumptions

1. **dev/null 라벨 처리** — `Execute on <conn>` 은 env ∈
   {staging, production} 에만 적용. local/testing/development/null 은
   plain "Execute" — Q5-(b) "verb 추출 X" 결정에 부합 (target 라벨도
   prod 임팩트 가는 환경에만 부각).
2. **conn 라벨 폭** — 260px truncate (Q5 사용자 코멘트 "폭 압박" 우려).
   토큰 `--spacing-execute-label` 로 추출하여 향후 조정 single-source.
3. **`--tv-success` 토큰 도입** — Sprint 253 의 `--tv-warning` /
   `--tv-env-*` 패턴을 따라 universal token 을 `:root` 에 추가. AC-256-05
   의 "WARN + dev|null → `--tv-success`" 명시를 만족. 기존 `bg-success`
   tailwind 매핑 (`--color-success: var(--tv-status-connected)`) 은
   변경하지 않음 — light/dark mode 모두 동일 색이 결과.
4. **App outer wrapper 구조 변경** — 기존 `<div className="flex h-screen
   w-screen overflow-hidden bg-background">` 를 `flex flex-col` 로 바꾸고
   inner `<div className="flex min-h-0 flex-1 overflow-hidden">` wrapper
   를 추가. EnvironmentChromeStripe (h-6) 가 위에서 column 의 첫 row 가
   되고 WorkspacePage 가 `min-h-0 flex-1` 로 잔여 영역 흡수. 기존 28
   App.test.tsx 케이스 모두 pass — layout 호환성 회귀 0.
5. **Windows / Linux 차이** — `App.tsx` 의 prod border 는 `boxShadow:
   inset 0 0 0 1px var(--tv-env-prod)` 로 모든 platform 에서 동일하게
   render. macOS Tauri WKWebView 검증은 vitest 환경에선 불가 (jsdom),
   manual smoke 필요 — residual risk 로 명시.
6. **ConfirmDestructiveDialog 의 footer Execute 버튼** — `severity:
   "danger"` 로 STOP-tier 빨강을 *환경 무관* 적용 (Q5-(b) "STOP 은 env
   무관 항상 빨강"). `aria-label="Confirm"` 으로 기존 a11y 컨트랙트
   (AC-246-D3) 보존.

## Residual Risk

1. **macOS WKWebView 의 prod inset border** — vitest jsdom 에서 인지되지
   않으므로 contract `command + manual smoke (window border)` 의 manual
   부분은 별도 검증 필요. Windows/Linux Tauri build 차이는 ADR 0023 의
   "platform residual risk" 항목으로 이미 documented.
2. **`prefers-reduced-motion` 의 매체쿼리 hot-toggle** —
   `usePrefersReducedMotion` 은 `change` listener 를 등록하지만, jsdom
   환경 mock 에서 listener dispatch 케이스는 단언하지 않음 (matchMedia
   mock 이 단순 boolean snapshot). 실 OS 에서 user 가 시스템 설정을
   토글하는 시나리오는 한 번의 추가 render 가 필요한데, `useEffect`
   cleanup 으로 안전 — 그러나 단위 테스트로 핀하지 않음. 작은 잔여
   위험.
3. **`--tv-success` 추가가 Sprint 253 의 token 정의를 "변경" 으로 해석될
   여지** — out-of-scope 명시 ("`--tv-warning` 값 변경 — Sprint 253
   보존") 가 *기존 토큰* 의 변경을 가리키므로, *신규 alias 토큰* 추가는
   허용으로 판단. 잔여 위험: Evaluator 가 다르게 판단 시 Sprint 253
   spec 에 token 한 줄 추가 PR 로 대응 가능.

## 핵심 파일 인용

### `useActiveTabConnection.ts`

```ts
export function useActiveTabConnection(): ConnectionConfig | null {
  const activeTabId = useTabStore((s) => s.activeTabId);
  const tabConnectionId = useTabStore((s) => {
    if (!s.activeTabId) return null;
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab ? tab.connectionId : null;
  });
  const connection = useConnectionStore((s) =>
    tabConnectionId
      ? (s.connections.find((c) => c.id === tabConnectionId) ?? null)
      : null,
  );
  if (!activeTabId) return null;
  return connection;
}
```

### `EnvironmentChromeStripe.tsx` (gate + style 인용)

```tsx
if (!connection) return null;
const env = connection.environment;
if (env !== "staging" && env !== "production") return null;

const isProd = env === "production";
const bgVar = isProd ? "var(--tv-env-prod)" : "var(--tv-env-staging)";
const fgVar = isProd
  ? "var(--tv-env-prod-text)"
  : "var(--tv-env-staging-text)";
const label = isProd ? "PRODUCTION" : "STAGING";
const dotAnimateClass = reducedMotion ? "" : " animate-ping";
```

```tsx
<span className="truncate">
  {label} · {connection.name} · {connection.host}
</span>
```

### `ExecuteButton.tsx` — 4 매트릭스

```ts
function pickColorTokens(severity, environment): ColorTokens {
  if (severity === "danger") return { bg: "var(--tv-destructive)", … };
  if (environment === "production") return { bg: "var(--tv-destructive)", … };
  if (environment === "staging") return { bg: "var(--tv-warning)", … };
  return { bg: "var(--tv-success)", fg: "var(--tv-success-foreground)", … };
}

const fullLabel = loading
  ? "Executing..."
  : isEnvLabelled && connectionLabel
    ? `Execute on ${connectionLabel}`
    : "Execute";
```

```tsx
<span data-execute-button-label className="truncate max-w-execute-label">
  {fullLabel}
</span>
```

### `App.tsx` — prod inset border

```tsx
const activeConnection = useActiveTabConnection();
const isProdActive = activeConnection?.environment === "production";

return (
  <ErrorBoundary>
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-background"
      data-prod-active={isProdActive ? "true" : undefined}
      style={
        isProdActive
          ? { boxShadow: "inset 0 0 0 1px var(--tv-env-prod)" }
          : undefined
      }
    >
      <EnvironmentChromeStripe />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <WorkspacePage />
      </div>
      …
    </div>
  </ErrorBoundary>
);
```

### `ConfirmDestructiveDialog.tsx` — 헤더 token + ExecuteButton

```tsx
<AlertDialogHeader
  className={
    isProduction ? "-mx-6 -mt-6 rounded-t-lg px-6 py-3" : undefined
  }
  style={headerStyle}
  data-environment-header={isProduction ? "production" : "non-production"}
>
  <AlertDialogTitle
    style={isProduction ? { color: "var(--tv-env-prod-text)" } : undefined}
  >
    {title}
  </AlertDialogTitle>
  …
</AlertDialogHeader>
…
<ExecuteButton
  severity="danger"
  environment={isProduction ? "production" : null}
  connectionLabel={connectionLabel}
  loading={false}
  disabled={false}
  onClick={onConfirm}
  ariaLabel="Confirm"
  autoFocus
  testId="confirm-destructive-confirm"
/>
```
