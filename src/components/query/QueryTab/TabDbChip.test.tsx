// Sprint 329 (2026-05-15) — Slice DB-Scope.2: Mongo query tab inline DB
// chip. DataGrip-style — tab-local display + popover that points users at
// the sidebar entry-point for switching DBs. Actual mutation happens in
// Sprint 330 via the sidebar right-click "New query here" path.
//
// 작성 이유: chip 이 (a) database 텍스트를 노출하고 (b) 클릭 시 popover 가
// 진입점 문구를 가시화하는지 가드. tab.database 가 빈 문자열인 mongosh tab
// (초기화 중) 에서는 chip 자체가 렌더되지 않는지도 확인.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TabDbChip from "./TabDbChip";

describe("TabDbChip (Sprint 329)", () => {
  it("renders the database label as the chip text", () => {
    render(<TabDbChip database="analytics" />);
    expect(
      screen.getByRole("button", { name: /current database/i }),
    ).toHaveTextContent("analytics");
  });

  it("does not render when database is empty (tab still initializing)", () => {
    const { container } = render(<TabDbChip database="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a popover with the sidebar entry-point hint on click", () => {
    render(<TabDbChip database="analytics" />);
    fireEvent.click(screen.getByRole("button", { name: /current database/i }));
    expect(
      screen.getByText(/right-click a database in the sidebar/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/new query here/i)).toBeInTheDocument();
  });
});
