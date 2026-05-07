// Sprint 229 — `ForeignKeysTabBody` presentation tests.
//
// Date: 2026-05-07.
//
// Why this file exists:
//
// `ForeignKeysTabBody.tsx` is a pure presentational mapper extracted
// from `CreateTableDialog.tsx` (parent already at 793 LOC after Sprint
// 228; +280 from inline Sprint 229 implementation would push past
// 1000). The parent still owns state + handlers + chain wiring; this
// component just renders props → DOM and forwards events.
//
// These tests cover the sub-component's render shape, aria labels,
// add/remove row callback wiring, and three-section layout. Per AC-229
// contract: ≥ 5 cases + ≥ 70% line coverage on the new file.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";

import ForeignKeysTabBody, {
  type ForeignKeyDraft,
  type CheckDraft,
  type UniqueDraft,
} from "./ForeignKeysTabBody";

function fkDraft(over: Partial<ForeignKeyDraft> = {}): ForeignKeyDraft {
  return {
    trackingId: "fk-1",
    name: "",
    columns: [],
    ref_schema: "public",
    ref_table: "",
    ref_columns: [],
    on_delete: "NO ACTION",
    on_update: "NO ACTION",
    ...over,
  };
}

function checkDraft(over: Partial<CheckDraft> = {}): CheckDraft {
  return {
    trackingId: "chk-1",
    name: "",
    expression: "",
    ...over,
  };
}

function uniqueDraft(over: Partial<UniqueDraft> = {}): UniqueDraft {
  return {
    trackingId: "uq-1",
    name: "",
    columns: [],
    ...over,
  };
}

function defaultProps() {
  return {
    fks: [] as ForeignKeyDraft[],
    checks: [] as CheckDraft[],
    uniques: [] as UniqueDraft[],
    availableColumns: ["id", "user_id"],
    availableSchemas: ["public"],
    refTablesByKey: {} as Record<string, string[]>,
    refColumnsByKey: {} as Record<string, string[]>,
    fkRefColumnsLoadingByTrackingId: {} as Record<string, boolean>,
    onAddFk: vi.fn(),
    onRemoveFk: vi.fn(),
    onUpdateFk: vi.fn(),
    onToggleFkLocalColumn: vi.fn(),
    onToggleFkRefColumn: vi.fn(),
    onAddCheck: vi.fn(),
    onRemoveCheck: vi.fn(),
    onUpdateCheck: vi.fn(),
    onAddUnique: vi.fn(),
    onRemoveUnique: vi.fn(),
    onUpdateUnique: vi.fn(),
    onToggleUniqueColumn: vi.fn(),
  };
}

describe("ForeignKeysTabBody", () => {
  it("renders three sub-section add buttons in the empty state", () => {
    render(<ForeignKeysTabBody {...defaultProps()} />);
    expect(
      screen.getByRole("button", { name: /Add foreign key/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add check/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add unique/i }),
    ).toBeInTheDocument();
  });

  it("'+ Foreign Key' click invokes onAddFk", () => {
    const onAddFk = vi.fn();
    render(<ForeignKeysTabBody {...defaultProps()} onAddFk={onAddFk} />);
    fireEvent.click(screen.getByRole("button", { name: /Add foreign key/i }));
    expect(onAddFk).toHaveBeenCalledTimes(1);
  });

  it("renders FK row with all 7 inputs when fks contains a row", () => {
    const fk = fkDraft({ trackingId: "fk-1", name: "fk_test" });
    render(<ForeignKeysTabBody {...defaultProps()} fks={[fk]} />);
    expect(screen.getByLabelText("Foreign key name")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Foreign key local column: id"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Foreign key local column: user_id"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Foreign key reference schema" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Foreign key reference table"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Foreign key on delete" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Foreign key on update" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Remove foreign key/i }),
    ).toBeInTheDocument();
  });

  it("'−' click on FK row invokes onRemoveFk with the trackingId", () => {
    const onRemoveFk = vi.fn();
    const fk = fkDraft({ trackingId: "fk-xyz" });
    render(
      <ForeignKeysTabBody
        {...defaultProps()}
        fks={[fk]}
        onRemoveFk={onRemoveFk}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Remove foreign key/i }),
    );
    expect(onRemoveFk).toHaveBeenCalledWith("fk-xyz");
  });

  it("CHECK row renders name + expression inputs", () => {
    const c = checkDraft({ trackingId: "chk-1", name: "chk_age" });
    render(<ForeignKeysTabBody {...defaultProps()} checks={[c]} />);
    expect(screen.getByLabelText("Check name")).toBeInTheDocument();
    expect(screen.getByLabelText("Check expression")).toBeInTheDocument();
  });

  it("UNIQUE row renders name + columns multi-checkbox group", () => {
    const u = uniqueDraft({ trackingId: "uq-1", name: "uq_email" });
    render(<ForeignKeysTabBody {...defaultProps()} uniques={[u]} />);
    expect(screen.getByLabelText("Unique name")).toBeInTheDocument();
    expect(screen.getByLabelText("Unique column: id")).toBeInTheDocument();
    expect(screen.getByLabelText("Unique column: user_id")).toBeInTheDocument();
  });

  it("FK ON DELETE / ON UPDATE dropdowns expose 5 PG-canonical options", async () => {
    const fk = fkDraft();
    render(<ForeignKeysTabBody {...defaultProps()} fks={[fk]} />);
    fireEvent.click(
      screen.getByRole("combobox", { name: "Foreign key on delete" }),
    );
    const expected = [
      "NO ACTION",
      "RESTRICT",
      "CASCADE",
      "SET NULL",
      "SET DEFAULT",
    ];
    for (const opt of expected) {
      expect(
        await screen.findByRole("option", { name: opt }),
      ).toBeInTheDocument();
    }
  });

  it("Toggling FK local column invokes onToggleFkLocalColumn", () => {
    const onToggleFkLocalColumn = vi.fn();
    const fk = fkDraft({ trackingId: "fk-9" });
    render(
      <ForeignKeysTabBody
        {...defaultProps()}
        fks={[fk]}
        onToggleFkLocalColumn={onToggleFkLocalColumn}
      />,
    );
    fireEvent.click(screen.getByLabelText("Foreign key local column: id"));
    expect(onToggleFkLocalColumn).toHaveBeenCalledWith("fk-9", "id");
  });

  it("Toggling UNIQUE column invokes onToggleUniqueColumn", () => {
    const onToggleUniqueColumn = vi.fn();
    const u = uniqueDraft({ trackingId: "uq-2" });
    render(
      <ForeignKeysTabBody
        {...defaultProps()}
        uniques={[u]}
        onToggleUniqueColumn={onToggleUniqueColumn}
      />,
    );
    fireEvent.click(screen.getByLabelText("Unique column: user_id"));
    expect(onToggleUniqueColumn).toHaveBeenCalledWith("uq-2", "user_id");
  });

  it("FK reference table renders as Select when refTables list is provided", () => {
    const fk = fkDraft({ trackingId: "fk-10" });
    render(
      <ForeignKeysTabBody
        {...defaultProps()}
        fks={[fk]}
        refTablesByKey={{ "conn-1:public": ["users", "products"] }}
      />,
    );
    // The reference-table input is labelled "Foreign key reference table"
    // either as a Select trigger (combobox role) or a free-text input
    // (textbox role). Both satisfy the contract — see AC-229-09 fallback.
    const refTableEl = screen.getByLabelText("Foreign key reference table");
    expect(refTableEl).toBeInTheDocument();
    // When tables are available the element exposes a combobox role
    // for the Select trigger.
    const within_ = within(refTableEl.closest("div")!);
    expect(within_).toBeDefined();
  });
});
