import { useConnectionStore } from "@stores/connectionStore";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDdlPreviewExecution } from "./useDdlPreviewExecution";

const PLAN_SQL = [
  'CREATE TABLE "public"."issue_868_plan" ("id" integer, "label" text)',
  'CREATE INDEX "idx_issue_868_plan_label" ON "public"."issue_868_plan" USING btree ("label")',
].join(";\n");

function Harness({
  sql = PLAN_SQL,
  onCommit,
  onRefresh,
}: {
  sql?: string;
  onCommit: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const ddl = useDdlPreviewExecution({
    connectionId: "conn-1",
    onRefresh,
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void ddl.loadPreview(
            () => Promise.resolve({ sql }),
            () => onCommit,
          );
        }}
      >
        Load plan
      </button>
      <button
        type="button"
        onClick={() => {
          void ddl.attemptExecute();
        }}
      >
        Execute
      </button>
      <button
        type="button"
        onClick={() => {
          void ddl.confirmDangerous();
        }}
      >
        Confirm dangerous
      </button>
      <button type="button" onClick={ddl.cancelDangerous}>
        Cancel dangerous
      </button>
      <output aria-label="preview sql">{ddl.previewSql}</output>
      <output aria-label="pending confirm">
        {ddl.pendingConfirm?.reason ?? ""}
      </output>
      <output aria-label="preview error">{ddl.previewError ?? ""}</output>
    </div>
  );
}

describe("useDdlPreviewExecution — PostgreSQL structure DDL plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-1",
          name: "prod-pg",
          dbType: "postgres",
          host: "localhost",
          port: 5432,
          database: "app",
          username: "u",
          password: null,
          environment: "production",
        } as any,
      ],
    });
    useSafeModeStore.setState({ mode: "strict" });
    useHistorySettingsStore.setState({ queryHistoryEnabled: true });
    useQueryHistoryStore.setState({ recentVisible: [] });
  });

  it("keeps CREATE TABLE + CREATE INDEX behind explicit execute and records ddl-structure history", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Harness onCommit={onCommit} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: "Load plan" }));

    await waitFor(() => {
      expect(screen.getByLabelText("preview sql")).toHaveTextContent(
        "CREATE TABLE",
      );
      expect(screen.getByLabelText("preview sql")).toHaveTextContent(
        "CREATE INDEX",
      );
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(useQueryHistoryStore.getState().recentVisible).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("pending confirm")).toHaveTextContent("");
    expect(screen.getByLabelText("preview error")).toHaveTextContent("");

    const entries = useQueryHistoryStore.getState().recentVisible;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      connectionId: "conn-1",
      paradigm: "rdb",
      queryMode: "sql",
      source: "ddl-structure",
      status: "success",
    });
    expect(entries[0]?.sqlRedacted).toContain("CREATE TABLE");
    expect(entries[0]?.sqlRedacted).toContain("CREATE INDEX");
  });

  it("keeps destructive Structure DDL behind Safe Mode confirmation and preserves ddl-structure source", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness
        sql={'DROP INDEX "public"."idx_issue_868_plan_label"'}
        onCommit={onCommit}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load plan" }));
    await waitFor(() => {
      expect(screen.getByLabelText("preview sql")).toHaveTextContent(
        "DROP INDEX",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    await waitFor(() => {
      expect(screen.getByLabelText("pending confirm")).toHaveTextContent(
        "DROP INDEX",
      );
    });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel dangerous" }));
    expect(screen.getByLabelText("pending confirm")).toHaveTextContent("");
    expect(screen.getByLabelText("preview error")).toHaveTextContent(
      "Safe Mode (warn): confirmation cancelled",
    );
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    await waitFor(() => {
      expect(screen.getByLabelText("pending confirm")).toHaveTextContent(
        "DROP INDEX",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm dangerous" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("pending confirm")).toHaveTextContent("");
    expect(screen.getByLabelText("preview error")).toHaveTextContent("");

    const entries = useQueryHistoryStore.getState().recentVisible;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      connectionId: "conn-1",
      source: "ddl-structure",
      status: "success",
    });
    expect(entries[0]?.sqlRedacted).toContain("DROP INDEX");
  });

  it("[#1118] treats a `;` inside a string literal as one statement — no false Safe Mode block", async () => {
    // A naive `.split(";")` fragments this single CREATE into a bogus
    // `DROP TABLE x')` tail that the strict gate would block. The
    // literal-aware `splitSqlStatements` keeps it whole → info → commits.
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness
        sql={"CREATE TABLE t (label text DEFAULT 'a;DROP TABLE x')"}
        onCommit={onCommit}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load plan" }));
    await waitFor(() => {
      expect(screen.getByLabelText("preview sql")).toHaveTextContent(
        "CREATE TABLE",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("pending confirm")).toHaveTextContent("");
    expect(screen.getByLabelText("preview error")).toHaveTextContent("");
  });
});

// Issue #2581 — the hook already hands the connection dialect to the
// splitter, but `analyzeStatement` in the gate loop dropped it. On MySQL a
// `#` line comment hides the rest of the line from the server, so
// `DELETE FROM t # WHERE id=1` is a WHERE-less DELETE (danger → confirm).
// Without the dialect the commented-out WHERE kept the grade at warn →
// allow → the commit ran with no dialog at all.
describe("useDdlPreviewExecution — MySQL dialect reaches the classifier (#2581)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-1",
          name: "prod-mysql",
          dbType: "mysql",
          host: "localhost",
          port: 3306,
          database: "app",
          username: "u",
          password: null,
          environment: "production",
        } as any,
      ],
    });
    useSafeModeStore.setState({ mode: "strict" });
    useHistorySettingsStore.setState({ queryHistoryEnabled: true });
    useQueryHistoryStore.setState({ recentVisible: [] });
  });

  // Reason: PR #2575 NB1/NB2 — asserts the Safe Mode tier the production
  // wiring produces, not that a dialect argument was passed. The confirm
  // reason is the analyzer's bare danger copy, so its presence pins the
  // grade to danger. (2026-09-06)
  it("gates a #-commented DELETE behind Safe Mode confirmation instead of committing", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness
        sql="DELETE FROM t # WHERE id=1"
        onCommit={onCommit}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load plan" }));
    await waitFor(() => {
      expect(screen.getByLabelText("preview sql")).toHaveTextContent(
        "DELETE FROM t",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));

    await waitFor(() => {
      expect(screen.getByLabelText("pending confirm")).toHaveTextContent(
        "DELETE without WHERE",
      );
    });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
