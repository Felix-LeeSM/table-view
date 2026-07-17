import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SqliteFormFields from "./SqliteFormFields";
import type { ConnectionDraft } from "@/types/connection";

// Sprint 146 (AC-143-3) — the Browse button calls into
// `@tauri-apps/plugin-dialog`. We mock the module so jsdom tests don't
// reach into Tauri. The default mock resolves to a fixed file path; tests
// that need a different return value reset the mock per-case.
const mockOpen = vi.fn().mockResolvedValue(null);
const mockSave = vi.fn().mockResolvedValue(null);
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (opts: unknown) => mockOpen(opts),
  save: (opts: unknown) => mockSave(opts),
}));

const mockCreateSqliteDatabaseFile = vi.fn();
vi.mock("@/lib/tauri/connection", () => ({
  createSqliteDatabaseFile: (path: string) =>
    mockCreateSqliteDatabaseFile(path),
}));

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    dbType: "sqlite",
    host: "",
    port: 0,
    user: "",
    password: null,
    database: "",
    groupId: null,
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
    mockSave.mockReset();
    mockSave.mockResolvedValue(null);
    mockCreateSqliteDatabaseFile.mockReset();
  });

  // AC-143-3 — file path input's accessible name comes from its associated
  // <label> ("Database File"); the redundant English aria-label was removed
  // (#1581) so the localized label is the single source of the name.
  it("renders the file path field labelled by its <label> and OMITS host/port/user/password", () => {
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
        filePickerEnabled={true}
      />,
    );
    expect(screen.getByLabelText("Database File")).toBeInTheDocument();
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
        filePickerEnabled={true}
      />,
    );
    act(() => {
      fireEvent.change(
        screen.getByLabelText("Database File") as HTMLInputElement,
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
        filePickerEnabled={true}
      />,
    );
    expect(
      screen.getByLabelText("Browse for database file"),
    ).toBeInTheDocument();
  });

  it("renders a Create button labelled 'Create SQLite database file'", () => {
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
        filePickerEnabled={true}
      />,
    );
    expect(
      screen.getByLabelText("Create SQLite database file"),
    ).toBeInTheDocument();
  });

  it("renders an Open read-only checkbox and propagates readOnly changes", () => {
    const onChange = vi.fn();
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={onChange}
        inputClass={inputClass}
        labelClass={labelClass}
        filePickerEnabled={true}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Open read-only" }));

    expect(onChange).toHaveBeenCalledWith({ readOnly: true });
  });

  // #1461 — the Open read-only checkbox is gated on the `connection.readOnly`
  // capability (declared per DBMS), distinct from the per-connection
  // `draft.readOnly` runtime value the checkbox toggles.
  it("hides the Open read-only checkbox when the readOnly capability is disabled", () => {
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
        filePickerEnabled={true}
        readOnlyEnabled={false}
      />,
    );
    expect(
      screen.queryByRole("checkbox", { name: "Open read-only" }),
    ).not.toBeInTheDocument();
  });

  it("hides file picker buttons when the profile capability is disabled", () => {
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
        filePickerEnabled={false}
      />,
    );
    expect(screen.getByLabelText("Database File")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Browse for database file"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Create SQLite database file"),
    ).not.toBeInTheDocument();
  });

  it("renders DuckDB file copy without the SQLite create action", () => {
    render(
      <SqliteFormFields
        draft={makeDraft({ dbType: "duckdb" })}
        onChange={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
        filePickerEnabled={true}
        databaseLabel="DuckDB"
        defaultPath="database.duckdb"
        fileExtensions={["duckdb"]}
        createEnabled={false}
      />,
    );

    expect(screen.getByLabelText("Database File")).toHaveAttribute(
      "placeholder",
      "/absolute/path/to/database.duckdb",
    );
    expect(
      screen.getByText("Absolute path to a DuckDB database file."),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Create SQLite database file"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Create DuckDB database file"),
    ).not.toBeInTheDocument();
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
        filePickerEnabled={true}
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
        filePickerEnabled={true}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Browse for database file"));
    });

    expect(mockOpen).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clicking Create opens the save dialog, creates the file, and writes the created path into onChange", async () => {
    mockSave.mockResolvedValueOnce("/Users/me/databases/new.sqlite");
    mockCreateSqliteDatabaseFile.mockResolvedValueOnce(
      "/Users/me/databases/new.sqlite",
    );
    const onChange = vi.fn();
    render(
      <SqliteFormFields
        draft={makeDraft({ database: "/Users/me/databases/new.sqlite" })}
        onChange={onChange}
        inputClass={inputClass}
        labelClass={labelClass}
        filePickerEnabled={true}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Create SQLite database file"));
    });

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Create SQLite database file",
        defaultPath: "/Users/me/databases/new.sqlite",
      }),
    );
    expect(mockCreateSqliteDatabaseFile).toHaveBeenCalledWith(
      "/Users/me/databases/new.sqlite",
    );
    expect(onChange).toHaveBeenCalledWith({
      database: "/Users/me/databases/new.sqlite",
    });
  });

  it("does NOT create a database file when the save dialog is cancelled", async () => {
    mockSave.mockResolvedValueOnce(null);
    const onChange = vi.fn();
    render(
      <SqliteFormFields
        draft={makeDraft({ database: "/existing.sqlite" })}
        onChange={onChange}
        inputClass={inputClass}
        labelClass={labelClass}
        filePickerEnabled={true}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Create SQLite database file"));
    });

    expect(mockSave).toHaveBeenCalled();
    expect(mockCreateSqliteDatabaseFile).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders an inline alert when database file creation fails", async () => {
    mockSave.mockResolvedValueOnce("/Users/me/databases/existing.sqlite");
    mockCreateSqliteDatabaseFile.mockRejectedValueOnce(
      "Validation error: SQLite database file already exists",
    );
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
        filePickerEnabled={true}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Create SQLite database file"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "SQLite database file already exists",
    );
  });
});
