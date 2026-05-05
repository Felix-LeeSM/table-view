# Sprint 214 — Generator Findings

## Summary

`useDdlPreviewExecution` hook 신규 (245 lines) + 3 Structure editor 적용
(ColumnsEditor 775 → 695, IndexesEditor 579 → 489, ConstraintsEditor 649 → 559).
공통 commit lifecycle (`previewSql` / `previewLoading` / `previewError` /
`pendingConfirm` state, `;`-split + `useSafeModeGate.decide` 루프, warn-tier
`pendingConfirm` 핸들오프, history record `source: "ddl-structure"` /
`paradigm: "rdb"` / `queryMode: "sql"`, `onRefresh` 트리거, `cancelPreview`
reset) 을 hook 으로 통합. 3 editor 는 hook 호출 + (a) preview / (b) commit
closure 두 개만 전달. **행동 변경 0** — 4 regression test (26 cases)
byte-identical 보존.

## Line-count Delta

| File | Pre | Post | Delta |
|---|---:|---:|---:|
| `useDdlPreviewExecution.ts` | 0 (new) | 245 | +245 |
| `ColumnsEditor.tsx` | 775 | 695 | -80 |
| `IndexesEditor.tsx` | 579 | 489 | -90 |
| `ConstraintsEditor.tsx` | 649 | 559 | -90 |
| **Sum** | 2003 | 1988 | -15 |

3 editor 합산 사후 1743 (사전 2003) — net -260. Hook +245 흡수 후
overall -15 lines (contract budget 2153 대비 165 lines 여유).

## Hook Surface

```ts
interface UseDdlPreviewExecutionOptions {
  connectionId: string;
  onRefresh: () => Promise<void>;
}

interface UseDdlPreviewExecutionResult {
  previewSql: string;
  previewLoading: boolean;
  previewError: string | null;
  pendingConfirm: { reason: string; sql: string } | null;
  loadPreview: (
    requestPreview: () => Promise<{ sql: string }>,
    prepareCommit: () => () => Promise<void>,
  ) => Promise<void>;
  attemptExecute: () => Promise<void>;
  confirmDangerous: () => Promise<void>;
  cancelDangerous: () => void;
  cancelPreview: () => void;
}
```

- 입력 2 개 (connectionId / onRefresh) — contract 의 ≤4 props 룰 충족.
- 출력 9 키 (state 4 + 함수 5).
- Tauri 호출 hook 안 0 — `requestPreview` / `prepareCommit` closure 로 caller
  가 주입.
- history payload `source: "ddl-structure"` / `paradigm: "rdb"` /
  `queryMode: "sql"` hardcoded.

## 17 Checks 결과

| # | Check | Result |
|--:|---|---|
|  1 | `wc -l useDdlPreviewExecution.ts` 80–250 | 245 ✓ |
|  2 | 3 editor 사전 미만 | 695 < 775, 489 < 579, 559 < 649 ✓ |
|  3 | 4 파일 합산 ≤ 2153 | 1988 ✓ |
|  4 | 4 regression test diff 0 | 0 changes ✓ |
|  5 | 4 regression test exit 0 (24 + 2 = 26 cases) | 26 passed ✓ |
|  6 | `pnpm vitest run` exit 0 (189 files / 2720 tests baseline) | 189 / 2720 ✓ |
|  7 | `pnpm tsc --noEmit` exit 0 | EXIT=0 ✓ |
|  8 | `pnpm lint` exit 0 | EXIT=0 ✓ |
|  9 | `useDdlPreviewExecution` 매치 ≥ 6 in 3 editor | 9 매치 (3 import + 3 호출 + 3 코멘트) ✓ |
| 10 | 4 useState 매치 0 | 0 ✓ |
| 11 | `pendingExecuteRef` 0 in Indexes/Constraints | 0 ✓ |
| 12 | `split(";")` 0 in 3 editor | 0 ✓ |
| 13 | hook 안 `tauri.` 0 | 0 ✓ (JSDoc 의 `tauri.` 참조 제거 — caller 패턴 예시는 백틱 유지) |
| 14 | 3 default export | 3 ✓ |
| 15 | hook 외부 import ≤ 3 | 3 (3 editor) ✓ |
| 16 | StructurePanel.tsx diff 0 | 0 changes ✓ |
| 17 | 새 eslint-disable 0 | 0 매치 ✓ |

## AC Evidence

### AC-01 — Hook 파일 존재 + 80-250 + named export
```
$ wc -l src/components/structure/useDdlPreviewExecution.ts
     245 src/components/structure/useDdlPreviewExecution.ts
$ grep -n "^export" src/components/structure/useDdlPreviewExecution.ts
3 매치 (interface DdlPreviewPendingConfirm, interface UseDdl…Options,
        interface UseDdl…Result, function useDdlPreviewExecution)
```
`export function useDdlPreviewExecution` 라인 1 매치.

### AC-02 — 3 editor 가 hook 사용 + 4 useState 0
```
$ grep -n "useDdlPreviewExecution" 3 editor → 9 매치
$ grep -nE "useState[<(].*previewSql|useState[<(].*previewLoading|useState[<(].*previewError|useState[<(].*pendingConfirm" 3 editor → 0
```

### AC-03 — Boilerplate 감소
- `wc -l ColumnsEditor.tsx` = 695 < 775 ✓
- `wc -l IndexesEditor.tsx` = 489 < 579 ✓
- `wc -l ConstraintsEditor.tsx` = 559 < 649 ✓
- 4 파일 합산 1988 ≤ 2153 ✓

### AC-04 — 4 regression test byte-identical
```
$ git diff --stat 4 test files → empty
$ pnpm vitest run … 4 test files → 26 passed
```

### AC-05 — 회귀 0
- `pnpm vitest run` → 189 files / 2720 tests passed (baseline 동일)
- `pnpm tsc --noEmit` → EXIT=0
- `pnpm lint` → EXIT=0
- 새 `eslint-disable*` 0
- 새 silent `catch{}` 0
- `StructurePanel.tsx` diff 0

## Assumptions

1. **Hook 출력 shape** — `{ previewSql, previewLoading, previewError,
   pendingConfirm, loadPreview, attemptExecute, confirmDangerous,
   cancelDangerous, cancelPreview }` 9 키. brief 의 권장 shape 그대로.
   별도 `setPreviewSql` 노출 안 함 — 모든 caller 가 `loadPreview` 통해 SQL
   설정하는 패턴으로 통일.
2. **Commit closure 패턴** — `prepareCommit: () => () => Promise<void>`
   factory 형태 채택. ColumnsEditor 의 도메인 cleanup
   (`pendingChanges` / `drafts` / `droppedColumns` / `editingColumn` /
   `showSqlModal` reset) 은 closure 안에서 처리. IndexesEditor /
   ConstraintsEditor 도 closure 안에서 `setShowPreviewModal(false)` 처리.
3. **`showSqlModal` / `showPreviewModal` 잔존** — 도메인 dialog mount
   조건이라 editor 자체 잔존 (hook 의 4 lifecycle state 와는 별도 책임).
   Brief 의 `previewSql/Loading/Error/PendingConfirm` 4 state 만 hook 으로
   이동 명시 — `show*Modal` 은 명시 안 됨.
4. **History payload hardcoded** — `source: "ddl-structure"` /
   `paradigm: "rdb"` / `queryMode: "sql"` 모두 hook 안 hardcoded (3
   editor 모두 동일, props 화 불필요).
5. **`cancelPreview` 의 책임 한정** — preview SQL / error / pendingConfirm
   reset + commit closure clear. 도메인 reset (예: ColumnsEditor 의
   `pendingChanges = []`) 은 editor 자체 책임. ColumnsEditor 의
   `handleCancelPending` 이 hook 의 `cancelPreview` 호출 후 도메인 cleanup
   순서로 호출.
6. **Hook unit test 미작성** — refactor-only sprint, 4 regression test (26
   cases) 가 통합 커버하므로 추가 unit test 작성 안 함 (contract 선택 허용).

## Residual Risk

- **race during preview 미해결** — preview fetch + commit closure
  registration 사이의 race (사용자가 두 번 빠르게 클릭) 는 사전 동일하게
  잔존. `pendingExecuteRef` 패턴이 hook 내부로 이동했지만 cancel/abort 보호
  추가 없음. P7 candidate 가 명시한 대로 lifecycle 추출만이 본 sprint 범위.
- **Hook 의 `useCallback` deps** — `runCommit` 의 deps array 에 `previewSql`
  포함 → 매 SQL set 시 함수 identity 변경. 실측 영향 없음 (SqlPreviewDialog
  의 onConfirm prop 은 매 render 에서 새 closure 받지만 dialog 안에서
  identity 비교 안 함). 후속 cycle 에서 `useRef` 로 latest sql 참조
  최적화 가능.
- **하위 editor 의 `connectionEnvironment` selector 중복** — 3 editor 모두
  `useConnectionStore((s) => …environment)` 직접 호출. hook 안에서 환경
  selector 도 받을 수 있지만 contract 의 ≤4 props 룰 + UI 책임 분리
  (stripe 는 SqlPreviewDialog 의 `environment` prop) 때문에 잔존. P9/P10
  candidate 에서 다룰 수 있음.
- **추후 새 DDL editor 추가 시 hook props ≤4 룰 위반 위험** — 현재 connectionId /
  onRefresh 두 개 only. trigger / sequence editor 등이 환경 selector,
  추가 cleanup callback 등을 요구하면 hook props 가 늘어날 수 있음.
  contract 의 P7 risk note 가 이미 경고.
