import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus } from "lucide-react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { acceptCompletion } from "@codemirror/autocomplete";
import FormDialog from "@components/ui/dialog/FormDialog";
import { useMongoAutocomplete } from "@features/completion";
import { useDocumentCatalogStore } from "@stores/documentCatalogStore";
import { autocompleteTooltipTheme } from "@lib/editor/autocompleteTheme";

/**
 * Lightweight JSON editor for inserting a single document. Parses on
 * submit, validates a non-array object, forwards to `onSubmit`. Wire
 * serialisation lives in the caller; this component only owns the JSON
 * round-trip.
 *
 * - Valid input: a JSON object → `onSubmit(parsed)`.
 * - Invalid/empty/non-object: local `parseError` above the footer;
 *   `onSubmit` is NOT called.
 * - `error` prop surfaces parent errors (e.g. Mongo server rejection).
 * - Esc / Cancel close via `onCancel`.
 *
 * Built on the `FormDialog` preset. The editor is CodeMirror 6 + JSON
 * + `useMongoAutocomplete({ queryMode: "find", fieldNames })`; passing
 * a connection/database/collection triple surfaces field-name
 * completions from `fieldsCache` at JSON key positions, mirroring the
 * QueryEditor.
 */
export interface AddDocumentModalProps {
  onSubmit: (record: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  error?: string | null;
  /** Connection/database/collection scope for autocomplete. All three
   *  required together to surface field-name completions. */
  connectionId?: string;
  database?: string;
  collection?: string;
}

const DEFAULT_TEMPLATE = `{
  "name": ""
}`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

const EMPTY_FIELDS: readonly string[] = [];

export default function AddDocumentModal({
  onSubmit,
  onCancel,
  loading = false,
  error = null,
  connectionId,
  database,
  collection,
}: AddDocumentModalProps) {
  const { t } = useTranslation("document");
  const [text, setText] = useState<string>(DEFAULT_TEMPLATE);
  const [parseError, setParseError] = useState<string | null>(null);

  const fieldsCacheEntry = useDocumentCatalogStore((s) =>
    connectionId && database && collection
      ? s.fieldsCache[connectionId]?.[database]?.[collection]
      : undefined,
  );
  const fieldNames = useMemo<readonly string[]>(() => {
    if (!fieldsCacheEntry) return EMPTY_FIELDS;
    return fieldsCacheEntry.map((c) => c.name);
  }, [fieldsCacheEntry]);

  // Sprint 309 — `useMongoAutocomplete` no longer accepts a queryMode
  // argument; the unified completion source serves the operator/stage
  // union directly. AddDocumentModal still passes its collection's
  // fieldNames so key-position autocomplete surfaces field names.
  const mongoExtensions = useMongoAutocomplete({ fieldNames });

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const submitRef = useRef<() => void>(() => {});
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);

  const handleSubmit = () => {
    const view = viewRef.current;
    const current = view ? view.state.doc.toString() : text;
    const trimmed = current.trim();
    if (trimmed.length === 0) {
      setParseError(t("addDocument.errorRequired"));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      setParseError(
        err instanceof Error
          ? t("addDocument.errorInvalidJsonDetail", { message: err.message })
          : t("addDocument.errorInvalidJson"),
      );
      return;
    }
    if (!isPlainObject(parsed)) {
      setParseError(t("addDocument.errorNotObject"));
      return;
    }
    setParseError(null);
    void onSubmit(parsed);
  };
  submitRef.current = handleSubmit;

  const buildLangExtension = (mongo: readonly Extension[]): Extension => [
    jsonLanguage(),
    ...mongo,
  ];

  // Build the editor once the container element is mounted. The callback
  // ref pattern (instead of useRef) is used because Radix Dialog's portal
  // can mount content slightly out of band — useRef.current is observed
  // null in jsdom even after the div is in the DOM, while a callback ref
  // fires deterministically when the DOM element is attached.
  useEffect(() => {
    if (!containerEl) return;

    const state = EditorState.create({
      doc: DEFAULT_TEMPLATE,
      extensions: [
        lineNumbers(),
        indentOnInput(),
        bracketMatching(),
        // #1247 — undo/redo history so Cmd+Z reverts edits (incl. paste),
        // matching the query editors fixed in #1225.
        history(),
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
          // #1247 — Mod-z / Mod-y undo/redo (defaultKeymap omits these).
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const doc = update.state.doc.toString();
            setText(doc);
            setParseError((prev) => (prev !== null ? null : prev));
          }
        }),
        EditorView.theme({
          "&": {
            fontSize: "13px",
            backgroundColor: "var(--tv-secondary)",
          },
          ".cm-scroller": { overflow: "auto", maxHeight: "320px" },
          ".cm-content": {
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            color: "var(--tv-foreground)",
            minHeight: "12rem",
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

    const view = new EditorView({
      state,
      parent: containerEl,
    });
    viewRef.current = view;

    // Focus the editor on mount so users can start typing immediately — the
    // same affordance the textarea offered via autoFocus. jsdom does not
    // implement contenteditable focus reliably, so we swallow any error to
    // keep the editor mounted under tests.
    try {
      view.focus();
    } catch {
      // ignore — focus is a UX nicety, not a correctness requirement.
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once per container element; mongoExtensions
    // reconfigures via the Compartment effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerEl]);

  // Reconfigure the language extension whenever the autocomplete extension
  // identity changes — keeps the editor alive across fieldNames updates.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langCompartment.current.reconfigure(
        buildLangExtension(mongoExtensions),
      ),
    });
  }, [mongoExtensions]);

  return (
    <FormDialog
      title={t("addDocument.title")}
      description={t("addDocument.description")}
      className="w-dialog-lg bg-background"
      onSubmit={handleSubmit}
      onCancel={onCancel}
      isSubmitting={loading}
      submitAriaLabel={t("addDocument.submitAriaLabel")}
      submitLabel={
        <>
          {loading ? <Loader2 className="animate-spin" /> : <Plus />}
          {loading ? t("addDocument.inserting") : t("addDocument.add")}
        </>
      }
    >
      <span className="text-xs font-medium text-secondary-foreground">
        {t("addDocument.fieldLabel")}
      </span>
      <div
        ref={setContainerRef}
        role="textbox"
        aria-label={t("addDocument.editorAriaLabel")}
        aria-multiline="true"
        className="rounded border border-border bg-secondary outline-none focus-within:ring-2 focus-within:ring-ring"
      />
      <p className="text-2xs text-muted-foreground">{t("addDocument.hint")}</p>
      {parseError && (
        <p role="alert" className="text-xs text-destructive">
          {parseError}
        </p>
      )}
      {error && !parseError && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </FormDialog>
  );
}
