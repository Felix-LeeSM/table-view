import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SqliteFormFields from "./SqliteFormFields";
import type { ConnectionDraft } from "@/types/connection";

// Sprint 146 (AC-143-3) — the Browse button calls into
// `@tauri-apps/plugin-dialog`. We mock the module so jsdom tests don't
// reach into Tauri. The default mock resolves to a fixed file path; tests
// that need a different return value reset the mock per-case.
const mockOpen = vi.fn().mockResolvedValue(null);
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (opts: unknown) => mockOpen(opts),
}));

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    db_type: "sqlite",
    host: "",
    port: 0,
    user: "",
    password: null,
    database: "",
    group_id: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

const inputClass = "input";
const labelClass = "label";

describe("SqliteFormFields", () => {
  beforeEach(() => {
    mockOpen.mockReset();
    mockOpen.mockResolvedValue(null);
  });

  // AC-143-3 — file path input is labelled "Database file" verbatim.
  it("renders the file path field with aria-label='Database file' and OMITS host/port/user/password", () => {
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );
    expect(screen.getByLabelText("Database file")).toBeInTheDocument();
    // Network/auth fields are absent.
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Port")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("User")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("propagates file path changes through onChange ({ database })", () => {
    const onChange = vi.fn();
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={onChange}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );
    act(() => {
      fireEvent.change(
        screen.getByLabelText("Database file") as HTMLInputElement,
        { target: { value: "/data/app.sqlite" } },
      );
    });
    expect(onChange).toHaveBeenCalledWith({ database: "/data/app.sqlite" });
  });

  // AC-143-3 — Browse button is rendered next to the input.
  it("renders a Browse button labelled 'Browse for database file'", () => {
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );
    expect(
      screen.getByLabelText("Browse for database file"),
    ).toBeInTheDocument();
  });

  // AC-143-3 — clicking Browse opens the Tauri file picker; the chosen
  // path lands in `draft.database` via onChange.
  it("clicking Browse opens the dialog plugin and writes the picked path into onChange", async () => {
    mockOpen.mockResolvedValueOnce("/Users/me/databases/app.sqlite");
    const onChange = vi.fn();
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={onChange}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Browse for database file"));
    });

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: false, directory: false }),
    );
    expect(onChange).toHaveBeenCalledWith({
      database: "/Users/me/databases/app.sqlite",
    });
  });

  // AC-143-3 boundary — user cancels the picker (open() resolves null);
  // we must not overwrite the existing draft.database with null.
  it("does NOT call onChange when the picker is cancelled (open returns null)", async () => {
    mockOpen.mockResolvedValueOnce(null);
    const onChange = vi.fn();
    render(
      <SqliteFormFields
        draft={makeDraft({ database: "/existing.sqlite" })}
        onChange={onChange}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Browse for database file"));
    });

    expect(mockOpen).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
