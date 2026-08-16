import { useConnectionStore } from "@stores/connectionStore";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock, tauriMock } from "@/test-utils/tauriMock";
import ConnectionDialog from "./ConnectionDialog";

// #1366 — mock the toast lib boundary so the dialog's real
// `useConnectionMutations` success path doesn't leak a toast into the
// process-wide `toastStore` singleton that a sibling spec then counts.
vi.mock("@lib/runtime/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Issue #2437 — Test Connection: the button is the result, and an incomplete
// form never reaches the backend.
//
// Every case here carries the `[conn-test]` token so the acceptance criterion
// can select them:
//
//   pnpm exec vitest run src/features/connection --reporter=verbose \
//     -t "\[conn-test\]"
//
// The IPC assertion deliberately does NOT stub `useConnectionStore
// .testConnection`. The real store method is a one-line delegate to
// `tauri.testConnection` (`src/features/connection/store.ts`), so leaving it
// real and asserting on the globally mocked `@lib/tauri` wrapper proves the
// claim at the IPC boundary itself rather than one layer above it.
// ---------------------------------------------------------------------------

/** A backend failure long enough that no button label could ever hold it. */
const LONG_FAILURE =
  'Error: connection to server at "db.internal.example.com" (10.42.7.13), ' +
  "port 5432 failed: FATAL: password authentication failed for user " +
  '"reporting_ro"; SSL SYSCALL error: EOF detected; check pg_hba.conf and ' +
  "whether the server is reachable from this network segment";

beforeEach(() => {
  vi.clearAllMocks();
  setupTauriMock({
    testConnection: vi.fn().mockResolvedValue("Connection successful"),
  });
  // Seed only the keys the store's setState subscriber reads (#1367). This
  // deliberately does not use `resetStore`: that wipes every key including the
  // real `testConnection` action, and the action is what carries the call to
  // the IPC wrapper this file asserts on.
  useConnectionStore.setState({ connections: [], activeStatuses: {} });
});

function renderDialog() {
  return render(<ConnectionDialog onClose={vi.fn()} />);
}

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function testButton() {
  return screen.getByRole("button", { name: "Test Connection" });
}

function detailsToggle() {
  return screen.getByRole("button", { name: "Test result details" });
}

function feedbackSlot() {
  return document.querySelector('[data-slot="test-feedback"]') as HTMLElement;
}

async function clickTest() {
  await act(async () => {
    fireEvent.click(testButton());
  });
}

/** Drive a failing test to the point where a result is on screen. */
async function runFailingTest(message = LONG_FAILURE) {
  tauriMock.testConnection.mockRejectedValue(new Error(message));
  renderDialog();
  setField("Name", "Reporting replica");
  await clickTest();
  await waitFor(() => {
    expect(detailsToggle()).toBeInTheDocument();
  });
}

describe("ConnectionDialog Test Connection (#2437)", () => {
  // -------------------------------------------------------------------
  // Empty form fails in place — no request leaves the dialog.
  // -------------------------------------------------------------------
  it("[conn-test] an empty form dispatches no IPC and says why", async () => {
    renderDialog();
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("");

    await clickTest();

    expect(tauriMock.testConnection).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
    // Same treatment a failed Save gives: flag the field and go to it.
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(name);
  });

  it("[conn-test] a whitespace-only Name dispatches no IPC", async () => {
    renderDialog();
    setField("Name", "   ");

    await clickTest();

    expect(tauriMock.testConnection).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
  });

  it("[conn-test] a SQLite draft with no file path dispatches no IPC", async () => {
    // The rule is the DBMS-aware one Save enforces, not a Name-only shortcut:
    // SQLite ignores Host and requires the file path in `database` instead.
    renderDialog();
    setField("Name", "Local file");
    fireEvent.click(screen.getByLabelText("Database Type"));
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "SQLite" }));
    });
    setField("Database File", "");

    await clickTest();

    expect(tauriMock.testConnection).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Database file is required",
    );
  });

  it("[conn-test] a complete form does reach the IPC", async () => {
    // Discriminating control for the three cases above: they must be red
    // because the guard fired, not because the button stopped working.
    renderDialog();
    setField("Name", "Reporting replica");

    await clickTest();

    await waitFor(() => {
      expect(tauriMock.testConnection).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------
  // The button is the result; the detail is opt-in.
  // -------------------------------------------------------------------
  it("[conn-test] an untested dialog reserves no visible result band", () => {
    renderDialog();
    // The slot stays mounted (sprint-92 identity contract) but costs no
    // layout. jsdom loads no Tailwind sheet, so the class is the only
    // available proxy for "takes no space".
    expect(feedbackSlot()).not.toBeNull();
    expect(feedbackSlot().className).toContain("sr-only");
    // Nothing to expand before a test has produced a message.
    expect(
      screen.queryByRole("button", { name: "Test result details" }),
    ).toBeNull();
  });

  it("[conn-test] the button carries failure, and success replaces it", async () => {
    await runFailingTest("nope");
    expect(testButton().className).toContain("text-destructive");

    tauriMock.testConnection.mockResolvedValue("Connection successful");
    await clickTest();

    await waitFor(() => {
      expect(testButton().className).toContain("text-success");
    });
    expect(testButton().className).not.toContain("text-destructive");
  });

  it("[conn-test] the details disclosure reveals the full failure reason", async () => {
    await runFailingTest();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(feedbackSlot().className).toContain("sr-only");

    await act(async () => {
      fireEvent.click(detailsToggle());
    });

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(feedbackSlot().className).not.toContain("sr-only");
    // The whole reason, not a truncation of it.
    expect(feedbackSlot().textContent).toContain(LONG_FAILURE);
  });

  it("[conn-test] a collapsed failure still announces itself to screen readers", async () => {
    await runFailingTest();

    // The `role="alert"` / `aria-live` contract did not move when the visible
    // band went away: the region is still mounted, still carries the alert
    // role, and still holds the message while collapsed. Dropping it or
    // swapping `sr-only` for `hidden` would take the message away from screen
    // reader users, which is the accessibility regression #2437 forbids.
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
    const alert = screen.getByRole("alert");
    expect(feedbackSlot().contains(alert)).toBe(true);
    expect(alert).toHaveTextContent(LONG_FAILURE);
    expect(feedbackSlot()).not.toHaveAttribute("hidden");
  });

  it("[conn-test] the revealed failure keeps the password masked", async () => {
    // ADR-0005 / AC-178-05: the new display path is the same node the
    // sanitiser already protected, so a backend echoing the connection string
    // must not surface the password once the disclosure is opened.
    const secret = "pass@123ZZ";
    tauriMock.testConnection.mockRejectedValue(
      new Error(
        `connection refused at postgres://user:${encodeURIComponent(secret)}@localhost/db`,
      ),
    );
    renderDialog();
    setField("Name", "Leak guard");
    setField("Password", secret);

    await clickTest();
    await waitFor(() => {
      expect(detailsToggle()).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(detailsToggle());
    });

    expect(feedbackSlot().textContent).toMatch(/connection refused/i);
    expect(document.body.textContent).not.toContain(secret);
    expect(document.body.textContent).not.toContain(encodeURIComponent(secret));
  });
});
