// Sprint 189 (D-4) — `useSafeModeGate` is now pure store wiring around
// `decideSafeModeAction` (covered by `src/lib/safeMode.test.ts`). These
// tests assert that the hook reads from `useSafeModeStore` and
// `useConnectionStore` correctly; the decision matrix itself is not
// re-tested here to avoid duplicate coverage.
//
// Sprint 188 baseline (AC-188-02) lived here as a 6-case matrix — the
// canonical-block-reason verbatim assertion was migrated to the lib test
// (AC-189-06a-3). date 2026-05-02.
//
// Sprint 245 (ADR 0022 Phase 1) — `useSafeModeReadOnly` (Sprint 243)
// removed. Its describe block (5 cases) was deleted because the
// destructive-only policy no longer needs a UI-level read-only gate;
// the per-statement `useSafeModeGate.decide` covers the destructive
// dialog and Cmd+Z (Phase 5) handles the safe-write safety net. date
// 2026-05-08.
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSafeModeGate } from "./useSafeModeGate";
import { useSafeModeStore, SAFE_MODE_STORAGE_KEY } from "@stores/safeModeStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { StatementAnalysis } from "@/lib/sql/sqlSafety";
import type { ConnectionConfig } from "@/types/connection";

const DANGER: StatementAnalysis = {
  kind: "ddl-drop",
  severity: "danger",
  reasons: ["DROP TABLE"],
};

function makeConn(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: "c1",
    name: "test",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "u",
    database: "db",
    group_id: null,
    color: null,
    has_password: false,
    paradigm: "rdb",
    environment: "production",
    ...overrides,
  };
}

describe("useSafeModeGate (store wiring)", () => {
  beforeEach(() => {
    localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    useSafeModeStore.setState({ mode: "strict" });
    useConnectionStore.setState({ connections: [] });
  });

  it("[AC-245-H2] reads `mode` from useSafeModeStore", () => {
    // mode=warn + production + danger → confirm (lib decision matrix).
    // Asserts hook propagates `mode` change into the pure call.
    useConnectionStore.setState({ connections: [makeConn()] });
    useSafeModeStore.setState({ mode: "warn" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    expect(result.current.decide(DANGER).action).toBe("confirm");
  });

  it("[AC-245-H2] reads `environment` from useConnectionStore via connectionId", () => {
    // Sprint 245 — staging + warn + danger → allow (non-production warn
    // is unguarded under the destructive-only policy). Strict on
    // staging would `confirm` (M.1 new flow); we use warn here so the
    // delta vs the previous Sprint 243 wiring is the *value* (allow),
    // proving environment propagation independently of mode.
    useConnectionStore.setState({
      connections: [makeConn({ environment: "staging" })],
    });
    useSafeModeStore.setState({ mode: "warn" });
    const { result } = renderHook(() => useSafeModeGate("c1"));
    expect(result.current.decide(DANGER).action).toBe("allow");
  });

  it("[AC-245-H2] missing connection (id not found) → null environment / allow", () => {
    // Mongo aggregate path can fire before the connection store has hydrated
    // a particular id; the hook normalises missing → null and the lib
    // matrix maps null → non-production. Combined with mode=warn, the
    // result is allow.
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "warn" });
    const { result } = renderHook(() => useSafeModeGate("missing"));
    expect(result.current.decide(DANGER).action).toBe("allow");
  });
});
