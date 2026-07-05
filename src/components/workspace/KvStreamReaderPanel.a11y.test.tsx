import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KvStreamReaderPanel } from "./KvStreamReaderPanel";
import { readKvStream } from "@lib/tauri/kv";
import type { KvStreamReadResult } from "@/types/kv";

// #1333 follow-up — the count input's `aria-invalid` (driven by the live
// limit validity) and its `aria-describedby` (previously driven by any stream
// error) were wired to different conditions. A generic backend failure would
// mark a perfectly valid count field as described-by an unrelated error.
vi.mock("@lib/tauri/kv", () => ({ readKvStream: vi.fn() }));

const stream: KvStreamReadResult = {
  type: "stream",
  key: "mystream",
  entries: [],
  start: "-",
  end: "+",
  limit: 100,
};

describe("KvStreamReaderPanel a11y — invalid/describedby alignment (#1333)", () => {
  beforeEach(() => {
    vi.mocked(readKvStream).mockReset();
  });

  it("does not tie the count field to a non-field stream error (valid limit + backend failure)", async () => {
    vi.mocked(readKvStream).mockRejectedValue(new Error("connection refused"));
    render(
      <KvStreamReaderPanel connectionId="c1" database={0} stream={stream} />,
    );

    const count = screen.getByRole("spinbutton");
    expect(count).not.toHaveAttribute("aria-invalid");
    expect(count).not.toHaveAttribute("aria-describedby");

    fireEvent.click(screen.getByRole("button"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("connection refused");
    // Limit is valid, so the field must not claim this generic error describes
    // it, and must not be flagged invalid.
    expect(count).not.toHaveAttribute("aria-invalid");
    expect(count).not.toHaveAttribute("aria-describedby");
  });

  it("ties the count field to its error when the limit itself is invalid", async () => {
    render(
      <KvStreamReaderPanel connectionId="c1" database={0} stream={stream} />,
    );
    const count = screen.getByRole("spinbutton");

    fireEvent.change(count, { target: { value: "" } });
    expect(count).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(screen.getByRole("button"));
    const alert = await screen.findByRole("alert");
    expect(count).toHaveAttribute("aria-describedby", alert.id);
  });
});
