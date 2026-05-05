// Stable re-export of the canonical `ConfirmDialog` preset. Implementation
// lives at `src/components/ui/dialog/ConfirmDialog.tsx` with the other
// Layer-2 wrappers; this path is kept so existing callers and tests don't
// need an immediate import sweep. New code should import from
// `@components/ui/dialog/ConfirmDialog` directly.

export { default } from "@components/ui/dialog/ConfirmDialog";
export type { ConfirmDialogProps } from "@components/ui/dialog/ConfirmDialog";
