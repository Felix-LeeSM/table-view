// #1216 — Quick Open "schema" results dispatch a `reveal-schema` event that the
// mounted SchemaTree consumes: it re-expands the target schema and focuses its
// row via the existing roving `focusByKey`. These lock the expand behaviour and
// the connection-id guard (focus itself is exercised but not asserted — its rAF
// timing is covered by useTreeRoving's own suite).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import {
  mockLoadSchemas,
  mockLoadTables,
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";

describe("SchemaTree — reveal-schema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  it("re-expands a collapsed schema on a matching reveal-schema event", async () => {
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
    expect(btn).toHaveAttribute("aria-expanded", "true");
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
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
});
