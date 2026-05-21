import { describe, expect, it } from "vitest";
import {
  completionCursorOffsets,
  completionReplaceRange,
  utf8ByteOffsetFromUtf16,
} from "./coreContract";

describe("completion core contract", () => {
  it("maps UTF-16 cursor offsets to UTF-8 byte offsets", () => {
    const text = "select '한😀'";

    expect(utf8ByteOffsetFromUtf16(text, 0)).toBe(0);
    expect(utf8ByteOffsetFromUtf16(text, "select '한".length)).toBe(11);
    expect(utf8ByteOffsetFromUtf16(text, "select '한😀".length)).toBe(15);
  });

  it("carries both offset forms in replace ranges", () => {
    const text = "select 한😀 from users";
    const from = "select ".length;
    const to = "select 한😀".length;

    expect(completionReplaceRange(text, from, to)).toEqual({
      from: { utf16: 7, utf8: 7 },
      to: { utf16: 10, utf8: 14 },
    });
  });

  it("rejects invalid cursor and range offsets", () => {
    expect(() => completionCursorOffsets("abc", -1)).toThrow(RangeError);
    expect(() => completionCursorOffsets("abc", 4)).toThrow(RangeError);
    expect(() => completionCursorOffsets("abc", 1.5)).toThrow(RangeError);
    expect(() => completionReplaceRange("abc", 2, 1)).toThrow(RangeError);
  });
});
