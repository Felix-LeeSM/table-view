import { useCallback, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Copy } from "lucide-react";
import { cn } from "@lib/utils";

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
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    return false;
  }
}

// ── Node rendering ──────────────────────────────────────────────────────

interface NodeProps {
  /** Key for this node in its parent. `null` for the root. */
  nodeKey: string | null;
  /** Accumulated path from root. Empty string = root. */
  path: string;
  /** Raw value at this node. */
  value: unknown;
  /** 0-indexed depth from root. */
  depth: number;
  /** Root auto-expands; children default-collapse at depth ≥ 2. */
  defaultExpanded: boolean;
  /**
   * Whether this node is keyed by an array index. Controls key-label
   * copy semantics (index labels copy the array path, not a dotted key).
   */
  isArrayElement?: boolean;
}

function TreeNode({
  nodeKey,
  path,
  value,
  depth,
  defaultExpanded,
  isArrayElement,
}: NodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState<"path" | "value" | null>(null);

  const badge = useMemo(() => detectBsonBadge(value), [value]);
  const isObject =
    !badge &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
  const isArray = Array.isArray(value);
  const hasChildren = (isObject || isArray) && !badge;

  const handleToggle = useCallback(() => {
    if (hasChildren) setExpanded((e) => !e);
  }, [hasChildren]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!hasChildren) return;
      // Only handle keys that land on the row wrapper itself; let the
      // expand/copy buttons handle their native Enter/Space semantics.
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setExpanded((prev) => !prev);
      }
    },
    [hasChildren],
  );

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
      ? JSON.stringify(value, null, 2)
      : canonicalStringify(value);
    const ok = await copyToClipboard(serialised);
    if (ok) {
      setCopied("value");
      window.setTimeout(() => setCopied(null), 1200);
    }
  }, [hasChildren, value]);

  const indentStyle = { paddingLeft: depth * 14 };

  const keyLabel =
    nodeKey === null ? "$" : isArrayElement ? `[${nodeKey}]` : nodeKey;

  const ariaExpanded = hasChildren ? expanded : undefined;

  return (
    <div
      role="treeitem"
      aria-expanded={ariaExpanded}
      aria-label={`${keyLabel} node`}
      className="font-mono text-xs"
    >
      <div
        className={cn(
          "group flex items-center gap-1 rounded px-1 py-0.5",
          "hover:bg-muted/60 dark:hover:bg-muted/40",
        )}
        style={indentStyle}
        onKeyDown={handleKeyDown}
        tabIndex={hasChildren ? 0 : -1}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={handleToggle}
            aria-label={
              expanded ? `Collapse ${keyLabel}` : `Expand ${keyLabel}`
            }
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
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
          title={`Copy path ${path === "" ? "$" : path}`}
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
          aria-label={`Copy value at ${path === "" ? "$" : path}`}
          className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          <Copy className="h-3 w-3" />
        </button>

        {copied && (
          <span
            role="status"
            className="ml-1 shrink-0 rounded bg-success/15 px-1 text-3xs font-semibold text-success"
          >
            Copied {copied}
          </span>
        )}
      </div>

      {hasChildren && expanded && (
        <div role="group">
          {isArray
            ? (value as unknown[]).map((child, i) => (
                <TreeNode
                  key={i}
                  nodeKey={String(i)}
                  path={joinArrayPath(path, i)}
                  value={child}
                  depth={depth + 1}
                  defaultExpanded={depth + 1 <= 1}
                  isArrayElement
                />
              ))
            : Object.entries(value as Record<string, unknown>).map(([k, v]) => (
                <TreeNode
                  key={k}
                  nodeKey={k}
                  path={joinObjectPath(path, k)}
                  value={v}
                  depth={depth + 1}
                  defaultExpanded={depth + 1 <= 1}
                />
              ))}
        </div>
      )}
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
        {expanded ? "[" : `[${len} items]`}
      </span>
    );
  }

  if (isObject) {
    const len = Object.keys(value as Record<string, unknown>).length;
    return (
      <span className="text-muted-foreground">
        {expanded ? "{" : `{${len} keys}`}
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
 * Read-only recursive tree viewer for BSON documents (Sprint 70).
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
 * - ARIA: the container is `role="tree"`, each node is `role="treeitem"`
 *   with `aria-expanded` reflecting collapsed/expanded state.
 */
export default function BsonTreeViewer({
  value,
  rootLabel,
}: BsonTreeViewerProps) {
  if (value === null || value === undefined) {
    return (
      <div
        role="tree"
        aria-label="BSON document tree"
        className="p-3 text-xs italic text-muted-foreground"
      >
        No document selected
      </div>
    );
  }

  return (
    <div
      role="tree"
      aria-label="BSON document tree"
      className="overflow-auto p-2"
    >
      <TreeNode
        nodeKey={rootLabel ?? null}
        path=""
        value={value}
        depth={0}
        defaultExpanded
      />
    </div>
  );
}
