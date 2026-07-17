import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KvValueBody } from "./KvValueBody";
import type { KvValueEnvelope } from "@/types/kv";

// Purpose: the read-only KV value body renders a JSON object/array as a tree
// and everything else (scalars, non-JSON text, hex) as raw text — KV JSON tree
// Phase 1 (2026-07-17). Guards the `json` routing bug where native ReJSON and
// JSON strings leaked to the raw `<pre>` fallthrough (P2 — user-visible result).

function jsonEnvelope(value: unknown): KvValueEnvelope {
  return {
    key: "doc:1",
    metadata: { key: "doc:1", keyType: "json", ttl: { state: "persistent" } },
    value: { type: "json", value },
  };
}

function utf8Envelope(text: string): KvValueEnvelope {
  return {
    key: "doc:1",
    metadata: {
      key: "doc:1",
      keyType: "string",
      ttl: { state: "persistent" },
      length: text.length,
    },
    value: { type: "string", encoding: "utf8", text, byteLength: text.length },
  };
}

function binaryEnvelope(hex: string): KvValueEnvelope {
  return {
    key: "doc:1",
    metadata: { key: "doc:1", keyType: "string", ttl: { state: "persistent" } },
    value: {
      type: "string",
      encoding: "binary",
      hex,
      byteLength: hex.length / 2,
    },
  };
}

const tree = () => screen.queryByTestId("document-tree-panel");

describe("KvValueBody", () => {
  // Reason: native ReJSON object is already parsed → render as a tree, never
  // the raw `<pre>` (the routing bug this phase fixes).
  it("renders a JSON tree for a json object value", () => {
    render(<KvValueBody envelope={jsonEnvelope({ name: "Ada" })} />);
    expect(tree()).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
  });

  // Reason: json array is nested-capable too.
  it("renders a JSON tree for a json array value", () => {
    render(<KvValueBody envelope={jsonEnvelope([1, 2, 3])} />);
    expect(tree()).toBeInTheDocument();
  });

  // Reason: a JSON string whose parse is an object → tree (the string-path
  // parity with native json).
  it("renders a JSON tree for a utf8 string holding a JSON object", () => {
    render(<KvValueBody envelope={utf8Envelope('{"a":1}')} />);
    expect(tree()).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  // Reason: JSON string holding an array → tree.
  it("renders a JSON tree for a utf8 string holding a JSON array", () => {
    render(<KvValueBody envelope={utf8Envelope("[1,2]")} />);
    expect(tree()).toBeInTheDocument();
  });

  // Reason: a bare numeric string must NOT inflate into a single-node tree —
  // it stays raw text (`isNestedCapable` parity).
  it("renders raw text for a numeric string value", () => {
    render(<KvValueBody envelope={utf8Envelope("42")} />);
    expect(tree()).not.toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  // Reason: non-JSON free text stays raw (parse failure → raw fallback, no throw).
  it("renders raw text for a non-JSON string value", () => {
    render(<KvValueBody envelope={utf8Envelope("hello world")} />);
    expect(tree()).not.toBeInTheDocument();
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  // Reason: empty string is not tree-capable — raw path, no crash.
  it("renders raw for an empty string value without a tree", () => {
    render(<KvValueBody envelope={utf8Envelope("")} />);
    expect(tree()).not.toBeInTheDocument();
  });

  // Reason: a json scalar (root-level `42`) is not nested-capable → raw text.
  it("renders raw text for a json scalar value", () => {
    render(<KvValueBody envelope={jsonEnvelope(42)} />);
    expect(tree()).not.toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  // Reason: binary strings show their hex verbatim and MUST NOT attempt a JSON
  // parse (hex like "5b5d" would otherwise never be object/array anyway, but
  // the branch is explicit — no tree, hex shown).
  it("renders hex text for a binary string and skips the JSON attempt", () => {
    render(<KvValueBody envelope={binaryEnvelope("deadbeef")} />);
    expect(tree()).not.toBeInTheDocument();
    expect(screen.getByText("deadbeef")).toBeInTheDocument();
  });

  // Reason: the raw path offers the `⤢` detail dialog for long/one-line values.
  it("opens the cell detail dialog from the expand button on the raw path", async () => {
    const user = userEvent.setup();
    render(<KvValueBody envelope={utf8Envelope("hello world")} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /expand doc:1 value/i }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
