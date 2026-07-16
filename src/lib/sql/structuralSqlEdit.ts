import { safeStringifyCell } from "@lib/jsonCell";
import {
  arrayElementToLiteral,
  arrayElementType,
  classifySqlType,
  coerceToSqlLiteral,
  escapeSqlString,
  NUMERIC_RE,
  type SqlDialect,
} from "@lib/sql/sqlLiteral";

export interface NestedSqlEdit {
  key: string;
  path: string | null;
  value: string | null;
}

type EmitResult =
  | { kind: "expr"; expr: string }
  | { kind: "error"; message: string };

/**
 * Structural-edit sentinel. `__op__:unset` in pendingEdits value means "remove
 * this path"; translated to `col #- '{path}'` for JSONB or to array element
 * removal (splice + reassign) for ARRAY.
 */
const UNSET_OP = "__op__:unset";

function jsonbPathLiteral(path: string): string {
  const segments: string[] = [];
  // Split on dots that aren't inside brackets, then expand `key[i]` to
  // `key`, `i`.
  for (const part of path.split(".")) {
    if (part === "") continue;
    const re = /([^[\]]+)|\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(part)) !== null) {
      if (m[1] !== undefined) segments.push(m[1]);
      else if (m[2] !== undefined) segments.push(m[2]);
    }
  }
  // Quote each segment, escape `"` and `\`.
  const quoted = segments
    .map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  return `'{${quoted}}'`;
}

function jsonbValueLiteral(value: string): string {
  let json: string;
  if (value === "null") json = "null";
  else if (value === "true" || value === "false") json = value;
  else if (NUMERIC_RE.test(value)) json = value;
  else json = safeStringifyCell(value);
  return `${escapeSqlString(json)}::jsonb`;
}

export function isJsonbColumn(dataType: string): boolean {
  return dataType.toLowerCase() === "jsonb";
}

/**
 * Does this column hold structural JSON we can dispatch on?
 *
 * - postgresql -> `jsonb`
 * - mysql -> `json`
 * - sqlite -> none
 */
export function isStructuralJsonColumn(
  dataType: string,
  dialect: SqlDialect | undefined,
): boolean {
  const lower = dataType.toLowerCase().trim();
  if (dialect === "postgresql") return lower === "jsonb";
  if (dialect === "mysql") return lower === "json";
  return false;
}

export function isArrayColumn(dataType: string): boolean {
  return arrayElementType(dataType) !== null;
}

function mysqlPathLiteral(path: string): string {
  const segments = splitJsonbPath(path);
  if (segments.length === 0) return "'$'";
  let out = "$";
  for (const seg of segments) {
    if (/^\d+$/.test(seg)) {
      out += `[${seg}]`;
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(seg)) {
      out += `.${seg}`;
    } else {
      // Unsafe identifier: quote it per MySQL JSON path grammar.
      out += `."${seg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
  }
  return `'${out.replace(/'/g, "''")}'`;
}

function mysqlJsonValueLiteral(value: string): string {
  if (value === "null") return "CAST('null' AS JSON)";
  if (value === "true" || value === "false") return value.toUpperCase();
  if (NUMERIC_RE.test(value)) return value;
  return `CAST(${escapeSqlString(safeStringifyCell(value))} AS JSON)`;
}

export function emitMysqlJsonUpdate(
  colName: string,
  cellValue: unknown,
  nested: NestedSqlEdit[],
): EmitResult {
  const base =
    cellValue === null || cellValue === undefined
      ? `COALESCE(${colName}, JSON_OBJECT())`
      : colName;
  let expr = base;
  for (const ne of nested) {
    if (!ne.path) {
      return { kind: "error", message: "nested edit missing path" };
    }
    const pathLit = mysqlPathLiteral(ne.path);
    if (pathLit === "'$'") {
      return {
        kind: "error",
        message: `Cannot derive a JSON path from "${ne.path}"`,
      };
    }
    if (ne.value === UNSET_OP) {
      expr = `JSON_REMOVE(${expr}, ${pathLit})`;
    } else if (ne.value === null) {
      expr = `JSON_SET(${expr}, ${pathLit}, CAST('null' AS JSON))`;
    } else {
      expr = `JSON_SET(${expr}, ${pathLit}, ${mysqlJsonValueLiteral(ne.value)})`;
    }
  }
  return { kind: "expr", expr };
}

function splitJsonbPath(path: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === ".") {
      if (buf) out.push(buf);
      buf = "";
    } else if (ch === "[") {
      if (buf) out.push(buf);
      buf = "";
      const end = path.indexOf("]", i + 1);
      if (end === -1) return [];
      const idx = path.slice(i + 1, end);
      if (!/^\d+$/.test(idx)) return [];
      out.push(idx);
      i = end;
    } else {
      buf += ch;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export function emitJsonbUpdate(
  colName: string,
  cellValue: unknown,
  nested: NestedSqlEdit[],
): EmitResult {
  const base =
    cellValue === null || cellValue === undefined
      ? `COALESCE(${colName}, '{}'::jsonb)`
      : colName;
  let expr = base;
  for (const ne of nested) {
    if (!ne.path) {
      return { kind: "error", message: "nested edit missing path" };
    }
    const pathLit = jsonbPathLiteral(ne.path);
    if (pathLit === "'{}'") {
      return {
        kind: "error",
        message: `Cannot derive a JSON path from "${ne.path}"`,
      };
    }
    if (ne.value === UNSET_OP) {
      expr = `${expr} #- ${pathLit}`;
    } else if (ne.value === null) {
      expr = `jsonb_set(${expr}, ${pathLit}, 'null'::jsonb, true)`;
    } else {
      expr = `jsonb_set(${expr}, ${pathLit}, ${jsonbValueLiteral(ne.value)}, true)`;
    }
  }
  return { kind: "expr", expr };
}

/**
 * #1441 P3-2 — ponytail: whole-array reassign is the known ceiling here. Every
 * element edit/delete/append re-emits the ENTIRE array
 * (`col = ARRAY[...]::type[]`), so a concurrent change another session made to
 * an *untouched* element is clobbered, and arbitrary-precision `numeric[]`
 * elements round-trip through a JS number. Postgres-only element-level
 * assignment (`SET col[i] = v` for edits, subscript slicing for delete/append)
 * would remove the untouched-element clobber but needs a caller SET-fragment
 * contract change and still reshapes on delete/append; not worth it at P3.
 * Instead the generator raises `onArrayWholeReassign` so the commit surfaces a
 * user-visible warning. Upgrade path: element-level SET fragment if
 * concurrent-array editing becomes a real workload.
 */
export function emitArrayUpdate(
  colName: string,
  dataType: string,
  cellValue: unknown,
  nested: NestedSqlEdit[],
): EmitResult {
  const elementType = arrayElementType(dataType);
  if (elementType === null) {
    return { kind: "error", message: `Not an ARRAY column: ${dataType}` };
  }
  if (elementType === "jsonb" || elementType === "json") {
    return emitJsonbArrayUpdate(
      colName,
      elementType as "jsonb" | "json",
      cellValue,
      nested,
    );
  }
  const elementFamily = classifySqlType(elementType);

  const original = Array.isArray(cellValue) ? (cellValue as unknown[]) : [];
  type Action = { kind: "edit"; value: string | null } | { kind: "delete" };
  const actions = new Map<number, Action>();
  const INDEX_RE = /^\[(\d+)\]$/;
  for (const ne of nested) {
    const m = ne.path ? INDEX_RE.exec(ne.path) : null;
    if (!m) {
      return {
        kind: "error",
        message: `Only single-index ARRAY paths are supported, got "${ne.path}".`,
      };
    }
    const idx = parseInt(m[1]!, 10);
    if (ne.value === UNSET_OP) actions.set(idx, { kind: "delete" });
    else actions.set(idx, { kind: "edit", value: ne.value });
  }

  const out: string[] = [];
  for (let i = 0; i < original.length; i++) {
    const a = actions.get(i);
    if (a?.kind === "delete") continue;
    if (a?.kind === "edit") {
      const coerced = coerceToSqlLiteral(a.value, elementType);
      if (coerced.kind === "error") {
        return { kind: "error", message: coerced.message };
      }
      out.push(coerced.sql);
    } else {
      out.push(arrayElementToLiteral(original[i], elementFamily));
    }
  }
  const extraIndexes = Array.from(actions.keys())
    .filter((i) => i >= original.length)
    .sort((a, b) => a - b);
  for (const i of extraIndexes) {
    const a = actions.get(i)!;
    if (a.kind === "delete") continue;
    const coerced = coerceToSqlLiteral(a.value, elementType);
    if (coerced.kind === "error") {
      return { kind: "error", message: coerced.message };
    }
    out.push(coerced.sql);
  }

  return {
    kind: "expr",
    expr: `ARRAY[${out.join(", ")}]::${elementType}[]`,
  };
}

function emitJsonbArrayUpdate(
  colName: string,
  elementType: "jsonb" | "json",
  cellValue: unknown,
  nested: NestedSqlEdit[],
): EmitResult {
  const original = Array.isArray(cellValue) ? (cellValue as unknown[]) : [];
  type Action =
    | { kind: "whole-edit"; value: string }
    | { kind: "whole-delete" }
    | { kind: "inner-edit"; innerPath: string; value: string | null };
  const actions = new Map<number, Action[]>();
  const PATH_RE = /^\[(\d+)\](?:\.(.+))?$/;
  for (const ne of nested) {
    if (!ne.path) {
      return { kind: "error", message: "nested jsonb[] edit missing path" };
    }
    const m = PATH_RE.exec(ne.path);
    if (!m) {
      return {
        kind: "error",
        message: `jsonb[] paths must start with [N], got "${ne.path}".`,
      };
    }
    const idx = parseInt(m[1]!, 10);
    const inner = m[2];
    const bucket = actions.get(idx) ?? [];
    if (!inner) {
      if (ne.value === UNSET_OP) bucket.push({ kind: "whole-delete" });
      else if (ne.value === null) {
        return {
          kind: "error",
          message: "jsonb[] whole-element edit cannot use null value",
        };
      } else bucket.push({ kind: "whole-edit", value: ne.value });
    } else {
      bucket.push({ kind: "inner-edit", innerPath: inner, value: ne.value });
    }
    actions.set(idx, bucket);
  }

  const out: string[] = [];
  for (let i = 0; i < original.length; i++) {
    const acts = actions.get(i);
    if (!acts || acts.length === 0) {
      out.push(`${colName}[${i + 1}]`);
      continue;
    }
    let dropSlot = false;
    let baseExpr = `${colName}[${i + 1}]`;
    for (const a of acts) {
      if (a.kind === "whole-delete") {
        dropSlot = true;
        baseExpr = "";
      } else if (a.kind === "whole-edit") {
        dropSlot = false;
        baseExpr = jsonbValueLiteral(a.value);
      } else {
        const pathLit = jsonbPathLiteral(a.innerPath);
        if (pathLit === "'{}'") {
          return {
            kind: "error",
            message: `Cannot derive a JSON path from "${a.innerPath}"`,
          };
        }
        if (a.value === UNSET_OP) {
          baseExpr = `${baseExpr} #- ${pathLit}`;
        } else if (a.value === null) {
          baseExpr = `jsonb_set(${baseExpr}, ${pathLit}, 'null'::jsonb, true)`;
        } else {
          baseExpr = `jsonb_set(${baseExpr}, ${pathLit}, ${jsonbValueLiteral(a.value)}, true)`;
        }
      }
    }
    if (!dropSlot) out.push(baseExpr);
  }

  const extraIndexes = Array.from(actions.keys())
    .filter((i) => i >= original.length)
    .sort((a, b) => a - b);
  for (const i of extraIndexes) {
    const acts = actions.get(i)!;
    let baseExpr: string | null = null;
    let dropSlot = false;
    for (const a of acts) {
      if (a.kind === "whole-delete") {
        dropSlot = true;
        baseExpr = null;
      } else if (a.kind === "whole-edit") {
        dropSlot = false;
        baseExpr = jsonbValueLiteral(a.value);
      } else {
        return {
          kind: "error",
          message: `jsonb[] inner-path edit on missing index [${i}] — add the element first.`,
        };
      }
    }
    if (!dropSlot && baseExpr !== null) out.push(baseExpr);
  }

  return {
    kind: "expr",
    expr: `ARRAY[${out.join(", ")}]::${elementType}[]`,
  };
}
