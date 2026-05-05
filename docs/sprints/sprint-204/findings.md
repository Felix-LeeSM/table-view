# Sprint 204 — Findings

`logger` 중앙화 + DEV-only gate. console.* 13곳 → `logger.*`.
`bootInstrumentation:187` 1곳 의도적 prod 유지. 행동 변경 0.

## §1 — `logger.ts` 설계

```ts
export function makeLogger(isDev: boolean): Logger { ... }
export const logger: Logger = makeLogger(import.meta.env.DEV);
```

`makeLogger(isDev)` builder 분리 이유: `import.meta.env.DEV` 는 vite
가 build time inline 하므로 vitest 에서 toggle 불가. builder seam 으로
DEV / prod 양쪽 검증 가능.

테스트 7 cases (`logger.test.ts`):
- DEV mode: warn / error / info forward args 검증 (×3)
- prod mode: 각 메서드 no-op (×3)
- prod no-cross-channel: prod 에서 다른 채널로 새지 않음 검증 (×1)

## §2 — 13곳 마이그레이션

| # | 파일 | 라인 | 변경 |
|---|------|------|------|
| 1 | `src/main.tsx` | 53 | `console.warn` → `logger.warn` |
| 2 | `src/main.tsx` | 85 | `console.error` → `logger.error` |
| 3 | `src/AppRouter.tsx` | 99 | `console.warn` → `logger.warn` |
| 4 | `src/components/shared/ErrorBoundary.tsx` | 28 | `console.error` → `logger.error` |
| 5 | `src/components/schema/DocumentDatabaseTree.tsx` | 226-228 | `if(DEV) console.error` → `logger.error` (gate 제거) |
| 6 | `src/components/schema/SchemaTree/useSchemaTreeActions.ts` | 261-263 | `if(DEV) console.error` → `logger.error` (gate 제거) |
| 7 | `src/components/schema/SchemaTree/useSchemaTreeActions.ts` | 326-328 | `if(DEV) console.error` → `logger.error` (gate 제거) |
| 8 | `src/hooks/useSchemaCache.ts` | 28-32 | `logSchemaError` helper 안 if 제거 → `logger.error` |
| 9 | `src/lib/window-lifecycle-boot.ts` | 52 | `console.warn` → `logger.warn` |
| 10 | `src/lib/window-controls.ts` | 44 | `console.warn` → `logger.warn` |
| 11 | `src/lib/window-controls.ts` | 168 | `console.warn` → `logger.warn` |
| 12 | `src/pages/WorkspacePage.tsx` | 65 | `console.warn` → `logger.warn` |
| 13 | `src/pages/HomePage.tsx` | 148 | `console.warn` → `logger.warn` |

import alias 패턴은 각 파일의 기존 toast / window-controls / themeCatalog
import 와 일치 (`@lib/logger` 또는 `@/lib/logger` 또는 `./logger` 의
혼재 — 파일별 로컬 컨벤션 보존).

## §3 — 행동 변경 분석

| 측면 | 기존 | 신규 |
|------|------|------|
| DEV console 출력 | 파일마다 다름 (4곳 gate 있음, 9곳 gate 없음) | 13곳 모두 `logger` (DEV gate) |
| prod console 출력 | 9곳 출력 (사용자 devtools 보통 닫힘 → effective 0) | 13곳 0건 (`logger` no-op) |
| 출력 채널 | `console.{warn,error,info}` 직접 | `logger.{warn,error,info}` → DEV 시 `console.*` forward |
| 잔존 prod console | `bootInstrumentation:187` (의도적) | 동일 |

prod 출력 9곳 → 0건: 사용자 facing 영향 0. devtools 가 닫힌 prod 환경
에서 `console.*` 는 어차피 사용자 가시성 0. 향후 telemetry / native log
channel 추가 시 `logger` 가 단일 fan-out 진입점 역할.

## §4 — 검증 결과

| 항목 | 결과 |
|------|------|
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm vitest run src/lib/logger.test.ts` | 7 passed |
| `pnpm vitest run` (전체) | 189 files / 2732 tests pass |
| `grep -nE "^\s*console\." src/` | `logger.ts` (helper) + `bootInstrumentation:187` 만 매치 |

baseline: Sprint 203 = 188 files / 2725 tests → 신규 logger.test.ts 로
+1 file / +7 tests. 기존 테스트 회귀 0.

## §5 — Out-of-scope

- **§4 `catch {}` 패턴 정책** (CODE_SMELLS 부록 A ~40곳) — 본 sprint 미적용.
  audit + 분류 작업 (Best-effort vs DEV-log 필요 vs surface to user) 이
  별도 sprint 분량. PLAN sequencing 에 후속 slot 추가.
- **`bootInstrumentation:187`** — sprint-175 invariant (production-safe
  single-line boot summary) 보존. logger 우회.
- **telemetry / native log channel** — 본 sprint 는 console wrapper 까지.
  향후 sprint 에서 logger 의 fan-out (telemetry adapter / Tauri native
  log invoke / 로그 파일) 추가 시 logger 가 단일 진입점.

## §6 — `useSchemaCache.ts` helper 단순화

`logSchemaError` helper 가 `if (import.meta.env.DEV) { console.error(...) }`
패턴이었음. logger 가 자체 gate 라 if 제거:

```ts
// before
function logSchemaError(label: string, err: unknown): void {
  if (import.meta.env.DEV) {
    console.error(`[useSchemaCache] ${label}:`, err);
  }
}

// after
function logSchemaError(label: string, err: unknown): void {
  logger.error(`[useSchemaCache] ${label}:`, err);
}
```

helper 자체는 보존 — `[useSchemaCache] {label}:` 라벨 포맷팅이 9 call
site 에서 일관되게 적용되어야 함. helper 제거 시 9곳에서 라벨 prefix
중복.
