import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Shared View-Table HighlightStyle.
 *
 * `defaultHighlightStyle` renders keyword, type, string, and function in
 * nearly the same monochrome tone — even DDL such as
 * `CREATE TABLE foo (id BIGSERIAL PRIMARY KEY)` shows no colour difference
 * and reads as "no highlighting".
 *
 * 2026-05-15 (ADR 0031) — all 12 syntax tokens are wired;
 * atom/builtin/punct/error were added. index.css carries a `:root[data-mode]`
 * fallback, so a missing token definition cascades to the slate values → the
 * old fallback chain (`var(--tv-syntax-X, var(--tv-Y))`) is redundant and was
 * dropped.
 *
 * SqlQueryEditor / MongoQueryEditor mount the same style, so JSON properties
 * and SQL identifiers share one visual tone.
 */
export const viewTableHighlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword],
    color: "var(--tv-syntax-keyword)",
    fontWeight: "600",
  },
  {
    tag: [t.typeName, t.standard(t.tagName), t.namespace],
    color: "var(--tv-syntax-type)",
    fontWeight: "500",
  },
  {
    tag: [t.string, t.special(t.string), t.regexp],
    color: "var(--tv-syntax-string)",
  },
  {
    tag: [t.number, t.integer, t.float],
    color: "var(--tv-syntax-number)",
  },
  {
    tag: [t.bool, t.null, t.atom],
    color: "var(--tv-syntax-atom)",
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "var(--tv-syntax-function)",
  },
  {
    tag: [t.standard(t.variableName), t.standard(t.name)],
    color: "var(--tv-syntax-builtin)",
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: "var(--tv-syntax-comment)",
    fontStyle: "italic",
  },
  {
    tag: [t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator],
    color: "var(--tv-syntax-operator)",
  },
  {
    tag: [t.propertyName, t.attributeName],
    color: "var(--tv-syntax-property)",
    fontWeight: "500",
  },
  {
    tag: [t.variableName, t.name],
    color: "var(--tv-foreground)",
  },
  {
    tag: [
      t.bracket,
      t.paren,
      t.brace,
      t.squareBracket,
      t.angleBracket,
      t.punctuation,
      t.separator,
    ],
    color: "var(--tv-syntax-punct)",
  },
  {
    tag: [t.invalid],
    color: "var(--tv-syntax-error)",
  },
]);
