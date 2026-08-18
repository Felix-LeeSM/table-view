// Issue #2435 — the single source of truth for the `focus-visible` ring.
//
// Every shadcn primitive in this directory shipped with its own copy of the
// upstream 3px ring at 50% alpha, and the hand-written overlay buttons carried
// a 2px copy of that same washed-out colour. One visual decision spread over
// that many copies drifts a component at a time, and the next `npx shadcn add`
// lands another copy because upstream still ships the 3px string.
// `focusRing.test.ts` fails on any of those strings reappearing under `src/`,
// which is the half a shared constant cannot enforce on its own.
//
// The owner's decision (#2435): the ring is too heavy at 3px and too faint at
// 50%. Width drops to 1px and alpha rises to 60% — the band paints less area,
// so its colour has to carry more of the signal. That the alpha bump really
// does buy contrast, in every palette `src/themes.css` ships rather than in the
// default one, is measured by `focusRing.test.ts` rather than argued here.

/**
 * Focus ring for a control that draws its own border — `Input`, `SelectTrigger`,
 * `Checkbox`, and the `outline` `Button` variant.
 *
 * Two layers, not one. `border-ring` recolours the control's existing 1px
 * border to the opaque ring token, and `ring-1` paints a second 1px band just
 * outside it, so focus changes a 2px perimeter even though the ring utility is
 * 1px. A `Button` variant with no border of its own (`default`, `ghost`, …)
 * gets only the outer band — `border-ring` has no border-width to paint
 * against — so it is the thinnest indicator this token produces.
 */
export const FOCUS_RING =
  "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/60";

/**
 * Focus ring for a borderless overlay control — the toast action and dismiss
 * buttons, which paint no border for `border-ring` to recolour.
 *
 * Same colour as {@link FOCUS_RING}, deliberately not the same width: with no
 * border the ring is the whole indicator, so taking these to 1px would halve an
 * indicator #2435 never called too heavy. The alpha half of that decision still
 * applies, and it costs no area.
 */
export const FOCUS_RING_BORDERLESS =
  "focus-visible:ring-2 focus-visible:ring-ring/60";
