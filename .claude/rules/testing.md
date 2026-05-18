---
paths:
  - "**/*.rs"
  - "**/*.{ts,tsx}"
  - "e2e/**/*"
---

# 테스트 wrapper

새 테스트 작성 / 수정 전 source 먼저 read:

- 비-E2E (unit / component / store / integration): [`memory/conventions/testing-scenarios/memory.md`](../../memory/conventions/testing-scenarios/memory.md)
- E2E: [`memory/conventions/e2e-scenarios/memory.md`](../../memory/conventions/e2e-scenarios/memory.md)
- Rust / React 메커니즘 룰: [`memory/conventions/rust/memory.md`](../../memory/conventions/rust/memory.md) + [`memory/conventions/react/memory.md`](../../memory/conventions/react/memory.md)

검증: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, `cargo test`.
