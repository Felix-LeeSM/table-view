// Sprint 384 (2026-05-17) — backward-compat shim.
//
// 작성 이유: sprint-383 의 1033 LOC 단일 파일을 4-file 디렉토리로 split
// 했다 (`./mongoshAst/`). 본 파일은 호출부 (`runCommandParser.ts`,
// 테스트 등) 의 import path 를 유지하기 위한 re-export shim — 새 코드는
// `./mongoshAst/index.ts` 를 직접 import 해도 동일하다.

export * from "./mongoshAst/index";
