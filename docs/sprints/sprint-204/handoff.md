# Sprint 204 — Handoff

`logger` 중앙화 + DEV-only gate. console.* 13곳 → `logger.*`.
행동 변경 0 (prod console 노이즈 제거).

## 결과

| 검증 | 결과 |
|------|------|
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm vitest run` | 189 files / 2732 tests pass (+7 from `logger.test.ts`) |
| 잔존 `console.*` | 1건 (`bootInstrumentation:187`, 의도적 prod 단일라인) |

## 변경 파일

신규:
- `src/lib/logger.ts` (38 lines)
- `src/lib/logger.test.ts` (95 lines, 7 tests)
- `docs/sprints/sprint-204/{contract,findings,handoff}.md`

수정 (13곳 console → logger + 10 import 추가):
- `src/main.tsx` (2 console + 1 import)
- `src/AppRouter.tsx` (1 console + 1 import)
- `src/components/shared/ErrorBoundary.tsx` (1 console + 1 import)
- `src/components/schema/DocumentDatabaseTree.tsx` (1 console + 1 import, if-gate 제거)
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` (2 console + 1 import, if-gate ×2 제거)
- `src/hooks/useSchemaCache.ts` (helper 안 if-gate 제거 + 1 import)
- `src/lib/window-lifecycle-boot.ts` (1 console + 1 import)
- `src/lib/window-controls.ts` (2 console + 1 import)
- `src/pages/WorkspacePage.tsx` (1 console + 1 import)
- `src/pages/HomePage.tsx` (1 console + 1 import)

## 다음 후보

PLAN sequencing 갱신 후보:
- Sprint 205 = §4 `catch {}` audit + DEV-log 분류 (~40곳)
- Sprint 206 = §6 e2e skip 14곳 점검
- Sprint 207 = §7 Rust prod expect
- Sprint 208 = `tabStore.ts` (1002) 분해 (§1-1 frontend god #4)
- Sprint 209 = `commands/connection.rs` (1710) 분할 (§1-2 backend god #2)

§4 catch {} 가 본래 Sprint 204 row 의 § 4-5 중 5만 처리. §4 audit 작업
(silent failure 분류 + 일부 logger 추가) 은 별도 sprint slot 추가
(Sprint 205 후보).
