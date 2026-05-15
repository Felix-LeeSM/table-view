// Sprint 323 (2026-05-15) — Slice G.1: BSON type-aware editor.
//
// 작성 이유: 4 BSON wrapper (ObjectId/ISODate/Decimal128/BinData) 의
// inline editor 가 (a) 초기값을 raw-string 으로 풀어 보이고 (b) 유효성
// 검증 후에만 onCommit 을 invoke 하며 (c) invalid input 시 hint
// message 를 노출하는지를 회귀 가드. wire-up 은 Sprint 324 (G.2)
// 가 진행.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BsonTypeEditor from "./BsonTypeEditor";

describe("BsonTypeEditor (Sprint 323 G.1)", () => {
  it("ObjectId — pre-fills input with hex string and commits as $oid wrapper", () => {
    const onCommit = vi.fn();
    render(
      <BsonTypeEditor
        type="objectId"
        initialValue={{ $oid: "65abcdef0123456789abcdef" }}
        onCommit={onCommit}
        onCancel={vi.fn()}
        ariaLabel="Edit meta.id"
      />,
    );
    const input = screen.getByLabelText("Edit meta.id");
    expect(input).toHaveValue("65abcdef0123456789abcdef");
    fireEvent.change(input, {
      target: { value: "1111111111111111aaaaaaaa" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      $oid: "1111111111111111aaaaaaaa",
    });
  });

  it("ISODate — pre-fills with ISO string and commits as $date wrapper", () => {
    const onCommit = vi.fn();
    render(
      <BsonTypeEditor
        type="date"
        initialValue={{ $date: "2026-05-15T12:00:00.000Z" }}
        onCommit={onCommit}
        onCancel={vi.fn()}
        ariaLabel="Edit createdAt"
      />,
    );
    const input = screen.getByLabelText("Edit createdAt");
    expect(input).toHaveValue("2026-05-15T12:00:00.000Z");
    fireEvent.change(input, {
      target: { value: "2026-06-01T00:00:00Z" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      $date: "2026-06-01T00:00:00.000Z",
    });
  });

  it("Decimal128 — pre-fills with numeric string and commits as $numberDecimal", () => {
    const onCommit = vi.fn();
    render(
      <BsonTypeEditor
        type="decimal128"
        initialValue={{ $numberDecimal: "0.1" }}
        onCommit={onCommit}
        onCancel={vi.fn()}
        ariaLabel="Edit price"
      />,
    );
    const input = screen.getByLabelText("Edit price");
    expect(input).toHaveValue("0.1");
    fireEvent.change(input, { target: { value: "99.99" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({ $numberDecimal: "99.99" });
  });

  it("BinData — pre-fills with base64 and commits as $binary with subType 00", () => {
    const onCommit = vi.fn();
    render(
      <BsonTypeEditor
        type="binData"
        initialValue={{ $binary: { base64: "AAAA", subType: "00" } }}
        onCommit={onCommit}
        onCancel={vi.fn()}
        ariaLabel="Edit blob"
      />,
    );
    const input = screen.getByLabelText("Edit blob");
    expect(input).toHaveValue("AAAA");
    fireEvent.change(input, { target: { value: "QUJDRA==" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      $binary: { base64: "QUJDRA==", subType: "00" },
    });
  });

  it("invalid input — surfaces hint and does NOT call onCommit", () => {
    const onCommit = vi.fn();
    render(
      <BsonTypeEditor
        type="objectId"
        initialValue={{ $oid: "65abcdef0123456789abcdef" }}
        onCommit={onCommit}
        onCancel={vi.fn()}
        ariaLabel="Edit meta.id"
      />,
    );
    const input = screen.getByLabelText("Edit meta.id");
    fireEvent.change(input, { target: { value: "too-short" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/24-hex/i);
  });

  it("Escape cancels — onCancel invoked, onCommit not invoked", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <BsonTypeEditor
        type="decimal128"
        initialValue={{ $numberDecimal: "0" }}
        onCommit={onCommit}
        onCancel={onCancel}
        ariaLabel="Edit price"
      />,
    );
    const input = screen.getByLabelText("Edit price");
    fireEvent.change(input, { target: { value: "12.5" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
