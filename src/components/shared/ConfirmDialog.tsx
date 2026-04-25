// Sprint-96 Layer 2 — re-export of the canonical `ConfirmDialog` preset.
//
// The implementation moved to `src/components/ui/dialog/ConfirmDialog.tsx`
// alongside the other Layer-2 wrappers (`FormDialog`, `PreviewDialog`,
// `TabsDialog`). This file is preserved as a stable import path so existing
// callers (`QueryLog`, `GlobalQueryLogPanel`, etc.) and tests
// (`@components/shared/ConfirmDialog`) keep working without an immediate
// import sweep.
//
// New code should import from `@components/ui/dialog/ConfirmDialog` directly.

export { default } from "@components/ui/dialog/ConfirmDialog";
export type { ConfirmDialogProps } from "@components/ui/dialog/ConfirmDialog";
