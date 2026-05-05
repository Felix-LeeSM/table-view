# Sprint 204 — Contract

Sprint: `sprint-204` (refactor — logger 중앙화 + DEV-only gate).
Date: 2026-05-05.
Type: refactor (행동 변경 0; DEV gate 통일 + prod console 노이즈 제거).

[`docs/PLAN.md`](../../PLAN.md) Sprint 204 row + [`/CODE_SMELLS.md`](../../../CODE_SMELLS.md) §4–5.
짧은 sprint. 신규 `src/lib/logger.ts` + 14 console.* 중 13곳 마이그레이션.

## Sprint 안에서 끝낼 단위

### `src/lib/logger.ts` 신규

DEV gate 를 한 곳에 모은 wrapper. `import.meta.env.DEV` 가 false 면
no-op, true 면 `console.{warn,error,info}` 그대로 forward.

```ts
const isDev = import.meta.env.DEV;

export const logger = {
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    if (isDev) console.error(...args);
  },
  info: (...args: unknown[]) => {
    if (isDev) console.info(...args);
  },
};
```

테스트 (`logger.test.ts`): DEV / prod 양쪽에서 forwarding 동작 + args 보존.

### console.* 13곳 마이그레이션

[`/CODE_SMELLS.md`](../../../CODE_SMELLS.md) 부록 C 의 14곳 중 13곳 →
`logger.*` 호출로 변경. 1곳 (`bootInstrumentation.ts:187` =
sprint-175 의도적 prod 단일 라인) 은 유지.

| # | 파일 | 라인 | 함수 | 기존 DEV gate | 마이그레이션 |
|---|------|------|------|---------------|---------------|
| 1 | `src/main.tsx` | 53 | `console.warn` | 없음 | `logger.warn` |
| 2 | `src/main.tsx` | 85 | `console.error` | 없음 | `logger.error` |
| 3 | `src/AppRouter.tsx` | 99 | `console.warn` | 없음 | `logger.warn` |
| 4 | `src/components/shared/ErrorBoundary.tsx` | 28 | `console.error` | 없음 | `logger.error` |
| 5 | `src/components/schema/DocumentDatabaseTree.tsx` | 227 | `console.error` | 있음 (감싸는 if 제거) | `logger.error` |
| 6 | `src/components/schema/SchemaTree/useSchemaTreeActions.ts` | 262 | `console.error` | 있음 (감싸는 if 제거) | `logger.error` |
| 7 | `src/components/schema/SchemaTree/useSchemaTreeActions.ts` | 327 | `console.error` | 있음 (감싸는 if 제거) | `logger.error` |
| 8 | `src/hooks/useSchemaCache.ts` | 30 | `console.error` (`logSchemaError` helper 안) | 있음 (헬퍼 안 if 제거) | `logger.error` |
| 9 | `src/lib/window-lifecycle-boot.ts` | 52 | `console.warn` | 없음 | `logger.warn` |
| 10 | `src/lib/window-controls.ts` | 44 | `console.warn` | 없음 | `logger.warn` |
| 11 | `src/lib/window-controls.ts` | 168 | `console.warn` | 없음 | `logger.warn` |
| 12 | `src/pages/WorkspacePage.tsx` | 65 | `console.warn` | 없음 | `logger.warn` |
| 13 | `src/pages/HomePage.tsx` | 148 | `console.warn` | 없음 | `logger.warn` |

유지 (1곳):
- `src/lib/perf/bootInstrumentation.ts:187` — `console.info` 의도적 prod
  단일라인 (sprint-175 invariant). logger 우회 — 향후 telemetry 분리 시
  재논의.

## Acceptance Criteria

### AC-204-01 — `console.*` 직접 호출 13곳 → 0건

- `grep -nE "^\s*console\." --include="*.ts" --include="*.tsx" src/` 실행 시:
  - `src/lib/logger.ts` (helper 안 forwarding) 만 매치.
  - `src/lib/perf/bootInstrumentation.ts:187` 매치 (의도적 유지).
  - 나머지 13곳 0 matches.
- 테스트 / 주석 / `__tests__` 의 `console.*` 은 본 sprint 범위 외.

### AC-204-02 — `logger.ts` + 테스트

- `src/lib/logger.ts` 존재. `logger.{warn,error,info}` export.
- `src/lib/logger.test.ts` 존재. DEV / prod 양쪽 forward + no-op 검증.
  최소 6 test cases (`warn|error|info × DEV|prod`).

### AC-204-03 — 회귀 0

- 전체 vitest baseline 통과 (Sprint 203 baseline = 188 files / 2725 tests).
- 신규 logger.test.ts 추가로 +N tests.
- `pnpm tsc --noEmit` exit 0.
- `pnpm lint` exit 0.

## Out of scope

- §4 `catch {}` 패턴 정책 — 본 sprint 미적용. logger 도입 후 별도 sprint
  에서 catch 의 silent failure 분류 (Best-effort vs DEV-log 필요).
- `bootInstrumentation.ts:187` 의 `console.info` — 의도적 prod 단일라인
  (sprint-175 invariant 보존). 추후 telemetry channel 추가 시 재논의.
- 향후 telemetry / native log channel — logger 가 fan-out 진입점이지만
  본 sprint 는 console wrapper 까지만.

## 검증 명령

```sh
pnpm tsc --noEmit
pnpm lint
pnpm vitest run src/lib/logger.test.ts
pnpm vitest run
grep -nE "^\s*console\." --include="*.ts" --include="*.tsx" src/
```

기대값: tsc 0 / lint 0 / logger tests pass / 전체 vitest 188+ files 모두 pass /
console grep 결과 = `logger.ts` (helper) + `bootInstrumentation.ts:187`
두 파일만 매치.
