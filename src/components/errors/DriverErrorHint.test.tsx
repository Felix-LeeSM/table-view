import { classifyDriverError } from "@lib/errors/driverErrorHints";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DriverErrorHint } from "./DriverErrorHint";

// Purpose: locks that a classified hint renders with the errors-namespace
//          wording (summary + action) and that an unclassified (null) hint
//          renders nothing (issue #1056).
describe("DriverErrorHint", () => {
  // Reason: a classified hint resolves to the en errors wording and shows
  //         the user a summary + action.
  it("renders the summary title and action hint for a classified error", () => {
    render(
      <DriverErrorHint
        hint={classifyDriverError("connection refused (os error 61)")}
      />,
    );
    expect(
      screen.getByText("Can't reach the database server"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Check that the host and port are correct/i),
    ).toBeInTheDocument();
  });

  // Reason: a surface that already carries a label (search) hides the title
  //         and shows only the hint sentence.
  it("omits the title when showTitle is false", () => {
    render(
      <DriverErrorHint
        hint={classifyDriverError("Access denied for user 'app'@'%'")}
        showTitle={false}
      />,
    );
    expect(screen.queryByText("Authentication failed")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Verify the username and password/i),
    ).toBeInTheDocument();
  });

  // Reason: fail-open — an unclassified (null) hint renders no text at all.
  it("renders nothing when the hint is null", () => {
    const { container } = render(<DriverErrorHint hint={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
