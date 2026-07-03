// #1216 — Quick Open "schema" result reveal. The mounted SchemaTree owns the
// visible outcome: on a matching `reveal-schema` event it re-expands the target
// schema AND focuses/scrolls its row into view via the shared roving
// `focusByKey`. Asserted on the RENDERED tree (aria-expanded + focus), not on a
// store value, so an invisible no-op regresses these.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import {
  mockLoadSchemas,
  mockLoadTables,
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

// Flush one animation frame — `focusByKey` defers `.focus()` to rAF.
async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe("SchemaTree — reveal-schema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  it("re-expands and focuses the schema row on a matching reveal-schema event", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const btn = screen.getByLabelText("public schema");
    // Schemas auto-expand on mount, so collapse first to observe the reveal.
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("reveal-schema", {
          detail: { connectionId: "conn1", schema: "public" },
        }),
      );
    });
    await flushFrame();

    // Rendered outcome: the row is expanded again AND has been focused (the
    // roving focus is what scrolls it into view in a real browser).
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(btn).toHaveFocus();
  });

  it("ignores reveal-schema aimed at a different connection", async () => {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {},
    });
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });

    const btn = screen.getByLabelText("public schema");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("reveal-schema", {
          detail: { connectionId: "other", schema: "public" },
        }),
      );
    });
    await flushFrame();

    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).not.toHaveFocus();
  });
});
