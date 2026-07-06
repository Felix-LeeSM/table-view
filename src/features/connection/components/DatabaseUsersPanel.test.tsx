// Issue #1077 Stage 2 — DatabaseUsersPanel guard. Read-only accounts/roles
// panel: (a) initial fetch + row render, (b) refresh re-fetch, (c) empty
// state, (d) error state, (e) it is read-only (no kill/edit/delete control).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DatabaseUsersPanel } from "./DatabaseUsersPanel";

const listDatabaseUsersMock = vi.fn();

vi.mock("@/lib/api/databaseUsers", () => ({
  listDatabaseUsers: (...args: unknown[]) => listDatabaseUsersMock(...args),
}));

const alice = {
  name: "alice",
  canLogin: true,
  isSuperuser: false,
  canCreateDb: false,
  canCreateRole: false,
  replication: false,
  connLimit: -1,
  validUntil: null,
  memberOf: ["readonly"],
};

describe("DatabaseUsersPanel (issue #1077 Stage 2)", () => {
  beforeEach(() => {
    listDatabaseUsersMock.mockReset();
  });

  it("renders the users/roles grid after a successful fetch", async () => {
    listDatabaseUsersMock.mockResolvedValueOnce([alice]);

    render(<DatabaseUsersPanel connectionId="conn-pg" dbType="postgresql" />);

    await waitFor(() => {
      expect(listDatabaseUsersMock).toHaveBeenCalledWith("conn-pg");
    });
    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("readonly")).toBeInTheDocument();
    // conn_limit -1 surfaces as an "unlimited" label, not the raw -1.
    expect(screen.getByText(/unlimited/i)).toBeInTheDocument();
  });

  it("renders the empty state when no users or roles exist", async () => {
    listDatabaseUsersMock.mockResolvedValueOnce([]);

    render(<DatabaseUsersPanel connectionId="conn-pg" dbType="postgresql" />);

    expect(await screen.findByTestId("database-users-empty")).toHaveTextContent(
      /no users or roles/i,
    );
  });

  it("re-fetches when Refresh is clicked", async () => {
    listDatabaseUsersMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<DatabaseUsersPanel connectionId="conn-pg" dbType="postgresql" />);
    await waitFor(() => {
      expect(listDatabaseUsersMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByTestId("database-users-refresh"));

    await waitFor(() => {
      expect(listDatabaseUsersMock).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces fetch errors via role=alert", async () => {
    listDatabaseUsersMock.mockRejectedValueOnce(new Error("permission denied"));

    render(<DatabaseUsersPanel connectionId="conn-pg" dbType="postgresql" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /permission denied/i,
    );
  });

  it("is read-only — exposes no mutation (kill/edit/delete) control", async () => {
    listDatabaseUsersMock.mockResolvedValueOnce([alice]);

    render(<DatabaseUsersPanel connectionId="conn-pg" dbType="postgresql" />);
    await screen.findByText("alice");

    const buttons = screen.getAllByRole("button");
    // Only the Refresh control is present; no destructive/mutation action.
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("data-testid", "database-users-refresh");
    for (const b of buttons) {
      expect(b.textContent ?? "").not.toMatch(/kill|delete|drop|edit|remove/i);
    }
  });
});
