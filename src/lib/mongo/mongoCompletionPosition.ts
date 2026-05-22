import type { CompletionContext } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

interface MinimalSyntaxNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly parent: MinimalSyntaxNode | null;
  readonly firstChild: MinimalSyntaxNode | null;
}

export type MongoCompletionPositionKind =
  | "stage-key"
  | "accumulator-or-filter-key"
  | "value"
  | "unknown";

export function classifyMongoCompletionPosition(
  context: CompletionContext,
): MongoCompletionPositionKind {
  const { state, pos } = context;
  const tree = syntaxTree(state);
  const node: MinimalSyntaxNode = tree.resolveInner(pos, -1);
  const upToCursor = state.doc.sliceString(0, pos);
  const objectIsInArrayByText = closestObjectIsInArrayByText(upToCursor);

  for (let cur: MinimalSyntaxNode | null = node; cur; cur = cur.parent) {
    if (cur.name === "String") {
      if (cur.parent && cur.parent.name === "Property") {
        const propName = cur.parent.firstChild;
        if (propName && propName.from === cur.from && propName.to === cur.to) {
          return nearestObjectIsInArray(cur) || objectIsInArrayByText
            ? "stage-key"
            : "accumulator-or-filter-key";
        }
      }
      return "value";
    }
    if (cur.name === "PropertyName") {
      return nearestObjectIsInArray(cur) || objectIsInArrayByText
        ? "stage-key"
        : "accumulator-or-filter-key";
    }
    if (cur.name === "Object" || cur.name === "Array") break;
  }

  const lastChar = lastMeaningfulChar(upToCursor);

  if (lastChar === ":") return "value";
  if (lastChar === "{" || lastChar === ",") {
    return objectIsInArrayByText || closestObjectIsInArray(tree, pos)
      ? "stage-key"
      : "accumulator-or-filter-key";
  }
  if (lastChar === "[") return "stage-key";

  return "unknown";
}

function lastMeaningfulChar(upToCursor: string): string | null {
  for (let i = upToCursor.length - 1; i >= 0; i--) {
    const ch = upToCursor[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") continue;
    if (/[A-Za-z0-9_$"]/.test(ch)) continue;
    return ch;
  }
  return null;
}

function nearestObjectIsInArray(node: MinimalSyntaxNode): boolean {
  for (let cur: MinimalSyntaxNode | null = node; cur; cur = cur.parent) {
    if (cur.name === "Object") {
      const parent = cur.parent;
      return parent?.name === "Array";
    }
  }
  return false;
}

function closestObjectIsInArray(
  tree: ReturnType<typeof syntaxTree>,
  pos: number,
): boolean {
  const node: MinimalSyntaxNode = tree.resolveInner(pos, -1);
  for (let cur: MinimalSyntaxNode | null = node; cur; cur = cur.parent) {
    if (cur.name === "Object") {
      const parent = cur.parent;
      return parent?.name === "Array";
    }
  }
  return false;
}

function closestObjectIsInArrayByText(upToCursor: string): boolean {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < upToCursor.length; i++) {
    const ch = upToCursor[i]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }

    if (ch === "}" || ch === "]") {
      const expected = ch === "}" ? "{" : "[";
      if (stack[stack.length - 1] === expected) stack.pop();
    }
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i] !== "{") continue;
    return stack[i - 1] === "[";
  }

  return false;
}
