# Sprint Execution Brief: sprint-155 — Phase 12 Closure

## Objective

Phase 12 종결. 5개 `it.todo()`를 실제 `it()` 회귀로 변환, ADR 0011 → 0012 supersede, RISK-025 `resolved`, `appShellStore.screen` 좀비 필드 + 잔여 caller 완전 제거. `it.todo` / `describe.skip` 0개로 phase exit.

## Task Why

Sprint 154가 5개 lifecycle 전환을 모두 wired 했으므로 Phase 12의 deferred work 4중 잠금(ADR + RISK + it.todo + findings)은 더 이상 잠금 의미가 없다. 잠금을 풀지 않고 두면 다음 phase가 phase-end skip accountability gate(`memory/lessons/2026-04-27-phase-end-skip-accountability-gate/memory.md`)를 위반한다. 또한 Sprint 154의 P2 finding(`appShellStore.screen` zombie)도 여기서 함께 청산.

## Scope Boundary

- **DO**: ac141.test.tsx 5개 todo → 실제 it 변환 + describe.skip 제거; ADR 0012 신규 + ADR 0011 frontmatter 메타만 갱신; RISKS.md RISK-025 `resolved` 전이; appShellStore의 `screen`/`setScreen`/`AppShellScreen` 완전 제거; Sprint 153 byte-freeze 한 곳(`cross-window-store-sync.test.tsx` AC-153-05) 명시적 적응; appShellStore.test.ts/App.test.tsx 잔여 caller 정리.
- **DO NOT**: Sprint 154 production wiring 재손질; Sprint 150/151/152/154 protected scope 변경; ADR 0011 본문 수정; 추가 Tauri 명령 신설; Phase 13 이후 작업 선제 진행.

## Invariants

- Sprint 150/151/152/154 protected scope `git diff HEAD` empty.
- Sprint 153 scope: AC-153-05 외 byte-identical.
- AC-142-* invariants green.
- AC-141-* (real) 5개 = green (변환 후).
- TS strict; lint clean.
- todo 수 0 (5 → 0 transition).
- ADR 0011 본문 동결 (frontmatter 메타 두 필드만 변경).

## Done Criteria

1. ac141.test.tsx에서 `describe.skip`, `it.todo` 모두 제거. 5개 AC-141-* (real) 케이스가 live `it(...)` + Sprint 154 seam/WebviewWindow mock 단언으로 통과.
2. ADR 0012 신규 생성 (`memory/decisions/0012-multi-window-launcher-workspace/memory.md`), frontmatter `supersedes: 0011`, 본문 3줄 ADR 템플릿.
3. ADR 0011 frontmatter `status: Superseded`, `superseded_by: 0012`. 본문 unchanged.
4. `memory/decisions/memory.md` 인덱스: 0011을 활성 → 역사 이동, 0012 활성 행 추가.
5. RISKS.md RISK-025 `resolved`. 해소 로그 항목 추가. 요약 카운터 재계산.
6. `appShellStore.ts`에서 `screen` 필드 + `setScreen` action + `AppShellScreen` type 제거. store 자체가 비면 파일/import 정리.
7. `grep -rE "useAppShellStore.*screen|setScreen|AppShellScreen" src/` 0 hit.
8. `pnpm vitest run` total ≥ 2298 + N new, **0 todo**; `pnpm tsc --noEmit`, `pnpm lint` 모두 exit 0.
9. `git diff HEAD <Sprint 150/151/152/154 protected scope>` empty.
10. Phase 12 exit gate 6개 항목(spec.md에서 정의) 모두 충족.

## Verification Plan

- **Profile**: mixed (command + static)
- **Required checks** (contract Verification Plan 13개 항목 참조):
  1. `pnpm vitest run src/__tests__/window-lifecycle.ac141.test.tsx` green.
  2. `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` green.
  3. `pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx` green.
  4. `pnpm vitest run` green, total ≥ 2298 + N new, **0 todo**.
  5. `pnpm tsc --noEmit` 0.
  6. `pnpm lint` 0.
  7. `cargo build --manifest-path src-tauri/Cargo.toml` 0.
  8. ac141 skip-grep empty.
  9. screen-grep 0 hit.
  10. Sprint 150/151/152/154 protected scope diff empty.
  11. ADR 0011 frontmatter diff 정확히 2줄.
  12. ADR 0012 존재 + supersedes.
  13. RISK-025 `resolved`.

## Evidence To Return

- 변경 파일 + 한 줄 purpose.
- 명령 + 결과.
- AC-155-01..11 매핑 (구체 artifact).
- 5개 변환된 케이스 이름.
- ADR 0011 frontmatter diff 인용.
- todo count delta (5 → 0) 증거.
- 가정 / 잔여 위험.

## References

- Contract: `docs/sprints/sprint-155/contract.md`
- Master spec Sprint 155 section: `docs/sprints/sprint-150/spec.md`
- Phase 12 exit gate: same spec, "Phase Exit Gate" 섹션
- Sprint 154 wired: `src/lib/window-controls.ts`, `src/lib/window-lifecycle-boot.ts`, `src/pages/HomePage.tsx`, `src/pages/WorkspacePage.tsx`, `src/main.tsx`, `src/__tests__/window-transitions.test.tsx`
- ADR 0011: `memory/decisions/0011-single-window-stub-for-launcher-workspace/memory.md`
- RISK-025: `docs/RISKS.md` (line 50)
- 4중 강제 메커니즘 패턴: `memory/conventions/memory.md`
- Skip-zero gate: `memory/lessons/2026-04-27-phase-end-skip-accountability-gate/memory.md`
- ADR 본문 동결 규칙: `CLAUDE.md` "메모리 팔레스 규칙"
