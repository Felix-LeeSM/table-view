#!/usr/bin/env node
/**
 * Sprint 401 — replace wasm-pack's auto-generated `*` gitignore in
 * `src/lib/mongo/wasm/` with a comment-only file, so the generated
 * `.wasm` / JS glue / `.d.ts` artifacts get tracked by git.
 *
 * Mirrors `scripts/reset-sql-wasm-gitignore.mjs` (sprint-385) — same
 * rationale: frontend developers without a working Rust + wasm-pack
 * toolchain should still be able to run `pnpm dev` / `pnpm build`
 * against the checked-in artifacts. Re-running `pnpm build:mongosh-wasm`
 * regenerates them whenever the core crate changes; this script runs
 * as the second step.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "..", "src", "lib", "mongo", "wasm", ".gitignore");

const content = `# Sprint 401 — wasm-pack writes "*" here on every build; we replace it
# with this comment-only file so the generated .wasm + JS glue + .d.ts
# artifacts are tracked by git. Frontend devs without a Rust toolchain
# can then pnpm dev / pnpm build without first running build:mongosh-wasm.
`;

writeFileSync(target, content);
