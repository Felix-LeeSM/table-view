// Issue #2435 — the ring token for the sites that import it, and for no
// others. This is not the app's only `focus-visible` ring. Rings that predate
// it and never routed through here sit in `alert-dialog.tsx`, `tabs.tsx` and
// `toggle-group.tsx` in this directory, and in the theme pickers, the tree
// viewers and the connection rows outside it, among others. One of those,
// `features/connection/components/import-export/MasterPasswordField.tsx`,
// already paints this module's borderless shape — same width, same alpha — by
// hand. Reading this file as the app-wide source of truth means not looking at
// any of them.
//
// What it did unify: the four primitives #2435 named — `button.tsx`,
// `checkbox.tsx`, `input.tsx`, `select.tsx` — each carried its own copy of the
// upstream 3px string at 50% alpha, and the toast action and dismiss buttons
// carried a 2px copy of that same washed-out colour. Not every shadcn file in
// this directory was on that string: `alert-dialog.tsx`, `tabs.tsx` and
// `toggle-group.tsx` use an alpha-less `ring-ring`, and the rest set no
// `focus-visible` ring at all. One visual decision spread over that many
// copies still drifts a component at a time, and a constant nobody is obliged
// to import cannot stop the next `npx shadcn add` pasting the upstream string
// back in. `focusRing.test.ts` covers the half a constant cannot — it fails on
// either removed string reappearing in the files its sweep walks, which are
// the `.ts` and `.tsx` sources under `src/` that are neither `*.test.ts(x)`
// nor `*.d.ts`. Reappearance in a test file or in CSS is outside that walk.
//
// The owner's decision (#2435): the input focus ring is too thick. Width drops
// to 1px and alpha rises to 60% — the band paints less area, so its colour has
// to carry more of the signal. That the alpha bump really does buy contrast,
// in every palette `src/themes.css` ships rather than in the default one, is
// measured by `focusRing.test.ts` rather than argued here.

/**
 * Focus ring for the primitives #2435 named — `Input`, `SelectTrigger`,
 * `Checkbox` and `Button`. Its reach is exactly the files that import it;
 * other bordered controls in this app write their own focus ring and this
 * token does not reach them.
 *
 * Two layers, not one, wherever the control draws a border of its own —
 * `Input`, `SelectTrigger`, `Checkbox`, and the `outline` `Button` variant.
 * `border-ring` recolours that existing 1px border to the opaque ring token,
 * and `ring-1` paints a second 1px band just outside it, so focus changes a 2px
 * perimeter even though the ring utility is 1px. A `Button` variant with no
 * border of its own (`default`, `ghost`, …) gets only the outer band —
 * `border-ring` has no border-width to paint against — so it is the thinnest
 * indicator this token produces.
 */
export const FOCUS_RING =
  "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/60";

/**
 * Focus ring for the overlay buttons that import it — the toast action and
 * dismiss buttons in `toaster.tsx`, the dismiss button in
 * `KeyringFallbackToast.tsx` — which paint no border for `border-ring` to
 * recolour. Other borderless controls in this app are not routed here; the
 * `MasterPasswordField` toggle named in the header already paints this exact
 * pair of utilities without importing them.
 *
 * Same colour as {@link FOCUS_RING}, deliberately not the same width: with no
 * border the ring is the whole indicator, so taking these to 1px would halve an
 * indicator #2435 never called too heavy. The alpha half of that decision still
 * applies, and it costs no area.
 */
export const FOCUS_RING_BORDERLESS =
  "focus-visible:ring-2 focus-visible:ring-ring/60";
