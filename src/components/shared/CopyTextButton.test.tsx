// #2505 (2026-09-26) — `CopyTextButton` and `CopyableText` must agree on when
// there is nothing to copy. A whitespace-only value (a padded CHAR(n) cell, for
// one) used to split them: the button went disabled while the inline value
// stayed a tab stop that copied the blanks and still reported success.
//
// Both render in one tree and are reached with Tab, the way a keyboard user
// meets them. A disabled button and inert text both leave focus on <body>, so
// either side drifting from the shared judgment turns this red.

import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CopyableText, CopyTextButton } from "./CopyTextButton";

describe("copy affordances — nothing to copy (#2505)", () => {
  it("[copy-empty] a whitespace-only value is a tab stop in neither affordance", async () => {
    const user = userEvent.setup();
    render(
      <>
        <CopyTextButton text="   " ariaLabel="Copy value" />
        <CopyableText text="   " />
      </>,
    );

    await user.tab();
    expect(document.body).toHaveFocus();
  });
});
