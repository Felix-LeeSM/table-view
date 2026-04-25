import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
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
import FormDialog from "@components/ui/dialog/FormDialog";
import { useMongoAutocomplete } from "@/hooks/useMongoAutocomplete";
import { useDocumentStore } from "@stores/documentStore";

/**
 * Sprint 87 — Add Document modal for the document paradigm.
 *
 * Lightweight JSON editor for inserting a single document. The editor parses
 * the text on submit, validates it as a non-array object, and forwards the
 * result to `onSubmit`. Wire-format serialisation is deferred to the caller
 * (which knows the connection + namespace); this component only owns the
 * JSON round-trip.
 *
 * - Valid input: a JSON object → `onSubmit(parsed)`.
 * - Invalid JSON, empty input, or non-object JSON: local `parseError` shown
 *   above the footer. `onSubmit` is NOT called.
 * - `error` prop lets the parent surface errors from the async insert call
 *   (e.g. a Mongo server rejection) without re-rendering the whole tree.
 * - Esc / Cancel closes via `onCancel`; Radix handles the Esc key.
 *
 * Sprint 96: migrated to the `FormDialog` preset.
 *
 * Sprint 121: textarea replaced with CodeMirror 6 + JSON language +
 * `useMongoAutocomplete({ queryMode: "find", fieldNames })`. When the modal
 * is given a connection/database/collection triple, field names from the
 * document store's `fieldsCache` surface as completions at JSON key
 * positions, mirroring the QueryEditor experience for document tabs.
 */
export interface AddDocumentModalProps {
  onSubmit: (record: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  error?: string | null;
  /** Sprint 121 — connection scope for field-name autocomplete. */
  connectionId?: string;
  /** Sprint 121 — database scope for field-name autocomplete. */
  database?: string;
  /** Sprint 121 — collection scope for field-name autocomplete. */
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
  const [text, setText] = useState<string>(DEFAULT_TEMPLATE);
  const [parseError, setParseError] = useState<string | null>(null);

  const fieldsCacheEntry = useDocumentStore((s) =>
    connectionId && database && collection
      ? s.fieldsCache[`${connectionId}:${database}:${collection}`]
      : undefined,
  );
  const fieldNames = useMemo<readonly string[]>(() => {
    if (!fieldsCacheEntry) return EMPTY_FIELDS;
    return fieldsCacheEntry.map((c) => c.name);
  }, [fieldsCacheEntry]);

  const mongoExtensions = useMongoAutocomplete({
    queryMode: "find",
    fieldNames,
  });

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
      setParseError("Document is required");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      setParseError(
        err instanceof Error ? `Invalid JSON: ${err.message}` : "Invalid JSON",
      );
      return;
    }
    if (!isPlainObject(parsed)) {
      setParseError("Document must be a JSON object");
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
            const doc = update.state.doc.toString();
            setText(doc);
            setParseError((prev) => (prev !== null ? null : prev));
          }
        }),
        EditorView.theme({
          "&": {
            fontSize: "13px",
            backgroundColor: "var(--secondary)",
          },
          ".cm-scroller": { overflow: "auto", maxHeight: "320px" },
          ".cm-content": {
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            color: "var(--foreground)",
            minHeight: "12rem",
          },
          ".cm-gutters": {
            backgroundColor: "var(--secondary)",
            color: "var(--muted-foreground)",
            border: "none",
            borderRight: "1px solid var(--border)",
          },
          ".cm-activeLineGutter": { backgroundColor: "var(--muted)" },
          ".cm-activeLine": { backgroundColor: "var(--muted)" },
          ".cm-cursor": { borderLeftColor: "var(--foreground)" },
        }),
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
      title="Add Document"
      description="Insert a new MongoDB document"
      className="w-dialog-lg bg-background"
      onSubmit={handleSubmit}
      onCancel={onCancel}
      isSubmitting={loading}
      submitAriaLabel="Submit add document"
      submitLabel={
        <>
          {loading ? <Loader2 className="animate-spin" /> : <Plus />}
          {loading ? "Inserting..." : "Add"}
        </>
      }
    >
      <span className="text-xs font-medium text-secondary-foreground">
        Document (JSON)
      </span>
      <div
        ref={setContainerRef}
        role="textbox"
        aria-label="Document JSON"
        aria-multiline="true"
        className="rounded border border-border bg-secondary outline-none focus-within:ring-2 focus-within:ring-ring"
      />
      <p className="text-2xs text-muted-foreground">
        Omit the <code className="font-mono">_id</code> field to let MongoDB
        generate one. Press{" "}
        <kbd className="rounded bg-secondary px-1 py-0.5">Cmd+Enter</kbd> to
        submit.
      </p>
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
