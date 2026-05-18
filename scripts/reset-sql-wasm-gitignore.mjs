#!/usr/bin/env node
/**
 * Sprint 385 — replace wasm-pack's auto-generated `*` gitignore in
 * `src/lib/sql/wasm/` with a comment-only file, so the generated
 * `.wasm` / JS glue / `.d.ts` artifacts get tracked by git.
 *
 * Rationale:
 * - wasm-pack writes `*` to `<out-dir>/.gitignore` on every build.
 * - We commit those artifacts so frontend developers without a working
 *   Rust + wasm-pack toolchain can still run `pnpm dev` / `pnpm build`.
 * - Re-running `pnpm build:sql-wasm` regenerates the artifacts whenever
 *   the core crate changes; this script runs as the second step.
 *
 * Lives in `scripts/` rather than inlined into the package.json command
 * because the comment text contains backticks which the parent shell
 * would otherwise execute.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "..", "src", "lib", "sql", "wasm", ".gitignore");

const content = `# Sprint 385 — wasm-pack writes "*" here on every build; we replace it
# with this comment-only file so the generated .wasm + JS glue + .d.ts
# artifacts are tracked by git. Frontend devs without a Rust toolchain
# can then pnpm dev / pnpm build without first running build:sql-wasm.
`;

writeFileSync(target, content);
