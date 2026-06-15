import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SchemaGraphDiffSummary } from "@/lib/schemaGraphDiff";
import SchemaGraphDiffPanel from "./SchemaGraphDiffPanel";

describe("SchemaGraphDiffPanel", () => {
  it("renders read-only added, removed, and changed groups", () => {
    render(<SchemaGraphDiffPanel diff={diffSummary()} />);

    expect(
      screen.getByRole("region", { name: /schema diff/i }),
    ).toHaveTextContent(/read-only cached schemagraph diff/i);
    expect(screen.queryByRole("button", { name: /apply|migrate/i })).toBeNull();

    const added = screen.getByRole("list", { name: "Added schema changes" });
    expect(within(added).getByText("public.audit_log")).toBeInTheDocument();

    const removed = screen.getByRole("list", {
      name: "Removed schema changes",
    });
    expect(within(removed).getByText("public.users.name")).toBeInTheDocument();

    const changed = screen.getByRole("list", {
      name: "Changed schema changes",
    });
    expect(within(changed).getByText("public.users.email")).toBeInTheDocument();
    expect(changed).toHaveTextContent("nullable");
    expect(changed).toHaveTextContent("true -> false");
  });

  it("shows an empty cached-snapshot state without data-compare or migration claims", () => {
    render(
      <SchemaGraphDiffPanel
        diff={{
          ...diffSummary(),
          groups: emptyGroups(),
          totals: { added: 0, removed: 0, changed: 0, total: 0 },
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /no schema differences found in cached schemagraph snapshots/i,
    );
    expect(screen.queryByText(/data compare/i)).toBeNull();
    expect(screen.queryByText(/import|export|admin/i)).toBeNull();
  });
});

function diffSummary(): SchemaGraphDiffSummary {
  return {
    source: {
      before: { dbType: "postgresql", database: "app" },
      after: { dbType: "postgresql", database: "app" },
    },
    sameSource: true,
    groups: {
      tables: {
        added: [
          {
            id: "table:public.audit_log",
            entityKind: "table",
            kind: "added",
            label: "public.audit_log",
            changes: [],
          },
        ],
        removed: [],
        changed: [],
      },
      columns: {
        added: [],
        removed: [
          {
            id: "table:public.users.column:name",
            entityKind: "column",
            kind: "removed",
            label: "public.users.name",
            changes: [],
          },
        ],
        changed: [
          {
            id: "table:public.users.column:email",
            entityKind: "column",
            kind: "changed",
            label: "public.users.email",
            changes: [{ field: "nullable", before: "true", after: "false" }],
          },
        ],
      },
      indexes: emptyDiffGroup(),
      constraints: emptyDiffGroup(),
      foreignKeys: emptyDiffGroup(),
    },
    tables: {
      added: [
        {
          id: "table:public.audit_log",
          entityKind: "table",
          kind: "added",
          label: "public.audit_log",
          changes: [],
        },
      ],
      removed: [],
      changed: [],
    },
    columns: {
      added: [],
      removed: [
        {
          id: "table:public.users.column:name",
          entityKind: "column",
          kind: "removed",
          label: "public.users.name",
          changes: [],
        },
      ],
      changed: [
        {
          id: "table:public.users.column:email",
          entityKind: "column",
          kind: "changed",
          label: "public.users.email",
          changes: [{ field: "nullable", before: "true", after: "false" }],
        },
      ],
    },
    indexes: emptyDiffGroup(),
    constraints: emptyDiffGroup(),
    foreignKeys: emptyDiffGroup(),
    totals: { added: 1, removed: 1, changed: 1, total: 3 },
  };
}

function emptyGroups(): SchemaGraphDiffSummary["groups"] {
  return {
    tables: emptyDiffGroup(),
    columns: emptyDiffGroup(),
    indexes: emptyDiffGroup(),
    constraints: emptyDiffGroup(),
    foreignKeys: emptyDiffGroup(),
  };
}

function emptyDiffGroup() {
  return {
    added: [],
    removed: [],
    changed: [],
  };
}
