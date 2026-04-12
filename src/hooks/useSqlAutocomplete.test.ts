import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSqlAutocomplete } from "./useSqlAutocomplete";
import { useSchemaStore } from "../stores/schemaStore";

describe("useSqlAutocomplete", () => {
  beforeEach(() => {
    useSchemaStore.setState({ tables: {} });
  });

  it("returns namespace with functions but no tables when no tables loaded", () => {
    const { result } = renderHook(() => useSqlAutocomplete("conn1"));
    // Functions are always present
    expect(result.current).toHaveProperty("COUNT");
    // No table entries
    expect(result.current).not.toHaveProperty("users");
  });

  it("includes table names for the given connection", () => {
    useSchemaStore.setState({
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: 100 },
          { name: "orders", schema: "public", row_count: 50 },
        ],
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1"));
    expect(result.current).toHaveProperty("users");
    expect(result.current).toHaveProperty("orders");
  });

  it("includes schema-qualified names", () => {
    useSchemaStore.setState({
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 100 }],
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1"));
    expect(result.current).toHaveProperty("users");
    expect(result.current).toHaveProperty("public.users");
  });

  it("excludes tables from other connections", () => {
    useSchemaStore.setState({
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 100 }],
        "conn2:public": [
          { name: "products", schema: "public", row_count: 200 },
        ],
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1"));
    expect(result.current).toHaveProperty("users");
    expect(result.current).not.toHaveProperty("products");
  });

  it("updates when tables change", () => {
    const { result, rerender } = renderHook(
      ({ connId }) => useSqlAutocomplete(connId),
      { initialProps: { connId: "conn1" } },
    );

    // Initially no tables (only functions)
    expect(result.current).not.toHaveProperty("users");

    useSchemaStore.setState({
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 100 }],
      },
    });

    rerender({ connId: "conn1" });
    expect(result.current).toHaveProperty("users");
  });

  // -- Sprint 37: Enhanced SQL Autocomplete --

  it("includes common SQL functions in namespace", () => {
    const { result } = renderHook(() => useSqlAutocomplete("conn1"));

    const ns = result.current;
    expect(ns).toHaveProperty("COUNT");
    expect(ns).toHaveProperty("SUM");
    expect(ns).toHaveProperty("AVG");
    expect(ns).toHaveProperty("MIN");
    expect(ns).toHaveProperty("MAX");
    expect(ns).toHaveProperty("COALESCE");
    expect(ns).toHaveProperty("NULLIF");
    expect(ns).toHaveProperty("CAST");
    expect(ns).toHaveProperty("CONCAT");
    expect(ns).toHaveProperty("LENGTH");
    expect(ns).toHaveProperty("UPPER");
    expect(ns).toHaveProperty("LOWER");
    expect(ns).toHaveProperty("TRIM");
    expect(ns).toHaveProperty("SUBSTRING");
    expect(ns).toHaveProperty("EXTRACT");
    expect(ns).toHaveProperty("DATE_TRUNC");
    expect(ns).toHaveProperty("NOW");
    expect(ns).toHaveProperty("CURRENT_TIMESTAMP");
  });

  it("includes table columns when tableColumns provided", () => {
    useSchemaStore.setState({
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 100 }],
      },
    });

    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", { users: ["id", "name", "email"] }),
    );

    const ns = result.current;
    expect(ns).toHaveProperty("users");
    expect(
      (ns as Record<string, Record<string, unknown>>).users,
    ).toHaveProperty("id");
    expect(
      (ns as Record<string, Record<string, unknown>>).users,
    ).toHaveProperty("name");
    expect(
      (ns as Record<string, Record<string, unknown>>).users,
    ).toHaveProperty("email");
  });

  it("handles empty tableColumns gracefully", () => {
    useSchemaStore.setState({
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 100 }],
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", {}));

    const ns = result.current;
    expect(ns).toHaveProperty("users");
    // users should still exist but without column details
    expect((ns as Record<string, Record<string, unknown>>).users).toEqual({});
  });
});
