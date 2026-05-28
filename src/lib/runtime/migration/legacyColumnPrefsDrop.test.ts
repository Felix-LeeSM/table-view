// 작성 2026-05-16 (Phase 4 sprint-369) — legacy LS drop + 1회 toast.
//
// 사유: sprint-369 의 invariant 는
//   (1) boot 시 `column-widths:*` / `hidden-columns:*` LS key 전부 delete,
//   (2) 사용자에게 "Per-table preferences will reset once" toast 1회만,
//   (3) sentinel (`meta.legacy_column_prefs_drop_dismissed`) 가 이미 "1" 이면
//       toast skip 하고 LS 도 건드리지 않음 (이미 done).
//
// AC-369-11 매핑.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

vi.mock("@/lib/tauri/meta_sentinel", () => ({
  getMetaSentinel: vi.fn(async () => null),
  setMetaSentinel: vi.fn(async () => undefined),
}));

vi.mock("@/lib/runtime/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { dropLegacyColumnPrefs } from "./legacyColumnPrefsDrop";
import { getMetaSentinel, setMetaSentinel } from "@/lib/tauri/meta_sentinel";
import { toast } from "@/lib/runtime/toast";

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("dropLegacyColumnPrefs — happy path (AC-369-11)", () => {
  it("removes all column-widths:* and hidden-columns:* keys and shows one toast", async () => {
    window.localStorage.setItem(
      "column-widths:rdb:public:users",
      JSON.stringify({ id: 200 }),
    );
    window.localStorage.setItem(
      "column-widths:rdb:public:orders",
      JSON.stringify({ id: 220 }),
    );
    window.localStorage.setItem(
      "hidden-columns:rdb:public:users",
      JSON.stringify(["secret"]),
    );
    window.localStorage.setItem(
      "hidden-columns:document:db:coll",
      JSON.stringify(["legacy"]),
    );
    // Unrelated keys MUST survive.
    window.localStorage.setItem("table-view.theme", "dark");
    window.localStorage.setItem("table-view-other", "x");

    (getMetaSentinel as Mock).mockResolvedValueOnce(null);

    await dropLegacyColumnPrefs();

    // The 4 legacy keys are gone.
    expect(
      window.localStorage.getItem("column-widths:rdb:public:users"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("column-widths:rdb:public:orders"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("hidden-columns:rdb:public:users"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("hidden-columns:document:db:coll"),
    ).toBeNull();

    // Unrelated keys untouched.
    expect(window.localStorage.getItem("table-view.theme")).toBe("dark");
    expect(window.localStorage.getItem("table-view-other")).toBe("x");

    // One toast was shown (info or warning variant) with the canonical message.
    const allCalls = [
      ...(toast.info as Mock).mock.calls,
      ...(toast.warning as Mock).mock.calls,
    ];
    expect(allCalls.length).toBe(1);
    expect(String(allCalls[0]?.[0])).toMatch(/per-table preferences/i);

    // Sentinel was set so the next boot skips.
    expect(setMetaSentinel).toHaveBeenCalledWith({
      key: "legacy_column_prefs_drop_dismissed",
      value: "1",
    });
  });
});

describe("dropLegacyColumnPrefs — sentinel skip", () => {
  it("does nothing when sentinel is already '1'", async () => {
    (getMetaSentinel as Mock).mockResolvedValueOnce("1");

    window.localStorage.setItem(
      "column-widths:rdb:public:users",
      JSON.stringify({ id: 200 }),
    );

    await dropLegacyColumnPrefs();

    // LS still has the entry (we don't re-clean).
    expect(
      window.localStorage.getItem("column-widths:rdb:public:users"),
    ).not.toBeNull();

    // No toast emitted.
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();

    // No second sentinel write.
    expect(setMetaSentinel).not.toHaveBeenCalled();
  });
});

describe("dropLegacyColumnPrefs — empty inventory", () => {
  it("still sets the sentinel + skips toast when no legacy keys exist", async () => {
    (getMetaSentinel as Mock).mockResolvedValueOnce(null);

    await dropLegacyColumnPrefs();

    // No toast — we only annoy the user when there's actual prior state.
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();

    // Sentinel still gets written so we don't re-scan every boot.
    expect(setMetaSentinel).toHaveBeenCalledWith({
      key: "legacy_column_prefs_drop_dismissed",
      value: "1",
    });
  });
});

describe("dropLegacyColumnPrefs — robust against IPC failure", () => {
  it("when getMetaSentinel rejects, proceeds with the cleanup (best-effort)", async () => {
    (getMetaSentinel as Mock).mockRejectedValueOnce(new Error("backend down"));
    window.localStorage.setItem(
      "column-widths:rdb:public:users",
      JSON.stringify({ id: 200 }),
    );

    await dropLegacyColumnPrefs();

    // Cleanup still ran.
    expect(
      window.localStorage.getItem("column-widths:rdb:public:users"),
    ).toBeNull();
  });

  it("when setMetaSentinel rejects, swallows the error (best-effort)", async () => {
    (getMetaSentinel as Mock).mockResolvedValueOnce(null);
    (setMetaSentinel as Mock).mockRejectedValueOnce(new Error("backend down"));

    // Must not throw.
    await expect(dropLegacyColumnPrefs()).resolves.toBeUndefined();
  });
});
