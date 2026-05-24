---
title: By-surface 인덱스
type: index
generated: 2026-05-24
generator: scripts/regenerate-indexes.sh
---

# By-surface 인덱스

코드 surface (모듈 / 디렉토리) → 관련 ADR/lesson/convention. 자동 생성 — 직접 편집 금지. 메모리 frontmatter 의 `surface:` 필드를 input 으로 한다.

## Surface → 룰 매핑

### `'**/*.test.ts`

- [Mock 범위 — 광역 stub 금지, user-facing invariant 단언](../../memory/conventions/testing-scenarios/mock-scope/memory.md)

### `'**/*.ts`

- [God file 시퀀스](../../memory/conventions/refactoring/god-file/memory.md)

### `**/*.rs'`

- [God file 시퀀스](../../memory/conventions/refactoring/god-file/memory.md)

### `**/*.test.tsx`

- [Mock 범위 — 광역 stub 금지, user-facing invariant 단언](../../memory/conventions/testing-scenarios/mock-scope/memory.md)

### `**/*.tsx`

- [God file 시퀀스](../../memory/conventions/refactoring/god-file/memory.md)

### `.claude/skills`

- [Skill plugin 영역 침범](../../memory/lessons/agent-and-git/2026-05-18-skill-plugin-area-touch/memory.md)

### `e2e/smoke/**/*.ts`

- [Write smoke는 preview close가 아니라 persisted outcome을 검증한다](../../memory/lessons/e2e/2026-05-20-write-smoke-root-cause/memory.md)

### `lefthook.yml`

- [cargo-deny nested git inherited hook env and snapped worktree refs](../../memory/lessons/agent-and-git/2026-05-21-cargo-deny-git-env-ref-snapback/memory.md)
- [pre-push path routing must fail open and include old paths](../../memory/lessons/agent-and-git/2026-05-22-pre-push-path-routing/memory.md)

### `memory/workflow/review`

- [Skill plugin 영역 침범](../../memory/lessons/agent-and-git/2026-05-18-skill-plugin-area-touch/memory.md)

### `scripts/hooks/check-dangerous-bash.sh`

- [pre-bash hook anchor bypass (bash -c quoted)](../../memory/lessons/security/2026-05-18-bash-c-bypass-anchor-fix/memory.md)

### `scripts/hooks/pre-push-path-router.sh`

- [pre-push path routing must fail open and include old paths](../../memory/lessons/agent-and-git/2026-05-22-pre-push-path-routing/memory.md)

### `scripts/hooks/test-pre-push-path-router.sh`

- [pre-push path routing must fail open and include old paths](../../memory/lessons/agent-and-git/2026-05-22-pre-push-path-routing/memory.md)

### `scripts/hooks/test-worktree-push-ref-safety.sh`

- [cargo-deny nested git inherited hook env and snapped worktree refs](../../memory/lessons/agent-and-git/2026-05-21-cargo-deny-git-env-ref-snapback/memory.md)

### `scripts/worktree-spawn.sh`

- [cargo-deny nested git inherited hook env and snapped worktree refs](../../memory/lessons/agent-and-git/2026-05-21-cargo-deny-git-env-ref-snapback/memory.md)

### `src-tauri/**/*.rs`

- [Backend Guidance](../../memory/conventions/backend/memory.md)
- [Rust 컨벤션](../../memory/conventions/rust/memory.md)

### `src-tauri/src/commands/connection.rs`

- [Cold-boot 5-trial drop-slowest protocol](../../memory/runbook/cold-boot/memory.md)

### `src-tauri/src/db/mongodb/mutations.rs`

- [Write smoke는 preview close가 아니라 persisted outcome을 검증한다](../../memory/lessons/e2e/2026-05-20-write-smoke-root-cause/memory.md)

### `src-tauri/src/lib.rs`

- [Cold-boot 5-trial drop-slowest protocol](../../memory/runbook/cold-boot/memory.md)

### `src/**/*.css`

- [Frontend Guidance](../../memory/conventions/frontend/memory.md)

### `src/**/*.ts`

- [Frontend Guidance](../../memory/conventions/frontend/memory.md)
- [React / TypeScript 컨벤션](../../memory/conventions/react/memory.md)

### `src/**/*.tsx`

- [Frontend Guidance](../../memory/conventions/frontend/memory.md)
- [React / TypeScript 컨벤션](../../memory/conventions/react/memory.md)

### `src/lib/mongo/mqlToBulk.ts`

- [Write smoke는 preview close가 아니라 persisted outcome을 검증한다](../../memory/lessons/e2e/2026-05-20-write-smoke-root-cause/memory.md)

### `src/lib/perf/bootInstrumentation.ts`

- [Cold-boot 5-trial drop-slowest protocol](../../memory/runbook/cold-boot/memory.md)

### `vi.mock'`

- [Mock 범위 — 광역 stub 금지, user-facing invariant 단언](../../memory/conventions/testing-scenarios/mock-scope/memory.md)
