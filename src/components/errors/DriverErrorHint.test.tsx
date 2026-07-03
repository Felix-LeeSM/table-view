import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { DriverErrorHint } from "./DriverErrorHint";
import { classifyDriverError } from "@lib/errors/driverErrorHints";

// Purpose: 분류된 힌트가 errors namespace 문구(요약 + 행동)로 렌더되고, 미분류
//          (null)이면 아무것도 렌더하지 않음을 잠근다 (issue #1056)
//          — Phase 22 milestone 22.30 (2026-07-03).
describe("DriverErrorHint", () => {
  // Reason: 분류된 힌트는 en errors 문구로 해석돼 사용자에게 요약+행동을 보인다 (2026-07-03).
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

  // Reason: label 을 이미 가진 표면(search)은 title 을 숨기고 힌트 문장만 보인다 (2026-07-03).
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

  // Reason: fail-open — 미분류(null)면 어떤 텍스트도 렌더하지 않는다 (2026-07-03).
  it("renders nothing when the hint is null", () => {
    const { container } = render(<DriverErrorHint hint={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
