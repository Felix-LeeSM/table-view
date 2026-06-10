import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ban, Plus, Trash2, X } from "lucide-react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { defaultKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { acceptCompletion } from "@codemirror/autocomplete";
import { autocompleteTooltipTheme } from "@lib/editor/autocompleteTheme";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useMongoAutocomplete } from "@features/completion";
import {
  buildMqlFilter,
  stringifyMqlFilter,
  MQL_OPERATORS,
  type MatchMode,
  type MqlCondition,
  type MqlOperator,
} from "@lib/mongo/mqlFilterBuilder";

/**
 * Mongo collection filter bar. Mirrors the RDB `FilterBar` UX but emits
 * an MQL filter document instead of SQL `WHERE`.
 *
 * Two modes share a single `onApply(filter)` exit:
 * - Structured: rows of column + operator + value; `buildMqlFilter`
 *   compiles them into an MQL document.
 * - Raw MQL: CodeMirror JSON editor with `useMongoAutocomplete` for
 *   field-name + `$`-operator completions.
 *
 * Structured → Raw prefills the raw editor with the structured filter;
 * Raw → Structured is intentionally not parsed back (manual rebuild).
 */
export interface DocumentFilterBarProps {
  /** Field names surfaced to the structured column dropdown + raw AC. */
  fieldNames: readonly string[];
  /** Apply the produced filter document to the active find query. */
  onApply: (filter: Record<string, unknown>) => void;
  /** Hide the filter bar without changing the applied filter. */
  onClose: () => void;
  /** Reset state to the empty filter. Caller is responsible for re-fetching. */
  onClear: () => void;
}

type FilterMode = "structured" | "raw";

const RAW_DEFAULT_TEMPLATE = `{

}`;

function newCondition(field: string): MqlCondition {
  return {
    id: crypto.randomUUID(),
    field,
    operator: "$eq",
    value: "",
  };
}

// Operator-specific placeholder hint. Sprint 313 D-24: `$in` / `$nin`
// take CSV input, so show "1, 2, 3" instead of the generic "Value..."
// so the user does not have to read the operator docs to know the
// shape.
function placeholderFor(operator: MqlOperator): string {
  switch (operator) {
    case "$exists":
      return "true / false";
    case "$in":
    case "$nin":
      return "1, 2, 3";
    case "$regex":
      return "^pattern";
    default:
      return "Value...";
  }
}

export default function DocumentFilterBar({
  fieldNames,
  onApply,
  onClose,
  onClear,
}: DocumentFilterBarProps) {
  const [mode, setMode] = useState<FilterMode>("structured");
  const [conditions, setConditions] = useState<MqlCondition[]>([]);
  // Sprint 314 — Slice B.2. ALL = implicit `$and` (default). ANY =
  // top-level `$or` array. Per-row `$not` lives on each MqlCondition.
  const [matchMode, setMatchMode] = useState<MatchMode>("all");
  const [rawText, setRawText] = useState<string>(RAW_DEFAULT_TEMPLATE);
  const [rawError, setRawError] = useState<string | null>(null);

  // Auto-create one empty structured row on first mount when fields exist.
  // Same UX as the RDB FilterBar so users see a starting row instead of an
  // empty pane.
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    if (
      !autoCreatedRef.current &&
      conditions.length === 0 &&
      fieldNames.length > 0
    ) {
      autoCreatedRef.current = true;
      setConditions([newCondition(fieldNames[0]!)]);
    }
  }, [fieldNames, conditions.length]);

  const updateCondition = (index: number, patch: Partial<MqlCondition>) => {
    setConditions((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  };

  const removeCondition = (index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  };

  const addCondition = () => {
    setConditions((prev) => [...prev, newCondition(fieldNames[0] ?? "")]);
  };

  const handleClearAll = () => {
    setConditions([]);
    setRawText(RAW_DEFAULT_TEMPLATE);
    setRawError(null);
    autoCreatedRef.current = false;
    onClear();
  };

  const handleStructuredApply = () => {
    const filter = buildMqlFilter(conditions, matchMode);
    onApply(filter);
  };

  const handleRawApply = () => {
    const trimmed = rawText.trim();
    if (trimmed.length === 0) {
      onApply({});
      setRawError(null);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      setRawError(
        err instanceof Error
          ? `Invalid MQL JSON: ${err.message}`
          : "Invalid MQL JSON",
      );
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      setRawError("MQL filter must be a JSON object");
      return;
    }
    setRawError(null);
    onApply(parsed as Record<string, unknown>);
  };

  // Structured → Raw prefill: when the user toggles to Raw and the editor
  // is still on its default template, seed it with the current structured
  // filter so they can edit on top of what they just built.
  const handleModeChange = (next: FilterMode) => {
    if (next === mode) return;
    if (next === "raw") {
      const filter = buildMqlFilter(conditions, matchMode);
      const seeded = stringifyMqlFilter(filter);
      setRawText(seeded);
      setRawError(null);
    }
    setMode(next);
  };

  return (
    <div className="border-b border-border bg-secondary px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-secondary-foreground">
            Filters
          </span>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && handleModeChange(v as FilterMode)}
          >
            <ToggleGroupItem
              value="structured"
              className="data-[state=on]:bg-primary data-[state=on]:text-white data-[state=on]:shadow-none"
            >
              Structured
            </ToggleGroupItem>
            <ToggleGroupItem
              value="raw"
              className="data-[state=on]:bg-primary data-[state=on]:text-white data-[state=on]:shadow-none"
            >
              Raw MQL
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-secondary-foreground"
          onClick={onClose}
          aria-label="Close filter bar"
        >
          <X size={12} />
        </Button>
      </div>

      {mode === "raw" ? (
        <RawMqlEditor
          fieldNames={fieldNames}
          value={rawText}
          onChange={(v) => {
            setRawText(v);
            setRawError(null);
          }}
          onSubmit={handleRawApply}
        >
          {rawError && (
            <div className="mt-1 text-2xs text-destructive" role="alert">
              {rawError}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2">
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={handleClearAll}
            >
              Clear
            </Button>
            <Button
              size="xs"
              className="bg-primary text-white hover:bg-primary/90"
              onClick={handleRawApply}
              aria-label="Apply MQL filter"
            >
              Apply
            </Button>
          </div>
        </RawMqlEditor>
      ) : (
        <>
          {/* Sprint 314 — Match ALL/ANY toggle. ALL = implicit $and,
              ANY = top-level $or. Effective only when ≥ 2 rows; we show
              it unconditionally so users discover it. */}
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-2xs text-muted-foreground">Match</span>
            <ToggleGroup
              type="single"
              value={matchMode}
              onValueChange={(v) => v && setMatchMode(v as MatchMode)}
              aria-label="Match mode"
            >
              <ToggleGroupItem
                value="all"
                className="px-2 text-2xs data-[state=on]:bg-primary data-[state=on]:text-white data-[state=on]:shadow-none"
              >
                ALL
              </ToggleGroupItem>
              <ToggleGroupItem
                value="any"
                className="px-2 text-2xs data-[state=on]:bg-primary data-[state=on]:text-white data-[state=on]:shadow-none"
              >
                ANY
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {conditions.map((c, index) => (
            <StructuredRow
              key={c.id}
              condition={c}
              fieldNames={fieldNames}
              onChange={(patch) => updateCondition(index, patch)}
              onRemove={() => removeCondition(index)}
              onApply={handleStructuredApply}
            />
          ))}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="xs"
              className="text-primary"
              onClick={addCondition}
            >
              <Plus size={12} /> Add Filter
            </Button>
            {conditions.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={handleClearAll}
                >
                  Clear All
                </Button>
                <Button
                  size="xs"
                  className="bg-primary text-white hover:bg-primary/90"
                  onClick={handleStructuredApply}
                  aria-label="Apply filter"
                >
                  Apply
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface StructuredRowProps {
  condition: MqlCondition;
  fieldNames: readonly string[];
  onChange: (patch: Partial<MqlCondition>) => void;
  onRemove: () => void;
  onApply: () => void;
}

function StructuredRow({
  condition,
  fieldNames,
  onChange,
  onRemove,
  onApply,
}: StructuredRowProps) {
  const negate = !!condition.negate;
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <Select
        value={condition.field || undefined}
        onValueChange={(v) => onChange({ field: v })}
      >
        <SelectTrigger
          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
          aria-label="Filter field"
        >
          <SelectValue placeholder="field" />
        </SelectTrigger>
        <SelectContent>
          {fieldNames.length > 0 ? (
            fieldNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))
          ) : (
            <SelectItem value={condition.field || "_id"}>
              {condition.field || "_id"}
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      {/* Sprint 314 — NOT toggle. Wraps the operator clause in $not.
          Sits left of the operator dropdown so users decide negation
          before picking the comparator. */}
      <Button
        variant="ghost"
        size="icon-xs"
        className={
          negate
            ? "bg-amber-500 text-white hover:bg-amber-500/90"
            : "text-muted-foreground"
        }
        aria-label="Negate filter"
        aria-pressed={negate}
        onClick={() => onChange({ negate: !negate })}
      >
        <Ban size={12} />
      </Button>

      <Select
        value={condition.operator}
        onValueChange={(v) => onChange({ operator: v as MqlOperator })}
      >
        <SelectTrigger
          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
          aria-label="Filter operator"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MQL_OPERATORS.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="text"
        className="h-7 min-w-30 flex-1 border-border bg-background px-2 py-1 text-xs text-foreground"
        placeholder={placeholderFor(condition.operator)}
        value={condition.value}
        onChange={(e) => onChange({ value: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") onApply();
        }}
        aria-label="Filter value"
      />

      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label="Remove filter"
      >
        <Trash2 size={12} />
      </Button>
    </div>
  );
}

interface RawMqlEditorProps {
  fieldNames: readonly string[];
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  children?: React.ReactNode;
}

function RawMqlEditor({
  fieldNames,
  value,
  onChange,
  onSubmit,
  children,
}: RawMqlEditorProps) {
  // Sprint 309 — `useMongoAutocomplete` lost its queryMode argument;
  // the unified completion source covers find operators + aggregate
  // stages + accumulators + type tags. RawMqlEditor still threads its
  // collection's fieldNames so key-position autocomplete works.
  const mongoExtensions = useMongoAutocomplete({ fieldNames });

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const submitRef = useRef<() => void>(() => {});
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  submitRef.current = onSubmit;

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);

  const buildLangExtension = useMemo(
    () =>
      (mongo: readonly Extension[]): Extension => [jsonLanguage(), ...mongo],
    [],
  );

  // One-time editor build keyed on the container element. The callback-ref +
  // state pattern dodges the Radix portal mount race that breaks `useRef`.
  useEffect(() => {
    if (!containerEl) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        indentOnInput(),
        bracketMatching(),
        langCompartment.current.of(buildLangExtension(mongoExtensions)),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              submitRef.current();
              return true;
            },
          },
          {
            key: "Tab",
            run: (view) => {
              if (acceptCompletion(view)) return true;
              return false;
            },
          },
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": {
            fontSize: "12px",
            backgroundColor: "var(--tv-background)",
          },
          ".cm-scroller": { overflow: "auto", maxHeight: "200px" },
          ".cm-content": {
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            color: "var(--tv-foreground)",
            minHeight: "5rem",
          },
          ".cm-gutters": {
            backgroundColor: "var(--tv-secondary)",
            color: "var(--tv-muted-foreground)",
            border: "none",
            borderRight: "1px solid var(--tv-border)",
          },
          ".cm-activeLineGutter": { backgroundColor: "var(--tv-muted)" },
          ".cm-activeLine": { backgroundColor: "var(--tv-muted)" },
          ".cm-cursor": { borderLeftColor: "var(--tv-foreground)" },
        }),
        autocompleteTooltipTheme,
      ],
    });

    const view = new EditorView({ state, parent: containerEl });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once per container element; the value/extension
    // sync below keeps it consistent without rebuilding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerEl]);

  // Reconfigure the language extension when the autocomplete identity
  // changes (fieldNames update) so the editor picks up the new sources
  // without being torn down.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langCompartment.current.reconfigure(
        buildLangExtension(mongoExtensions),
      ),
    });
  }, [mongoExtensions, buildLangExtension]);

  // Sync external `value` (e.g. Structured → Raw prefill) into the editor
  // without losing focus. Only dispatch when the docs actually differ to
  // avoid an infinite loop with the updateListener above.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return (
    <div>
      <div
        ref={setContainerRef}
        role="textbox"
        aria-label="Raw MQL filter"
        aria-multiline="true"
        className="rounded border border-border bg-background outline-none focus-within:ring-2 focus-within:ring-ring"
      />
      {children}
    </div>
  );
}
