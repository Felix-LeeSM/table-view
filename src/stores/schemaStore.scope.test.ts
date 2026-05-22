/**
 * `schemaStore` scope axis — L2 책임 누수 정리. 작성 2026-05-16 (Phase 0
 * sprint-354).
 *
 * 사유: state-management-strategy L2 (Part B) — `schemaStore` 는 schema
 * introspection 캐시 책임에 한정한다. `queryTableData`/`executeQuery`/
 * `executeQueryBatch`/`dropTable`/`renameTable` 5 메서드는 캐시 write 가
 * 0 인 thin pass-through 라 store interface 에서 제거하고 caller 가
 * `@lib/tauri/*` 직접 호출하도록 옮긴다.
 *
 * Public-surface 검증:
 *   (1) store 의 5 메서드가 `undefined` (제거 확인).
 *   (2) 기존 schema-fetching 메서드 (loadSchemas / loadTables / ...) 는
 *       그대로 정의되어 있음.
 *
 * grep CI (AC-354-05) 는 별도 test (scope-grep) 으로 호출 사이트 0 검증.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { useSchemaStore } from "./schemaStore";

/**
 * Walk `dir` recursively and return every `.ts` / `.tsx` file path.
 * Excludes test files to keep the assertion focused on production
 * call sites; the contract requires "src/components/**\/*.tsx" but we
 * additionally cover src/hooks for the same selector pattern.
 */
function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const out: string[] = [];
  for (const name of entries) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (
      (name.endsWith(".ts") || name.endsWith(".tsx")) &&
      !name.includes(".test.") &&
      !full.includes("__tests__")
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("schemaStore — scope (L2 fix)", () => {
  it("AC-354-04 — non-schema 5 methods removed from store (queryTableData / executeQuery / executeQueryBatch / dropTable / renameTable)", () => {
    const state = useSchemaStore.getState() as unknown as Record<
      string,
      unknown
    >;
    expect(state.queryTableData).toBeUndefined();
    expect(state.executeQuery).toBeUndefined();
    expect(state.executeQueryBatch).toBeUndefined();
    expect(state.dropTable).toBeUndefined();
    expect(state.renameTable).toBeUndefined();
  });

  it("AC-354-05 — grep CI: no production file under src/components or src/hooks reads useSchemaStore.<5-non-schema-method>", () => {
    // Walk src/components and src/hooks; assert no file (outside tests)
    // references `useSchemaStore` together with any of the 5 retired
    // method names. This fences future regressions: someone who reaches
    // for the old indirection will trip the grep before TS catches the
    // missing method.
    const root = resolve(__dirname, "../components");
    const hooksRoot = resolve(__dirname, "../hooks");
    const files = [...listSourceFiles(root), ...listSourceFiles(hooksRoot)];
    const offendingMethods = [
      "queryTableData",
      "executeQuery",
      "executeQueryBatch",
      "dropTable",
      "renameTable",
    ];
    const offenders: { file: string; method: string; line: string }[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      if (!text.includes("useSchemaStore")) continue;
      const lines = text.split("\n");
      for (const line of lines) {
        if (!line.includes("useSchemaStore")) continue;
        // Comments referencing the old store paths (e.g. doc strings) are
        // not behavioural reads — skip lines that are clearly comments.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        for (const m of offendingMethods) {
          // Match `s.dropTable` / `.queryTableData` style accessor patterns
          // — bare identifier inside a comment / unrelated context would
          // already have been filtered above.
          if (line.includes(`.${m}`)) {
            offenders.push({ file, method: m, line: line.trim() });
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("AC-354-06 — schema-fetching surface preserved and clearSchema alias retired", () => {
    const state = useSchemaStore.getState();
    const publicState = state as unknown as Record<string, unknown>;
    expect(typeof state.loadSchemas).toBe("function");
    expect(typeof state.loadTables).toBe("function");
    expect(typeof state.loadViews).toBe("function");
    expect(typeof state.loadFunctions).toBe("function");
    expect(typeof state.getTableColumns).toBe("function");
    expect(typeof state.getTableIndexes).toBe("function");
    expect(typeof state.getTableConstraints).toBe("function");
    expect(typeof state.getTableTriggers).toBe("function");
    expect(typeof state.refreshTableTriggers).toBe("function");
    expect(typeof state.getViewColumns).toBe("function");
    expect(typeof state.getViewDefinition).toBe("function");
    expect(publicState.clearSchema).toBeUndefined();
    expect(typeof state.clearForConnection).toBe("function");
    expect(typeof state.clearForWorkspace).toBe("function");
    expect(typeof state.evictSchemaForName).toBe("function");
    expect(typeof state.prefetchSchemaColumns).toBe("function");
  });
});
