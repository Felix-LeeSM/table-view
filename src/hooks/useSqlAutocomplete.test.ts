import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSqlAutocomplete } from "./useSqlAutocomplete";
import { useSchemaStore } from "../stores/schemaStore";

describe("useSqlAutocomplete", () => {
  beforeEach(() => {
    useSchemaStore.setState({ tables: {} });
  });

  it("returns empty namespace when no tables loaded", () => {
    const { result } = renderHook(() => useSqlAutocomplete("conn1"));
    expect(result.current).toEqual({});
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
        "conn1:public": [
          { name: "users", schema: "public", row_count: 100 },
        ],
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1"));
    expect(result.current).toHaveProperty("users");
    expect(result.current).toHaveProperty("public.users");
  });

  it("excludes tables from other connections", () => {
    useSchemaStore.setState({
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: 100 },
        ],
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

    expect(result.current).toEqual({});

    useSchemaStore.setState({
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: 100 },
        ],
      },
    });

    rerender({ connId: "conn1" });
    expect(result.current).toHaveProperty("users");
  });
});
