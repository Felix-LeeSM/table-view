// Sprint 236 (AC-236-01, AC-236-03, AC-236-04, AC-236-09, AC-236-10) —
// AddColumnDialog test suite. Date: 2026-05-07.
//
// Why this file exists:
// - AC-236-04: form behaviour — opens with empty name + empty type;
//   identifier validation surfaces inline (empty / embedded space /
//   embedded quote / leading digit / >63 bytes / NULL byte); NOT NULL
//   toggle reflected in IPC payload; DEFAULT free-text passthrough;
//   CHECK free-text passthrough; collision pre-check disables Apply
//   with hint; commit-success closes + onColumnAdded called once.
// - AC-236-03: IPC payload shape (camelCase) + sequence
//   `[{ previewOnly: true }, { previewOnly: false }]`.
// - AC-236-09: identifier rejection matrix (defense-in-depth — the
//   modal-level surface is the user-visible gate).
// - AC-236-10: DEFAULT/CHECK passthrough verbatim — no escaping, no
//   syntax check, embedded `'` preserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react";

const { mockAddColumnRequest, mockListPostgresTypes } = vi.hoisted(() => ({
  mockAddColumnRequest: vi.fn(),
  mockListPostgresTypes: vi.fn().mockResolvedValue([]),
}));

vi.mock("@lib/tauri", () => ({
  addColumnRequest: mockAddColumnRequest,
  listPostgresTypes: mockListPostgresTypes,
}));

import AddColumnDialog from "./AddColumnDialog";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { invalidatePostgresTypesCache } from "@hooks/usePostgresTypes";

function setDevConnection() {
  useConnectionStore.setState({
    connections: [
      {
        id: "conn-1",
        name: "dev",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        database: "app",
        username: "u",
        password: null,
        environment: "development",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
  });
}

function renderDialog(
  overrides: Partial<{
    onClose: () => void;
    onColumnAdded: () => Promise<void>;
    schemaName: string;
    tableName: string;
    columns: { name: string }[];
  }> = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const onColumnAdded =
    overrides.onColumnAdded ?? vi.fn().mockResolvedValue(undefined);
  const schemaName = overrides.schemaName ?? "public";
  const tableName = overrides.tableName ?? "users";
  // ColumnInfo extra fields are required by the type; tests only care
  // about `name` for the collision pre-check.
  const columns = (overrides.columns ?? []).map((c) => ({
    name: c.name,
    data_type: "int",
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  }));
  const view = render(
    <AddColumnDialog
      connectionId="conn-1"
      schemaName={schemaName}
      tableName={tableName}
      columns={columns}
      open
      onClose={onClose}
      onColumnAdded={onColumnAdded}
    />,
  );
  return { ...view, onClose, onColumnAdded, schemaName, tableName };
}

describe("AddColumnDialog (Sprint 236)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    invalidatePostgresTypesCache("conn-1");
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ entries: [] });
    setDevConnection();
    mockAddColumnRequest.mockResolvedValue({
      sql: 'ALTER TABLE "public"."users" ADD COLUMN "email" varchar(255)',
    });
    mockListPostgresTypes.mockResolvedValue([]);
  });

  // AC-236-04 — opens with empty name + empty type.
  it("[AC-236-04] opens with empty name + empty type fields", () => {
    renderDialog();
    const nameInput = screen.getByLabelText("Column name") as HTMLInputElement;
    const typeInput = screen.getByLabelText(
      "Column data type",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("");
    expect(typeInput.value).toBe("");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  // AC-236-04 / AC-236-09 — identifier rejection matrix.
  it("[AC-236-09] inline error when name has embedded space", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Column name"), {
      target: { value: "bad name" },
    });
    expect(
      screen.getByLabelText("Identifier validation error"),
    ).toHaveTextContent(/letter or underscore/);
  });

  it("[AC-236-09] inline error when name has embedded quote", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Column name"), {
      target: { value: 'bad"name' },
    });
    expect(
      screen.getByLabelText("Identifier validation error"),
    ).toHaveTextContent(/letter or underscore/);
  });

  it("[AC-236-09] inline error when name has leading digit", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Column name"), {
      target: { value: "1bad" },
    });
    expect(
      screen.getByLabelText("Identifier validation error"),
    ).toHaveTextContent(/letter or underscore/);
  });

  it("[AC-236-09] inline error when name length > 63 bytes", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Column name"), {
      target: { value: "a".repeat(64) },
    });
    expect(
      screen.getByLabelText("Identifier validation error"),
    ).toHaveTextContent(/63 bytes/);
  });

  it("[AC-236-09] inline error when name has embedded NULL byte", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Column name"), {
      target: { value: "bad\0name" },
    });
    expect(
      screen.getByLabelText("Identifier validation error"),
    ).toHaveTextContent(/letter or underscore/);
  });

  // AC-236-04 — collision pre-check disables Apply.
  it("[AC-236-04] collision pre-check disables Apply with inline hint", () => {
    renderDialog({ columns: [{ name: "email" }] });
    fireEvent.change(screen.getByLabelText("Column name"), {
      target: { value: "email" },
    });
    fireEvent.change(screen.getByLabelText("Column data type"), {
      target: { value: "varchar(255)" },
    });
    expect(screen.getByLabelText("Column name collision")).toHaveTextContent(
      /already exists/,
    );
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  // AC-236-03 — IPC payload shape on Show DDL preview fetch.
  it("[AC-236-03] Show DDL fires addColumnRequest with previewOnly:true + camelCase", async () => {
    renderDialog({ schemaName: "public", tableName: "users" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Column name"), {
        target: { value: "email" },
      });
      fireEvent.change(screen.getByLabelText("Column data type"), {
        target: { value: "varchar(255)" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    });
    await waitFor(() => {
      expect(mockAddColumnRequest).toHaveBeenCalledTimes(1);
    });
    expect(mockAddColumnRequest).toHaveBeenCalledWith({
      connectionId: "conn-1",
      schema: "public",
      table: "users",
      column: {
        name: "email",
        data_type: "varchar(255)",
        nullable: true,
        default_value: null,
      },
      checkExpression: null,
      previewOnly: true,
    });
  });

  // AC-236-04 — NOT NULL toggle reflected in IPC payload.
  it("[AC-236-04] NOT NULL toggle on emits column.nullable=false", async () => {
    renderDialog();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Column name"), {
        target: { value: "email" },
      });
      fireEvent.change(screen.getByLabelText("Column data type"), {
        target: { value: "varchar(255)" },
      });
      fireEvent.click(screen.getByLabelText("NOT NULL"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    });
    await waitFor(() => {
      expect(mockAddColumnRequest).toHaveBeenCalled();
    });
    expect(mockAddColumnRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        column: expect.objectContaining({ nullable: false }),
      }),
    );
  });

  // AC-236-10 — DEFAULT free-text passthrough verbatim.
  it("[AC-236-10] DEFAULT free-text passthrough preserves embedded quote", async () => {
    renderDialog();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Column name"), {
        target: { value: "name" },
      });
      fireEvent.change(screen.getByLabelText("Column data type"), {
        target: { value: "varchar(255)" },
      });
      fireEvent.change(screen.getByLabelText("DEFAULT expression"), {
        target: { value: "'O'Brien'" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    });
    await waitFor(() => {
      expect(mockAddColumnRequest).toHaveBeenCalled();
    });
    expect(mockAddColumnRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        column: expect.objectContaining({ default_value: "'O'Brien'" }),
      }),
    );
  });

  // AC-236-10 — CHECK free-text passthrough verbatim.
  it("[AC-236-10] CHECK free-text passthrough emits checkExpression on payload", async () => {
    renderDialog();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Column name"), {
        target: { value: "age" },
      });
      fireEvent.change(screen.getByLabelText("Column data type"), {
        target: { value: "int" },
      });
      fireEvent.change(screen.getByLabelText("CHECK expression"), {
        target: { value: "age >= 0" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    });
    await waitFor(() => {
      expect(mockAddColumnRequest).toHaveBeenCalled();
    });
    expect(mockAddColumnRequest).toHaveBeenCalledWith(
      expect.objectContaining({ checkExpression: "age >= 0" }),
    );
  });

  // AC-236-04 — commit-success closes modal + onColumnAdded called once.
  it("[AC-236-04] commit-success calls onColumnAdded + closes modal", async () => {
    const onClose = vi.fn();
    const onColumnAdded = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onClose, onColumnAdded });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Column name"), {
        target: { value: "email" },
      });
      fireEvent.change(screen.getByLabelText("Column data type"), {
        target: { value: "varchar(255)" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    });
    await waitFor(() => {
      expect(mockAddColumnRequest).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    await waitFor(() => {
      expect(onColumnAdded).toHaveBeenCalledTimes(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Sequence: previewOnly:true on Show DDL, previewOnly:false on Apply.
    expect(mockAddColumnRequest).toHaveBeenCalledTimes(2);
    expect(mockAddColumnRequest.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ previewOnly: false }),
    );
  });

  // AC-236-04 — preview SQL byte-equivalent for NOT NULL + DEFAULT + CHECK
  // full-combo case. The combination of payload + mock resolution
  // returns a fixture SQL the dialog renders verbatim through
  // `<SqlSyntax>` (asserted as text content).
  it("[AC-236-04] full-combo (NOT NULL + DEFAULT + CHECK) preview SQL byte-equivalent", async () => {
    mockAddColumnRequest.mockResolvedValueOnce({
      sql: 'ALTER TABLE "public"."users" ADD COLUMN "age" int NOT NULL DEFAULT 0 CHECK (age >= 0)',
    });
    renderDialog();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Column name"), {
        target: { value: "age" },
      });
      fireEvent.change(screen.getByLabelText("Column data type"), {
        target: { value: "int" },
      });
      fireEvent.click(screen.getByLabelText("NOT NULL"));
      fireEvent.change(screen.getByLabelText("DEFAULT expression"), {
        target: { value: "0" },
      });
      fireEvent.change(screen.getByLabelText("CHECK expression"), {
        target: { value: "age >= 0" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show DDL" }));
    });
    await waitFor(() => {
      expect(mockAddColumnRequest).toHaveBeenCalled();
    });
    // The preview pane shows the mocked SQL inside a `<pre>` whose
    // textContent flattens the per-token `<span>`s emitted by
    // SqlSyntax. We assert against the `<pre>` directly.
    const previewPane = await waitFor(() => {
      const pre = document.querySelector(
        "#add-column-ddl-preview pre",
      ) as HTMLElement | null;
      if (
        !pre ||
        !pre.textContent?.includes(
          'ALTER TABLE "public"."users" ADD COLUMN "age" int NOT NULL DEFAULT 0 CHECK (age >= 0)',
        )
      ) {
        throw new Error("preview pane not yet matching expected SQL");
      }
      return pre;
    });
    expect(previewPane).toBeInTheDocument();
  });
});
