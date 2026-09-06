import { useConnectionStore } from "@stores/connectionStore";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/types/connection";
import ConnectionDialog from "./ConnectionDialog";

// #1366 — mock the toast lib boundary (P6: mock only at lib boundaries) so the
// dialog's real `useConnectionMutations` success path doesn't push into the
// process-wide `toastStore` singleton and leak a lingering toast into a
// sibling spec's assertion under parallel-suite load (#1270 flake class).
vi.mock("@lib/runtime/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Issue #2448 — the timeout input advertised max=600 while the backend honours
// the stored value only up to each driver's own ceiling — 300 for
// MSSQL/MongoDB/search, 30 elsewhere, duckdb ignores the field outright (the
// consts are named in `connectTimeoutMaxSecs`, ../../model.ts). A value above
// the ceiling was saved and then silently cut at dial time. The fix keeps the
// draft inside the adapter's ceiling at the doors that write it — typing,
// loading a stored connection, and a dbType switch — so the number on screen
// is the number a dial gets.
//
// The default-value set the dialog renders (10 display, 10 fallback,
// "10" placeholder) had no test at all either; reverting any member of it is
// red here.
//
// PostgreSQL is the representative 30-ceiling adapter, MSSQL/MongoDB the
// 300 ones.
// ---------------------------------------------------------------------------

function makeConnection(
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
    id: "conn-1",
    name: "My DB",
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: true,
    database: "mydb",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
    ...overrides,
  };
}

const mockAddConnection = vi.fn();
const mockUpdateConnection = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockAddConnection.mockResolvedValue(makeConnection());
  mockUpdateConnection.mockResolvedValue(undefined);
  useConnectionStore.setState({
    addConnection: mockAddConnection,
    updateConnection: mockUpdateConnection,
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
});

function renderDialog(connection?: ConnectionConfig) {
  return render(<ConnectionDialog connection={connection} onClose={vi.fn()} />);
}

/** Radix `TabsTrigger` selects on `mousedown`, not on `click`. */
async function openSegment(name: string) {
  await act(async () => {
    fireEvent.mouseDown(screen.getByRole("tab", { name }));
  });
}

async function type(label: string, value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

function timeoutValue(): string {
  return (
    screen.getByLabelText("Connection Timeout (seconds)") as HTMLInputElement
  ).value;
}

describe("ConnectionDialog connection timeout (#2448)", () => {
  it("[conn-timeout-ui] an unset timeout renders the backend default of 10, in value and placeholder", async () => {
    renderDialog();
    await openSegment("Advanced");

    expect(timeoutValue()).toBe("10");
    expect(
      screen.getByLabelText("Connection Timeout (seconds)"),
    ).toHaveAttribute("placeholder", "10");
  });

  it("[conn-timeout-ui] typing above the adapter ceiling stores the ceiling", async () => {
    renderDialog();
    await type("Name", "Capped");
    await type("Host", "db.example.com");
    await openSegment("Advanced");

    await type("Connection Timeout (seconds)", "600");

    // The field shows the value the dial will get — the old input accepted 600
    // and cut it to 30 with nothing on screen saying so.
    expect(timeoutValue()).toBe("30");
    expect(
      screen.getByLabelText("Connection Timeout (seconds)"),
    ).toHaveAttribute("max", "30");

    await press("Save");
    await waitFor(() => expect(mockAddConnection).toHaveBeenCalled());
    expect(mockAddConnection).toHaveBeenCalledWith(
      expect.objectContaining({ connectionTimeout: 30 }),
    );
  });

  it("[conn-timeout-ui] the advertised max follows the dialog's adapter", async () => {
    renderDialog(makeConnection({ dbType: "mssql" }));
    await openSegment("Advanced");

    expect(
      screen.getByLabelText("Connection Timeout (seconds)"),
    ).toHaveAttribute("max", "300");

    await type("Connection Timeout (seconds)", "600");
    expect(timeoutValue()).toBe("300");
  });

  it("[conn-timeout-ui] a stored value inside the ceiling is shown unchanged", async () => {
    renderDialog(makeConnection({ dbType: "mongodb", connectionTimeout: 300 }));
    await openSegment("Advanced");

    expect(timeoutValue()).toBe("300");
  });

  it("[conn-timeout-ui] editing shows the value the backend will dial, not the stored number", async () => {
    renderDialog(makeConnection({ connectionTimeout: 600 }));
    await openSegment("Advanced");

    expect(timeoutValue()).toBe("30");
  });

  it("[conn-timeout-ui] clearing the field falls back to the default", async () => {
    renderDialog();
    await openSegment("Advanced");

    await type("Connection Timeout (seconds)", "600");
    expect(timeoutValue()).toBe("30");

    await type("Connection Timeout (seconds)", "");
    expect(timeoutValue()).toBe("10");
  });

  it("[conn-timeout-ui] switching to a stricter adapter re-clamps the timeout", async () => {
    const user = userEvent.setup();
    // Port at the Mongo default, so the switch is silent — a custom port would
    // raise the Sprint 108 confirm modal and defer the swap.
    renderDialog(
      makeConnection({
        dbType: "mongodb",
        port: 27017,
        connectionTimeout: 300,
      }),
    );

    const trigger = screen.getByLabelText("Database Type");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "PostgreSQL" }));

    await openSegment("Advanced");
    expect(timeoutValue()).toBe("30");
  });
});
