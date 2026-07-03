// Issue #1231 — RowCapSetting persists the clamped cap and resets to default.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import RowCapSetting from "./RowCapSetting";

function openAndGetInput(): HTMLInputElement {
  fireEvent.click(screen.getByTestId("row-cap-setting-trigger"));
  return screen.getByTestId("row-cap-input") as HTMLInputElement;
}

function lastPersistArg(): unknown {
  const calls = invokeMock.mock.calls.filter((c) => c[0] === "persist_setting");
  return calls[calls.length - 1]?.[1];
}

describe("RowCapSetting (#1231)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // get_setting → null (no persisted value), everything else resolves.
    invokeMock.mockResolvedValue(null);
  });

  it("persists an in-range edit as query_row_cap", async () => {
    render(<RowCapSetting />);
    const input = openAndGetInput();
    await act(async () => {
      fireEvent.change(input, { target: { value: "50000" } });
      fireEvent.blur(input);
    });
    expect(lastPersistArg()).toEqual({
      req: { key: "query_row_cap", valueJson: "50000" },
    });
  });

  it("clamps below the minimum before persisting", async () => {
    render(<RowCapSetting />);
    const input = openAndGetInput();
    await act(async () => {
      fireEvent.change(input, { target: { value: "5" } });
      fireEvent.blur(input);
    });
    // 5 → MIN_ROW_CAP (100).
    expect(lastPersistArg()).toEqual({
      req: { key: "query_row_cap", valueJson: "100" },
    });
  });

  it("clamps above the maximum before persisting", async () => {
    render(<RowCapSetting />);
    const input = openAndGetInput();
    await act(async () => {
      fireEvent.change(input, { target: { value: "99999999" } });
      fireEvent.blur(input);
    });
    // 99,999,999 → MAX_ROW_CAP (1,000,000).
    expect(lastPersistArg()).toEqual({
      req: { key: "query_row_cap", valueJson: "1000000" },
    });
  });

  it("reset calls reset_setting (row-delete → backend default)", async () => {
    render(<RowCapSetting />);
    openAndGetInput();
    await act(async () => {
      fireEvent.click(screen.getByTestId("row-cap-reset"));
    });
    const resetCall = invokeMock.mock.calls.find(
      (c) => c[0] === "reset_setting",
    );
    expect(resetCall?.[1]).toEqual({ key: "query_row_cap" });
  });
});
