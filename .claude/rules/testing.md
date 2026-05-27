---
paths:
  - "**/*.rs"
  - "**/*.{ts,tsx}"
  - "e2e/**/*"
---

# 테스트 wrapper

새 테스트 작성 / 수정 전 source 먼저 read:

- 비-E2E (unit / component / store / integration): [`memory/engineering/conventions/testing-scenarios/memory.md`](../../memory/engineering/conventions/testing-scenarios/memory.md)
- E2E: [`memory/engineering/conventions/e2e-scenarios/memory.md`](../../memory/engineering/conventions/e2e-scenarios/memory.md)
- Rust / React 메커니즘 룰: [`memory/engineering/conventions/rust/memory.md`](../../memory/engineering/conventions/rust/memory.md) + [`memory/engineering/conventions/react/memory.md`](../../memory/engineering/conventions/react/memory.md)

검증: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, `cargo test`.
