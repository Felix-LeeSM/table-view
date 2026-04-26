# Sprint 141 — Findings (Tooltip 카피 정리)

## AC 커버리지

- **AC-141-1** PASS — `/src/__tests__/no-stale-sprint-tooltip.test.ts` 의 `STALE_REGEX` 가드(legacy)는 src/ 트리에서 0건. `DbSwitcher.tsx` 의 `READ_ONLY_TOOLTIP = "Switching DBs lands in sprint 130"` 상수가 `readOnlyTooltipCopy()` 함수로 교체되어 sprint 번호 leak 사라짐.
- **AC-141-2** PASS — 동일 테스트 파일에 `PROSE_REGEXES` 4종 추가 (`coming|lands?|arrives?|available in (sprint|phase) N`), comment-only line 은 `isCommentLine()` 휴리스틱으로 제외. `Sprint 141 — broader sprint/phase prose guard (AC-141-2)` describe 블록 통과.
- **AC-141-3** PASS — `DbSwitcher.tsx` read-only `<span>` 에서 native `title=` 제거. `DbSwitcher.test.tsx` 의 "does not expose a native HTML title attribute on the read-only trigger (AC-141-3)" 단언 통과 (`expect(trigger).not.toHaveAttribute("title")`).
- **AC-141-4** PASS — `readOnlyTooltipCopy({hasActiveTab, paradigm, isConnected})` 가 4개 분기로 user-facing 카피 분기:
  - `!hasActiveTab` → "Open a connection to switch databases."
  - `kv` / `search` → "Database switching isn't supported for this connection type."
  - `!isConnected` → "Connect to switch databases."
  - else → "Database switching isn't available right now."
  Radix `<TooltipContent>` 에 노출, 카피에 sprint/phase 번호 0건.
- **AC-141-5** PASS — `QueryEditor.tsx` (kv/search placeholder) 와 `UnsupportedShellNotice.tsx`, `QueryTab.tsx` 의 inline kv/search placeholder 모두 "is planned but not yet available" / "Not available yet" 패턴으로 교체. 대응 테스트(`UnsupportedShellNotice.test.tsx`, `WorkspaceSidebar.test.tsx`) 도 새 카피로 갱신.

## Verification (Verification Plan: command)

```
pnpm vitest run     → Test Files 139 passed (139), Tests 2146 passed (2146)
pnpm tsc --noEmit   → exit 0, 출력 0줄
pnpm lint           → exit 0, 출력 0줄 (eslint .)
```

## 변경 파일 (purpose)

| 파일 | 목적 |
|---|---|
| `src/components/workspace/DbSwitcher.tsx` | `READ_ONLY_TOOLTIP` 상수 → `readOnlyTooltipCopy()` 분기 함수, native `title=` 제거, Radix Tooltip 만 노출 |
| `src/components/workspace/DbSwitcher.test.tsx` | sprint-130 카피 단언 → AC-141-3/4 단언으로 교체 |
| `src/components/workspace/UnsupportedShellNotice.tsx` | "Phase 9" / "coming in Phase 9" → "Not available yet" / "is planned but not yet implemented" |
| `src/components/workspace/UnsupportedShellNotice.test.tsx` | 새 카피로 단언 갱신 |
| `src/components/workspace/WorkspaceSidebar.test.tsx` | placeholder 카피 단언 갱신 |
| `src/components/query/QueryEditor.tsx` | kv/search placeholder 카피 → version-agnostic |
| `src/components/query/QueryTab.tsx` | inline kv/search placeholder 카피 → version-agnostic |
| `src/__tests__/no-stale-sprint-tooltip.test.ts` | `PROSE_REGEXES` 가드 + `isCommentLine()` 추가, AC-141-2 describe 블록 신설 |

## 가정 / 위험 / 미해결

- 가드 테스트의 `PROSE_REGEXES` 는 현재 4 패턴만 잡는다. "shipping in Sprint N" 같은 미래 표현이 새로 들어오면 추가 패턴이 필요하다. 의도된 trade-off — 너무 광범위하면 false positive 가 늘어난다.
- `isCommentLine()` 은 행 단위 휴리스틱(`//`, `*`, `/*` 시작) 이므로 multi-line 문자열 / 템플릿 리터럴 안에 잘못된 카피가 들어가도 잡힐 수 있다. 이는 의도된 동작 — 사용자 노출 카피는 어디에 들어가든 막아야 한다.
- 문서(`docs/sprints/`)는 가드 스캔 대상이 아니므로 sprint-126/sprint-139 등 과거 finding 에 남은 "coming in Phase 9" 표현은 그대로 둔다 (역사적 사실 기록).
