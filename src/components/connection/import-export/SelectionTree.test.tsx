import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SelectionTree from "./SelectionTree";
import type { ConnectionConfig, ConnectionGroup } from "@/types/connection";

function makeConn(id: string, groupId: string | null = null): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    database: "test",
    group_id: groupId,
    color: null,
    environment: null,
    has_password: false,
    paradigm: "rdb",
  };
}

function makeGroup(id: string, name: string): ConnectionGroup {
  return { id, name, color: null, collapsed: false };
}

interface HarnessProps {
  connections: ConnectionConfig[];
  groups: ConnectionGroup[];
  initial?: Set<string>;
}

function Harness({ connections, groups, initial }: HarnessProps) {
  const [selected, setSelected] = useState<Set<string>>(initial ?? new Set());
  return (
    <SelectionTree
      connections={connections}
      groups={groups}
      selected={selected}
      onChange={setSelected}
    />
  );
}

function getCheckbox(name: RegExp | string): HTMLInputElement {
  return screen.getByRole("checkbox", { name }) as HTMLInputElement;
}

describe("SelectionTree", () => {
  // --- Scenario 1: empty / no connections ---
  it("renders empty state when there are no connections", () => {
    render(<Harness connections={[]} groups={[]} />);
    expect(screen.getByText(/no connections to export/i)).toBeInTheDocument();
  });

  // --- Scenario 2: master select all ---
  it("scenario all-selected: master checkbox checks every connection", () => {
    const groups = [makeGroup("g1", "Prod"), makeGroup("g2", "Dev")];
    const connections = [
      makeConn("c1", "g1"),
      makeConn("c2", "g1"),
      makeConn("c3", "g2"),
    ];

    render(<Harness connections={connections} groups={groups} />);

    const master = getCheckbox(/select all \(3\)/i);
    expect(master.indeterminate).toBe(false);
    expect(master.checked).toBe(false);

    act(() => {
      fireEvent.click(master);
    });

    // After: all selected → master checked, no indeterminate; both groups checked
    const masterAfter = getCheckbox(/select all \(3\)/i);
    expect(masterAfter.checked).toBe(true);
    expect(masterAfter.indeterminate).toBe(false);

    expect(getCheckbox(/group prod/i).checked).toBe(true);
    expect(getCheckbox(/group dev/i).checked).toBe(true);

    expect(
      screen.getByText(/3 connections, 2 groups selected/i),
    ).toBeInTheDocument();
  });

  // --- Scenario 3: single group only ---
  it("scenario single-group: group header selects only its children", () => {
    const groups = [makeGroup("g1", "Prod"), makeGroup("g2", "Dev")];
    const connections = [
      makeConn("c1", "g1"),
      makeConn("c2", "g1"),
      makeConn("c3", "g2"),
    ];

    render(<Harness connections={connections} groups={groups} />);

    act(() => {
      fireEvent.click(getCheckbox(/group prod/i));
    });

    // Prod fully selected, Dev untouched
    expect(getCheckbox(/group prod/i).checked).toBe(true);
    expect(getCheckbox(/group prod/i).indeterminate).toBe(false);
    expect(getCheckbox(/group dev/i).checked).toBe(false);
    expect(getCheckbox(/group dev/i).indeterminate).toBe(false);

    // Master indeterminate (2/3)
    const master = getCheckbox(/select all \(3\)/i);
    expect(master.indeterminate).toBe(true);
    expect(master.checked).toBe(false);

    expect(
      screen.getByText(/2 connections, 1 group selected/i),
    ).toBeInTheDocument();
  });

  // --- Scenario 4: single connection only ---
  it("scenario single-conn: leaf checkbox toggles a single connection", () => {
    const groups = [makeGroup("g1", "Prod")];
    const connections = [makeConn("c1", "g1"), makeConn("c2", "g1")];

    render(<Harness connections={connections} groups={groups} />);

    act(() => {
      fireEvent.click(getCheckbox(/^c1 db$/i));
    });

    expect(getCheckbox(/^c1 db$/i).checked).toBe(true);
    expect(getCheckbox(/^c2 db$/i).checked).toBe(false);

    // Group goes indeterminate (1/2 selected)
    const groupBox = getCheckbox(/group prod/i);
    expect(groupBox.indeterminate).toBe(true);
    expect(groupBox.checked).toBe(false);

    expect(
      screen.getByText(/1 connection, 0 groups selected/i),
    ).toBeInTheDocument();
  });

  // --- Scenario 5: multi-conn cross-group ---
  it("scenario multi-conn: selecting connections from two groups indeterminates both groups", () => {
    const groups = [makeGroup("g1", "Prod"), makeGroup("g2", "Dev")];
    const connections = [
      makeConn("c1", "g1"),
      makeConn("c2", "g1"),
      makeConn("c3", "g2"),
      makeConn("c4", "g2"),
    ];

    render(<Harness connections={connections} groups={groups} />);

    act(() => {
      fireEvent.click(getCheckbox(/^c1 db$/i));
    });
    act(() => {
      fireEvent.click(getCheckbox(/^c3 db$/i));
    });

    expect(getCheckbox(/group prod/i).indeterminate).toBe(true);
    expect(getCheckbox(/group dev/i).indeterminate).toBe(true);

    // Master indeterminate (2/4)
    expect(getCheckbox(/select all \(4\)/i).indeterminate).toBe(true);
    expect(
      screen.getByText(/2 connections, 0 groups selected/i),
    ).toBeInTheDocument();
  });

  // --- Scenario 6: multi-group fully selected ---
  it("scenario multi-group: every child of two groups selected → both groups checked, master checked", () => {
    const groups = [makeGroup("g1", "Prod"), makeGroup("g2", "Dev")];
    const connections = [
      makeConn("c1", "g1"),
      makeConn("c2", "g1"),
      makeConn("c3", "g2"),
    ];

    render(
      <Harness
        connections={connections}
        groups={groups}
        initial={new Set(["c1", "c2", "c3"])}
      />,
    );

    expect(getCheckbox(/group prod/i).checked).toBe(true);
    expect(getCheckbox(/group prod/i).indeterminate).toBe(false);
    expect(getCheckbox(/group dev/i).checked).toBe(true);
    expect(getCheckbox(/group dev/i).indeterminate).toBe(false);

    expect(getCheckbox(/select all \(3\)/i).checked).toBe(true);
    expect(getCheckbox(/select all \(3\)/i).indeterminate).toBe(false);
    expect(
      screen.getByText(/3 connections, 2 groups selected/i),
    ).toBeInTheDocument();
  });

  // --- Scenario 7: partial group → indeterminate ---
  it("scenario partial-group: some children selected → group is indeterminate", () => {
    const groups = [makeGroup("g1", "Prod")];
    const connections = [
      makeConn("c1", "g1"),
      makeConn("c2", "g1"),
      makeConn("c3", "g1"),
    ];

    render(
      <Harness
        connections={connections}
        groups={groups}
        initial={new Set(["c1"])}
      />,
    );

    const groupBox = getCheckbox(/group prod/i);
    expect(groupBox.indeterminate).toBe(true);
    expect(groupBox.checked).toBe(false);

    // Clicking the indeterminate group header selects all children.
    act(() => {
      fireEvent.click(groupBox);
    });
    expect(getCheckbox(/group prod/i).checked).toBe(true);
    expect(getCheckbox(/group prod/i).indeterminate).toBe(false);
  });

  // --- Extra: ungrouped pseudo-group ---
  it("renders an ungrouped (No group) pseudo-group for connections without a group_id", () => {
    const groups = [makeGroup("g1", "Prod")];
    const connections = [makeConn("c1", "g1"), makeConn("c2", null)];

    render(<Harness connections={connections} groups={groups} />);

    expect(getCheckbox(/group \(no group\)/i)).toBeInTheDocument();
  });

  // --- Extra: unchecking via master after partial state ---
  it("unchecks all when master is clicked from indeterminate", () => {
    const groups = [makeGroup("g1", "Prod")];
    const connections = [makeConn("c1", "g1"), makeConn("c2", "g1")];

    render(
      <Harness
        connections={connections}
        groups={groups}
        initial={new Set(["c1"])}
      />,
    );

    const master = getCheckbox(/select all \(2\)/i);
    expect(master.indeterminate).toBe(true);

    // First click on indeterminate master should select all
    // (HTML semantics: indeterminate input fires onChange with checked=true)
    act(() => {
      fireEvent.click(master);
    });
    expect(getCheckbox(/select all \(2\)/i).checked).toBe(true);

    // Click again to clear all
    act(() => {
      fireEvent.click(getCheckbox(/select all \(2\)/i));
    });
    expect(getCheckbox(/select all \(2\)/i).checked).toBe(false);
    expect(getCheckbox(/select all \(2\)/i).indeterminate).toBe(false);
  });
});
