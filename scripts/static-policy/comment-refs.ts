// Comment-reference policy. Two rules share one comment extractor:
//
//   findLineNumberRefViolations  — a comment may not cite a location by line
//     number. Line numbers rot on the next edit of the target and nothing
//     catches it (#1839, #1853).
//   findUnresolvedSymbolRefViolations — the replacement must point at something
//     that exists. A `path` + `` `symbol` `` citation is resolved against the
//     file; a design-doc citation is resolved against the document's headings.
//     A missing symbol is worse than a stale line number: a stale number at
//     least says "it used to be here".
//
// Both scan COMMENT BLOCKS, not lines. Line-based grep misses a phrase the
// author wrapped across two comment lines (10 such survivors in #1853), and it
// flags string literals — a stack-trace assertion (`at f (a.ts:1:2)`) or SQL
// fixture data is not a comment and must not be blocked. Blocks are also why no
// allowlist is needed: the structural difference does the excluding.

import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

export type CommentBlock = {
  readonly startLine: number;
  readonly endLine: number;
  /** Consecutive comment lines joined by single spaces, so a wrapped phrase is
   *  scanned as one string. */
  readonly text: string;
};

export type CommentRefViolation = {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
  readonly reason: string;
};

const C_LIKE_EXTENSIONS = new Set([
  ".rs",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const HASH_EXTENSIONS = new Set([".sh", ".bash", ".yml", ".yaml", ".toml"]);
const SQL_EXTENSIONS = new Set([".sql"]);
const MARKDOWN_EXTENSIONS = new Set([".md"]);

export const COMMENT_REF_SCAN_EXTENSIONS: readonly string[] = [
  ...C_LIKE_EXTENSIONS,
  ...HASH_EXTENSIONS,
  ...SQL_EXTENSIONS,
  ...MARKDOWN_EXTENSIONS,
].sort();

/** Point-in-time trees. Their contents are frozen by policy, so a line number
 *  inside them cannot rot relative to its own snapshot and rewriting them would
 *  break the freeze. See `docs/PLAN.md` and the ADR-frozen pre-commit gate. */
export const COMMENT_REF_FROZEN_PREFIXES: readonly string[] = [
  "docs/archives/",
  "docs/explorations/",
  "docs/sprints/",
];

export function isCommentRefScanPath(repoPath: string): boolean {
  if (!COMMENT_REF_SCAN_EXTENSIONS.includes(extname(repoPath))) return false;
  return !COMMENT_REF_FROZEN_PREFIXES.some((prefix) =>
    repoPath.startsWith(prefix),
  );
}

type Fragment = {
  line: number;
  endLine: number;
  text: string;
  /** Only whitespace precedes the comment marker on its first line. Trailing
   *  comments never merge with a neighbour: joining `// see a.ts` with a next
   *  line's `// 213 rows` would invent an adjacency the author never wrote. */
  standalone: boolean;
};

function skipQuoted(
  source: string,
  start: number,
  line: number,
  quote: string,
): { index: number; line: number } {
  let i = start + 1;
  let currentLine = line;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      if (source[i + 1] === "\n") currentLine += 1;
      i += 2;
      continue;
    }
    if (ch === "\n") currentLine += 1;
    if (ch === quote) return { index: i + 1, line: currentLine };
    i += 1;
  }
  return { index: i, line: currentLine };
}

/** `r"..."`, `r#"..."#`, `br##"..."##`. Returns null when `start` is not one. */
function skipRustRawString(
  source: string,
  start: number,
  line: number,
): { index: number; line: number } | null {
  let i = start;
  if (source[i] === "b") i += 1;
  if (source[i] !== "r") return null;
  i += 1;
  let hashes = 0;
  while (source[i] === "#") {
    hashes += 1;
    i += 1;
  }
  if (source[i] !== '"') return null;
  i += 1;
  const terminator = `"${"#".repeat(hashes)}`;
  const end = source.indexOf(terminator, i);
  const stop = end === -1 ? source.length : end + terminator.length;
  let currentLine = line;
  for (let k = start; k < stop; k += 1) {
    if (source[k] === "\n") currentLine += 1;
  }
  return { index: stop, line: currentLine };
}

function isIdentifierChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function stripLineMarker(text: string): string {
  return text.replace(/^\s*\/\/[/!]?/, "");
}

function stripBlockMarkers(text: string): string {
  return text
    .replace(/^\s*\/\*+/, "")
    .replace(/\*+\/\s*$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*+/, ""))
    .join("\n");
}

function scanCLike(source: string, rust: boolean): Fragment[] {
  const fragments: Fragment[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  while (i < source.length) {
    const ch = source[i];
    if (ch === "\n") {
      line += 1;
      i += 1;
      lineStart = i;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const start = i;
      const startLine = line;
      const standalone = source.slice(lineStart, start).trim().length === 0;
      while (i < source.length && source[i] !== "\n") i += 1;
      fragments.push({
        line: startLine,
        endLine: startLine,
        text: stripLineMarker(source.slice(start, i)),
        standalone,
      });
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const start = i;
      const startLine = line;
      i += 2;
      while (
        i < source.length &&
        !(source[i] === "*" && source[i + 1] === "/")
      ) {
        if (source[i] === "\n") line += 1;
        i += 1;
      }
      i = Math.min(i + 2, source.length);
      fragments.push({
        line: startLine,
        endLine: line,
        text: stripBlockMarkers(source.slice(start, i)),
        standalone: false,
      });
      continue;
    }
    if (
      rust &&
      (ch === "r" || ch === "b") &&
      !isIdentifierChar(source[i - 1])
    ) {
      const raw = skipRustRawString(source, i, line);
      if (raw) {
        i = raw.index;
        line = raw.line;
        continue;
      }
    }
    if (ch === '"' || ch === "`") {
      const skipped = skipQuoted(source, i, line, ch);
      i = skipped.index;
      line = skipped.line;
      continue;
    }
    if (ch === "'") {
      // Rust: `'a` is a lifetime, not a string. Only `'x'` and `'\n'` quote.
      const isCharLiteral =
        !rust || source[i + 1] === "\\" || source[i + 2] === "'";
      if (isCharLiteral) {
        const skipped = skipQuoted(source, i, line, ch);
        i = skipped.index;
        line = skipped.line;
        continue;
      }
    }
    i += 1;
  }
  return fragments;
}

function scanLinePrefixed(source: string, marker: RegExp): Fragment[] {
  // ponytail: whole-line comments only. Shell/SQL trailing `#`/`--` would need
  // full quoting rules for a class that has no instances here; widen if one
  // shows up.
  const fragments: Fragment[] = [];
  source.split("\n").forEach((text, index) => {
    const match = marker.exec(text);
    marker.lastIndex = 0;
    if (!match) return;
    fragments.push({
      line: index + 1,
      endLine: index + 1,
      text: text.slice(match[0].length),
      standalone: true,
    });
  });
  return fragments;
}

function scanMarkdown(source: string): Fragment[] {
  const lines = source.split("\n");
  const fragments: Fragment[] = [];
  let fenced = false;
  let buffer: string[] = [];
  let bufferStart = 0;

  const flush = (endLine: number) => {
    if (buffer.length === 0) return;
    fragments.push({
      line: bufferStart,
      endLine,
      text: buffer.join("\n"),
      standalone: true,
    });
    buffer = [];
  };

  lines.forEach((text, index) => {
    if (/^\s*(```|~~~)/.test(text)) {
      flush(index);
      fenced = !fenced;
      return;
    }
    if (fenced || text.trim().length === 0) {
      flush(index);
      return;
    }
    if (buffer.length === 0) bufferStart = index + 1;
    buffer.push(text);
  });
  flush(lines.length);
  return fragments;
}

export function extractCommentBlocks(
  repoPath: string,
  source: string,
): CommentBlock[] {
  const ext = extname(repoPath);
  let fragments: Fragment[];
  if (C_LIKE_EXTENSIONS.has(ext)) {
    fragments = scanCLike(source, ext === ".rs");
  } else if (HASH_EXTENSIONS.has(ext)) {
    fragments = scanLinePrefixed(source, /^\s*#+/);
  } else if (SQL_EXTENSIONS.has(ext)) {
    fragments = scanLinePrefixed(source, /^\s*--/);
  } else if (MARKDOWN_EXTENSIONS.has(ext)) {
    fragments = scanMarkdown(source);
  } else {
    return [];
  }

  const merged: Fragment[] = [];
  for (const fragment of fragments) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.standalone &&
      fragment.standalone &&
      previous.endLine + 1 === fragment.line
    ) {
      previous.endLine = fragment.endLine;
      previous.text = `${previous.text} ${fragment.text}`;
      continue;
    }
    merged.push({ ...fragment });
  }
  return merged
    .map((fragment) => ({
      startLine: fragment.line,
      endLine: fragment.endLine,
      text: fragment.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((block) => block.text.length > 0);
}

const SOURCE_EXTENSION_ALTERNATION =
  "rs|tsx?|jsx?|mjs|cjs|sh|sql|md|html|toml|ya?ml";

type Rule = { readonly pattern: RegExp; readonly reason: string };

// Examples in this file are written with `N` placeholders on purpose: real
// digits here would trip the very rule below, and the gate must be able to
// document itself. Concrete violating strings live in the test file, inside
// string literals, which also proves the string-vs-comment split works.
//
/** Every citation form the #1853 sweep actually removed, plus the two the
 *  reviewer measured as free to add (`LNNN`, prose `line N`). First hit per
 *  block wins — the message names one shape, not all of them. */
const LINE_NUMBER_RULES: readonly Rule[] = [
  {
    // `query.rs:NN`, `db/postgres.rs (NNN line)`, `classifier.ts ~NNN-NNN`.
    // `a.ts:NNN:N` is a stack-trace frame, not a citation: excluded by shape,
    // so a legitimate `expect(stack).toContain(...)` note stays writable.
    // `dialog.test.tsx (NNNN+ lines)` is a size, excluded by the `+`.
    pattern: new RegExp(
      String.raw`\b[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:${SOURCE_EXTENSION_ALTERNATION})\b\s*[:(~]\s*~?\d{1,4}(?!\s*:\s*\d)(?![\w.%+])`,
      "g",
    ),
    reason: "file path cited with a line number",
  },
  {
    // `lang-sql:NNN-NNN` — a colon plus a RANGE is a citation whatever the stem.
    pattern:
      /(?<![\w.:/-])[A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_.-]+)*:\d{1,4}\s*[-–]\s*\d{1,4}(?![\w.%])/g,
    reason: "module cited with a line range",
  },
  {
    // `line NNNN`, `줄 N`, `라인 NNNN`, `line #NN`. Plural + a single number is
    // a coverage metric (`--fail-under-lines NN`), so plural needs a range.
    pattern:
      /(?<![\w.-])(?:line|줄|라인)\s*#?\s*~?\d{1,4}(?!\s*[.,]\d)(?![\w%])/gi,
    reason: "prose line-number citation",
  },
  {
    pattern:
      /(?<![\w.-])(?:lines|줄|라인)\s*#?\s*~?\d{1,4}\s*(?:[-–~,]|to)\s*~?\d{1,4}(?![\w%])/gi,
    reason: "prose line-range citation",
  },
  {
    // `NNN–NNN line`, `(NNN line)` — the sweep found both word orders. Same
    // singular/plural split: `NNN lines` is a file size, not a citation.
    pattern:
      /(?<![\w.-])~?\d{2,4}(?:\s*[-–]\s*~?\d{1,4}\s*(?:lines?|줄|라인)|\s*(?:line|줄|라인))\b/gi,
    reason: "prose line-number citation (number first)",
  },
  {
    // `column.rs LNNN`. Repo-wide hits at introduction: 0.
    pattern: /(?<![\w-])L\d{2,4}\b/g,
    reason: "`LNNN` line citation",
  },
  {
    // `Strategy NNNN:`, `(strategy NNN)`, `strategy doc NNN` — the design doc
    // cited by a bare number. Issue numbers (`#` prefix), dates (`-` on either
    // side) and schema ids (leading zero) are excluded by the boundary classes.
    pattern:
      /\b(?:strategy|전략|design[-\s]doc|설계\s*문서)\b[^,;)\n]{0,32}?(?<![\w.#-])~?[1-9]\d{1,3}(?![\w%-])/gi,
    reason: "design-doc citation by bare number",
  },
];

/** `SchemaTree:NNN`, `stores/workspaceStore/persistence:NN` — no extension, so
 *  the only thing separating a citation from a Docker tag (`mariadb:NN`), a URL
 *  port or the Rust error string `...::describe:NNN` is (a) the stem naming a
 *  tracked file and (b) the token looking like a module path rather than a bare
 *  lowercase word. Both are data checks, not an exception list.
 *  ponytail: a lowercase single-word module cited without a path prefix slips
 *  through; widen if one appears. */
const STEM_LINE_REF =
  /(?<![\w.:/-])([A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_.-]+)*):\d{1,4}(?!\s*:\s*\d)(?![\w.%])/g;

function looksLikeModuleToken(token: string): boolean {
  return token.includes("/") || token !== token.toLowerCase();
}

export function findLineNumberRefInBlock(
  block: CommentBlock,
  trackedStems: ReadonlySet<string> = new Set(),
): { readonly snippet: string; readonly reason: string } | null {
  for (const rule of LINE_NUMBER_RULES) {
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(block.text);
    if (match) return { snippet: match[0], reason: rule.reason };
  }
  STEM_LINE_REF.lastIndex = 0;
  for (
    let match = STEM_LINE_REF.exec(block.text);
    match !== null;
    match = STEM_LINE_REF.exec(block.text)
  ) {
    const stem = match[1].split("/").at(-1) ?? "";
    if (looksLikeModuleToken(match[1]) && trackedStems.has(stem)) {
      return { snippet: match[0], reason: "module cited with a line number" };
    }
  }
  return null;
}

export function findLineNumberRefViolations(
  files: ReadonlyMap<string, string>,
  trackedStems: ReadonlySet<string> = new Set(),
): CommentRefViolation[] {
  const violations: CommentRefViolation[] = [];
  for (const [path, source] of files) {
    if (!isCommentRefScanPath(path)) continue;
    for (const block of extractCommentBlocks(path, source)) {
      const hit = findLineNumberRefInBlock(block, trackedStems);
      if (!hit) continue;
      violations.push({
        path,
        startLine: block.startLine,
        endLine: block.endLine,
        snippet: hit.snippet,
        reason: hit.reason,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Rule 2 — the replacement has to point at something that exists.
// ---------------------------------------------------------------------------

export const DESIGN_DOC_PATH =
  "docs/archives/design-snapshots/state-management-strategy-2026-05-15.md";

/** `` `tabSlice.ts` `removeTab` ``, `` slices/tabSlice.ts 의 `removeTab` `` — a
 *  file token immediately followed by a backticked identifier. Adjacency is
 *  what makes the pair a citation; two names merely sharing a paragraph are
 *  not, so anything longer than a connector is left unverified rather than
 *  guessed at. */
const PATH_THEN_SYMBOL =
  /([A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:rs|tsx?|jsx?|mjs|cjs))`?[\s의',—→:-]{0,5}`([A-Za-z_][A-Za-z0-9_]*)`/g;

const DOC_TAG_SOURCE = String.raw`F\.\d|Q\d{1,2}`;
/** `F.2 "Partial fallback"` and the reverse order `"Single-instance 모델" (Q3)`. */
const DOC_TAG_BEFORE_TITLE = new RegExp(
  String.raw`\b(${DOC_TAG_SOURCE})\b[^"“”\n]{0,24}["“]([^"”\n]{2,60})["”]`,
  "g",
);
const DOC_TAG_AFTER_TITLE = new RegExp(
  String.raw`["“]([^"”\n]{2,60})["”][^"“”\n]{0,24}\b(${DOC_TAG_SOURCE})\b`,
  "g",
);
/** A design-doc tag with no quoted section title. The anchor can exist and
 *  still describe another subject — #1853 B6 cited `Q13` (workspace-window
 *  policy) for launcher close→hide, which lives under Q3 — so this shape is
 *  reported as unverifiable instead of silently passing. */
const DOC_TAG_BARE = new RegExp(String.raw`\b(${DOC_TAG_SOURCE})\b`, "g");

function resolveTrackedPath(
  token: string,
  trackedPaths: readonly string[],
): string | null {
  if (trackedPaths.includes(token)) return token;
  const suffix = `/${token}`;
  const matches = trackedPaths.filter((path) => path.endsWith(suffix));
  return matches.length === 1 ? matches[0] : null;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every string the design doc uses as a section anchor: heading text, bold
 *  labels (`**Partial fallback**:`, this doc's sub-section idiom) and the topic
 *  cell of a `| **QNN** | topic | ... |` lock-table row. A quoted string that is
 *  none of these is a UI label or a spec sentence, not a citation target, so it
 *  is left unverified instead of being reported as a missing section. */
function designDocAnchors(docText: string): string[] {
  const anchors: string[] = [];
  for (const line of docText.split("\n")) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) anchors.push(heading[1].trim());
    const row = /^\|\s*\*\*[^*|]+\*\*\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (row) anchors.push(row[1]);
    for (const bold of line.matchAll(/\*\*([^*\n]{2,60})\*\*/g)) {
      anchors.push(bold[1].trim());
    }
  }
  return anchors;
}

/** Text of every section the tag anchors. A markdown heading anchors until the
 *  next heading of the same or higher level; a top-level list item (this doc
 *  puts each table definition in one) anchors until the next item at the same
 *  indent or the next heading; anything else anchors its own line. Checking the
 *  title against THESE ranges — not the whole document — is what turns "the
 *  anchor exists" into "the anchor is about this". */
function tagSections(docText: string, tag: string): string[] {
  const lines = docText.split("\n");
  const headingLevel = (line: string): number =>
    /^(#{1,6})\s/.exec(line)?.[1].length ?? 0;
  const bulletIndent = (line: string): number | null => {
    const bullet = /^(\s*)[-*]\s/.exec(line);
    return bullet ? bullet[1].length : null;
  };
  const tagPattern = new RegExp(
    String.raw`(?<![\w.])${escapeRegExp(tag)}(?![\w])`,
  );
  const sections: string[] = [];
  lines.forEach((line, index) => {
    if (!tagPattern.test(line)) return;
    const level = headingLevel(line);
    const indent = bulletIndent(line);
    if (level === 0 && indent === null) {
      sections.push(line);
      return;
    }
    let end = lines.length;
    for (let next = index + 1; next < lines.length; next += 1) {
      const nextLevel = headingLevel(lines[next]);
      const nextIndent = bulletIndent(lines[next]);
      const closesHeading = level > 0 && nextLevel > 0 && nextLevel <= level;
      const closesBullet =
        indent !== null &&
        (nextLevel > 0 || (nextIndent !== null && nextIndent <= indent));
      if (closesHeading || closesBullet) {
        end = next;
        break;
      }
    }
    sections.push(lines.slice(index, end).join("\n"));
  });
  return sections;
}

export function findUnresolvedRefViolations(
  files: ReadonlyMap<string, string>,
  trackedPaths: readonly string[],
  cwd: string,
): {
  unresolved: CommentRefViolation[];
  unverifiable: CommentRefViolation[];
  checked: number;
} {
  const unresolved: CommentRefViolation[] = [];
  const unverifiable: CommentRefViolation[] = [];
  let checked = 0;
  const sectionCache = new Map<string, string[]>();
  const sourceCache = new Map<string, string>();
  const designDocAbsolute = resolve(cwd, DESIGN_DOC_PATH);
  const designDoc = existsSync(designDocAbsolute)
    ? readFileSync(designDocAbsolute, "utf8")
    : "";
  const anchors = designDocAnchors(designDoc);

  const sectionsOf = (tag: string): string[] => {
    let sections = sectionCache.get(tag);
    if (!sections) {
      sections = tagSections(designDoc, tag);
      sectionCache.set(tag, sections);
    }
    return sections;
  };
  const sourceOf = (path: string): string => {
    let source = sourceCache.get(path);
    if (source === undefined) {
      source = files.get(path) ?? readFileSync(resolve(cwd, path), "utf8");
      sourceCache.set(path, source);
    }
    return source;
  };

  for (const [path, source] of files) {
    if (!isCommentRefScanPath(path)) continue;
    for (const block of extractCommentBlocks(path, source)) {
      const record = (
        list: CommentRefViolation[],
        snippet: string,
        reason: string,
      ) => {
        list.push({
          path,
          startLine: block.startLine,
          endLine: block.endLine,
          snippet,
          reason,
        });
      };

      PATH_THEN_SYMBOL.lastIndex = 0;
      for (
        let match = PATH_THEN_SYMBOL.exec(block.text);
        match !== null;
        match = PATH_THEN_SYMBOL.exec(block.text)
      ) {
        const [snippet, fileToken, symbol] = match;
        const target = resolveTrackedPath(fileToken, trackedPaths);
        if (!target) {
          record(unverifiable, snippet, "file token does not resolve uniquely");
          continue;
        }
        checked += 1;
        if (!new RegExp(String.raw`\b${symbol}\b`).test(sourceOf(target))) {
          record(unresolved, snippet, `\`${symbol}\` is not in ${target}`);
        }
      }

      const taggedTitles = new Set<string>();
      const pairs: { snippet: string; tag: string; title: string }[] = [];
      for (const [pattern, tagFirst] of [
        [DOC_TAG_BEFORE_TITLE, true],
        [DOC_TAG_AFTER_TITLE, false],
      ] as const) {
        pattern.lastIndex = 0;
        for (
          let match = pattern.exec(block.text);
          match !== null;
          match = pattern.exec(block.text)
        ) {
          pairs.push({
            snippet: match[0],
            tag: tagFirst ? match[1] : match[2],
            title: tagFirst ? match[2] : match[1],
          });
        }
      }
      for (const { snippet, tag, title } of pairs) {
        taggedTitles.add(tag);
        if (designDoc.length === 0) {
          record(unverifiable, snippet, "design doc not readable");
          continue;
        }
        if (!anchors.some((anchor) => anchor.includes(title))) {
          record(
            unverifiable,
            snippet,
            "quoted text is not a design-doc section anchor",
          );
          continue;
        }
        checked += 1;
        const sections = sectionsOf(tag);
        if (sections.some((section) => section.includes(title))) continue;
        record(
          unresolved,
          snippet,
          `"${title}" is a design-doc section but not under ${tag}`,
        );
      }

      DOC_TAG_BARE.lastIndex = 0;
      for (
        let match = DOC_TAG_BARE.exec(block.text);
        match !== null;
        match = DOC_TAG_BARE.exec(block.text)
      ) {
        if (taggedTitles.has(match[1])) continue;
        record(
          unverifiable,
          match[0],
          "design-doc tag carries no section title",
        );
      }
    }
  }
  return { unresolved, unverifiable, checked };
}
