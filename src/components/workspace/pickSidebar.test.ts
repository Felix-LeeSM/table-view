import { describe, it, expect } from "vitest";
import { pickSidebar } from "./pickSidebar";

describe("pickSidebar", () => {
  it("maps 'rdb' paradigm to the rdb sidebar kind", () => {
    expect(pickSidebar("rdb")).toBe("rdb");
  });

  it("maps 'document' paradigm to the document sidebar kind", () => {
    expect(pickSidebar("document")).toBe("document");
  });

  it("maps 'kv' paradigm to the kv placeholder kind", () => {
    expect(pickSidebar("kv")).toBe("kv");
  });

  it("maps 'search' paradigm to the search placeholder kind", () => {
    expect(pickSidebar("search")).toBe("search");
  });
});
