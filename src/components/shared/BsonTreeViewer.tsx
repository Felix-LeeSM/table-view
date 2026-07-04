import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronDown, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@lib/utils";
import { safeStringifyCell } from "@lib/jsonCell";
import {
  useTreeRoving,
  type TreeRovingRow,
} from "@components/shared/tree/useTreeRoving";

// ── BSON wrapper whitelist ──────────────────────────────────────────────

/**
 * Canonical extended JSON wrapper keys → human-friendly type label. The
 * BSON driver emits these shapes when serialising scalar BSON values the
 * JSON spec can't express natively. Keeping the table as a whitelist lets
 * us distinguish between e.g. `{ "$oid": "abc" }` (ObjectId) and
 * `{ "$comment": "note" }` (a perfectly legitimate MongoDB field name).
 */
const BSON_WRAPPERS: Record<string, string> = {
  $oid: "ObjectId",
  $date: "ISODate",
  $numberLong: "NumberLong",
  $numberDouble: "NumberDouble",
  $numberInt: "NumberInt",
  $numberDecimal: "Decimal128",
  $binary: "Binary",
  $timestamp: "Timestamp",
  $regularExpression: "RegExp",
  $symbol: "Symbol",
  $code: "Code",
  $minKey: "MinKey",
  $maxKey: "MaxKey",
  $undefined: "Undefined",
};

interface BsonBadge {
  label: string;
  /** Canonical JSON string of the wrapper object. */
  canonical: string;
  /** Short display form (truncated if long). */
  display: string;
}

function canonicalStringify(value: unknown): string {
  // Sprint 305 — replacer 가 BigInt/Decimal 을 digit string 으로 emit.
  // raw JSON.stringify 는 BigInt 만나면 throw.
  return safeStringifyCell(value);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Detect whether `value` is a canonical extended JSON wrapper object. The
 * rules are deliberately strict: the object must have only whitelisted `$`
 * keys, with one of the known 1-key or 2-key shapes. Anything else (e.g.
 * `{ "$comment": "..." }` where the user's field name happens to collide)
 * renders as a normal object node.
 */
export function detectBsonBadge(value: unknown): BsonBadge | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0 || keys.length > 2) return null;

  // 1-key wrappers: all whitelisted $-keys count.
  if (keys.length === 1) {
    const [only] = keys;
    if (!only || !(only in BSON_WRAPPERS)) return null;
    const label = BSON_WRAPPERS[only] as string;
    // Special-case $regularExpression: value must be an object with
    // { pattern, options } to count as the canonical wrapper. Otherwise
    // (e.g. `{ $regularExpression: "foo" }`) treat it as a plain object.
    if (only === "$regularExpression") {
      const v = obj[only];
      if (
        v === null ||
        typeof v !== "object" ||
        Array.isArray(v) ||
        !("pattern" in (v as Record<string, unknown>))
      ) {
        return null;
      }
    }
    return {
      label,
      canonical: canonicalStringify(value),
      display: truncate(shortValueString(obj[only]), 48),
    };
  }

  // 2-key wrappers: only the legacy $binary + $type companion is
  // accepted. `$type` is intentionally NOT in the main whitelist because
  // it is never a standalone BSON wrapper.
  const keySet = new Set(keys);
  if (keySet.has("$binary") && keySet.has("$type")) {
    return {
      label: BSON_WRAPPERS.$binary as string,
      canonical: canonicalStringify(value),
      display: truncate(shortValueString(obj.$binary), 48),
    };
  }

  return null;
}

function shortValueString(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return canonicalStringify(v);
}

// ── Path builder ────────────────────────────────────────────────────────

const SAFE_KEY = /^[A-Za-z_$][\w$]*$/;

export function joinObjectPath(parent: string, key: string): string {
  const safe = SAFE_KEY.test(key);
  if (!safe) {
    const escaped = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `${parent}["${escaped}"]`;
  }
  if (parent === "") return key;
  return `${parent}.${key}`;
}

export function joinArrayPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

// ── Copy helpers ────────────────────────────────────────────────────────

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard permission denied or unavailable — caller surfaces a toast.
    return false;
  }
}

// ── Flatten (visible-order model for roving) ─────────────────────────────

interface FlatNode {
  /** Stable key = the field path; the root uses `"$"`. Rendered as
   *  `data-tree-key` and used by the roving hook to find/focus the row. */
  key: string;
  /** Accumulated path from root. Empty string = root. */
  path: string;
  /** Display label (`$`, a key name, or `[index]`). */
  keyLabel: string;
  value: unknown;
  depth: number;
  isArrayElement: boolean;
  badge: BsonBadge | null;
  isObject: boolean;
  isArray: boolean;
  hasChildren: boolean;
  /** Expand state for containers; `false` for leaves. */
  expanded: boolean;
}

function classify(value: unknown) {
  const badge = detectBsonBadge(value);
  const isObject =
    !badge &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
  const isArray = Array.isArray(value);
  const hasChildren = (isObject || isArray) && !badge;
  return { badge, isObject, isArray, hasChildren };
}

/** Root auto-expands; containers at depth <= 1 default to expanded (matching
 *  the pre-refactor per-node `defaultExpanded={depth + 1 <= 1}` behaviour). */
function defaultExpandedPaths(root: unknown): Set<string> {
  const set = new Set<string>();
  const walk = (path: string, value: unknown, depth: number) => {
    const { hasChildren, isArray } = classify(value);
    if (!hasChildren) return;
    if (depth <= 1) set.add(path === "" ? "$" : path);
    if (isArray) {
      (value as unknown[]).forEach((c, i) =>
        walk(joinArrayPath(path, i), c, depth + 1),
      );
    } else {
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) =>
        walk(joinObjectPath(path, k), v, depth + 1),
      );
    }
  };
  walk("", root, 0);
  return set;
}

/** Pre-order visible-node list: descends only into expanded containers. */
function flattenBson(
  root: unknown,
  rootLabel: string | undefined,
  expandedPaths: ReadonlySet<string>,
): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (
    nodeKey: string | null,
    path: string,
    value: unknown,
    depth: number,
    isArrayElement: boolean,
  ) => {
    const { badge, isObject, isArray, hasChildren } = classify(value);
    const key = path === "" ? "$" : path;
    const expanded = hasChildren && expandedPaths.has(key);
    const keyLabel =
      nodeKey === null ? "$" : isArrayElement ? `[${nodeKey}]` : nodeKey;
    out.push({
      key,
      path,
      keyLabel,
      value,
      depth,
      isArrayElement,
      badge,
      isObject,
      isArray,
      hasChildren,
      expanded,
    });
    if (hasChildren && expanded) {
      if (isArray) {
        (value as unknown[]).forEach((c, i) =>
          walk(String(i), joinArrayPath(path, i), c, depth + 1, true),
        );
      } else {
        Object.entries(value as Record<string, unknown>).forEach(([k, v]) =>
          walk(k, joinObjectPath(path, k), v, depth + 1, false),
        );
      }
    }
  };
  walk(rootLabel ?? null, "", root, 0, false);
  return out;
}

// ── Row rendering ───────────────────────────────────────────────────────

interface BsonRowProps {
  node: FlatNode;
  /** This row owns the single `tabIndex=0` treeitem tab stop. */
  isActive: boolean;
  onToggle: () => void;
  onFocus: () => void;
}

function BsonRow({ node, isActive, onToggle, onFocus }: BsonRowProps) {
  const { t } = useTranslation("shared");
  const [copied, setCopied] = useState<"path" | "value" | null>(null);
  const {
    path,
    value,
    depth,
    isArrayElement,
    badge,
    isObject,
    isArray,
    hasChildren,
    expanded,
    keyLabel,
  } = node;

  const handleCopyPath = useCallback(async () => {
    const target = path === "" ? "$" : path;
    const ok = await copyToClipboard(target);
    if (ok) {
      setCopied("path");
      window.setTimeout(() => setCopied(null), 1200);
    }
  }, [path]);

  const handleCopyValue = useCallback(async () => {
    // Scalars/badges use compact canonical JSON so a number copies as `42`
    // and a string as `"hello"`. Containers get pretty-printed JSON so the
    // clipboard output is usable as-is in an editor (contract AC-06).
    const serialised = hasChildren
      ? safeStringifyCell(value, 2)
      : canonicalStringify(value);
    const ok = await copyToClipboard(serialised);
    if (ok) {
      setCopied("value");
      window.setTimeout(() => setCopied(null), 1200);
    }
  }, [hasChildren, value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Only handle keys that land on the treeitem itself; arrow keys are
      // owned by the container's roving handler, and the inner copy/expand
      // buttons keep their native Enter/Space semantics.
      if (e.target !== e.currentTarget) return;
      if (hasChildren && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onToggle();
      }
    },
    [hasChildren, onToggle],
  );

  const indentStyle = { paddingLeft: depth * 14 };
  const ariaExpanded = hasChildren ? expanded : undefined;

  return (
    <div
      role="treeitem"
      aria-expanded={ariaExpanded}
      aria-level={depth + 1}
      aria-label={t("bson.nodeAria", { keyLabel })}
      className="font-mono text-xs"
      data-tree-key={node.key}
      // WAI-ARIA tree roving (#1128) — the container manages one tab stop; the
      // arrow keys move it. Leaves are focusable too so the whole tree is
      // arrow-navigable, but only the active row is in the Tab order. The
      // inner copy/expand buttons stay reachable as row controls (mirrors the
      // sidebar trees keeping their toolbar controls tabbable).
      tabIndex={isActive ? 0 : -1}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
    >
      <div
        className={cn(
          "group flex items-center gap-1 rounded px-1 py-0.5",
          "hover:bg-muted/60 dark:hover:bg-muted/40",
        )}
        style={indentStyle}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={
              expanded
                ? t("bson.collapse", { keyLabel })
                : t("bson.expand", { keyLabel })
            }
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}

        <button
          type="button"
          onClick={handleCopyPath}
          title={t("bson.copyPath", { path: path === "" ? "$" : path })}
          className={cn(
            "shrink-0 text-left text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isArrayElement && "text-muted-foreground",
          )}
        >
          {keyLabel}
        </button>

        <span className="text-muted-foreground">:</span>

        <ValueSummary
          value={value}
          badge={badge}
          isObject={isObject}
          isArray={isArray}
          expanded={expanded}
        />

        <button
          type="button"
          onClick={handleCopyValue}
          aria-label={t("bson.copyValue", { path: path === "" ? "$" : path })}
          className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:text-foreground focus:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Copy className="h-3 w-3" />
        </button>

        {copied && (
          <span
            role="status"
            className="ml-1 shrink-0 rounded bg-success/15 px-1 text-3xs font-semibold text-success"
          >
            {t("bson.copied", { copied })}
          </span>
        )}
      </div>
    </div>
  );
}

interface ValueSummaryProps {
  value: unknown;
  badge: BsonBadge | null;
  isObject: boolean;
  isArray: boolean;
  expanded: boolean;
}

function ValueSummary({
  value,
  badge,
  isObject,
  isArray,
  expanded,
}: ValueSummaryProps) {
  const { t } = useTranslation("shared");

  if (badge) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className="inline-flex shrink-0 items-center rounded bg-primary/15 px-1 py-0 text-3xs font-semibold uppercase tracking-wide text-primary">
          {badge.label}
        </span>
        <span
          className="truncate text-muted-foreground"
          title={badge.canonical}
        >
          {badge.display}
        </span>
      </span>
    );
  }

  if (isArray) {
    const len = (value as unknown[]).length;
    return (
      <span className="text-muted-foreground">
        {expanded ? "[" : t("bson.arrayItems", { len })}
      </span>
    );
  }

  if (isObject) {
    const len = Object.keys(value as Record<string, unknown>).length;
    return (
      <span className="text-muted-foreground">
        {expanded ? "{" : t("bson.objectKeys", { len })}
      </span>
    );
  }

  if (value === null) {
    return <span className="italic text-muted-foreground">null</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-primary">{value ? "true" : "false"}</span>;
  }
  if (typeof value === "number") {
    return <span className="text-primary">{String(value)}</span>;
  }
  if (typeof value === "string") {
    return (
      <span className="truncate text-foreground" title={value}>
        {`"${truncate(value, 120)}"`}
      </span>
    );
  }
  return <span className="text-foreground">{String(value)}</span>;
}

// ── Public component ────────────────────────────────────────────────────

export interface BsonTreeViewerProps {
  /** The root BSON document (or array) to render. */
  value: Record<string, unknown> | unknown[] | null;
  /** Optional override for the root label. Defaults to `"$"`. */
  rootLabel?: string;
}

/**
 * Read-only recursive tree viewer for BSON documents.
 *
 * - Root is always expanded; depth ≥ 2 nodes are collapsed by default.
 * - Canonical extended JSON wrapper objects render as scalar badges
 *   (`ObjectId`, `ISODate`, `NumberLong`, …) via a whitelist so a regular
 *   field like `{"$comment": "..."}` is never mis-detected.
 * - Clicking the key label copies the field path
 *   (`user.profile.emails[0]`) to the clipboard. Keys containing
 *   non-identifier characters use bracket-quote form.
 * - Scalar nodes expose an inline `Copy value` button that writes the
 *   canonical JSON string.
 * - ARIA: the container is `role="tree"` with WAI-ARIA roving tabindex
 *   (#1128) — one treeitem is in the Tab order, arrow keys move focus and
 *   expand/collapse. Each node is `role="treeitem"` with `aria-expanded`
 *   reflecting collapsed/expanded state.
 */
export default function BsonTreeViewer({
  value,
  rootLabel,
}: BsonTreeViewerProps) {
  const { t } = useTranslation("shared");
  const treeRef = useRef<HTMLDivElement>(null);

  // Central expand state, lifted out of the old per-node local `useState` so a
  // single flat visible-node list can feed the shared roving hook.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    defaultExpandedPaths(value),
  );
  // A new document (value identity change without remount) resets to the
  // default expansion, matching the old per-node default-collapse behaviour.
  const valueRef = useRef(value);
  useEffect(() => {
    if (valueRef.current !== value) {
      valueRef.current = value;
      setExpandedPaths(defaultExpandedPaths(value));
    }
  }, [value]);

  const flat = useMemo(
    () => flattenBson(value, rootLabel, expandedPaths),
    [value, rootLabel, expandedPaths],
  );

  const toggle = useCallback((key: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const rovingRows: TreeRovingRow[] = flat.map((n) => ({
    key: n.key,
    depth: n.depth,
    expanded: n.hasChildren ? n.expanded : null,
    focusable: true,
  }));
  const roving = useTreeRoving(rovingRows, toggle, treeRef);
  const activeKey = roving.focusKey ?? flat[0]?.key ?? null;

  if (value === null || value === undefined) {
    return (
      <div
        role="tree"
        aria-label={t("bson.treeAriaLabel")}
        className="p-3 text-xs italic text-muted-foreground"
      >
        {t("bson.noDocumentSelected")}
      </div>
    );
  }

  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label={t("bson.treeAriaLabel")}
      className="overflow-auto p-2"
      onKeyDown={roving.onKeyDown}
    >
      {flat.map((node) => (
        <BsonRow
          key={node.key}
          node={node}
          isActive={activeKey === node.key}
          onToggle={() => toggle(node.key)}
          onFocus={() => roving.setFocusKey(node.key)}
        />
      ))}
    </div>
  );
}
