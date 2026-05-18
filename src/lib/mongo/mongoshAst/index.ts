// Sprint 384 (2026-05-17) — public re-export shim for the mongosh AST.
//
// 작성 이유: sprint-383 의 1033 LOC `mongoshAst.ts` 가 max-lines soft cap
// 을 두 배 초과 → 본 sprint 가 lexer / parser / argList 3개 + 본 index
// re-export 로 split. 호출부 (`runCommandParser.ts`, 테스트) 는
// `import { parseMongoshStatement } from "@/lib/mongo/mongoshAst"` 그대로
// 유지 — `mongoshAst.ts` 는 한 줄 shim 으로, `mongoshAst/index.ts` 는
// 디렉토리 entrypoint 로 동거.

export { parseMongoshStatement } from "./parser";
export type {
  MongoshErrorKind,
  MongoshAdminCommand,
  MongoshCollectionCommand,
  MongoshParseError,
  MongoshStatementResult,
} from "./lexer";
