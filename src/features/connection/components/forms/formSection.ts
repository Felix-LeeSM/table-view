/**
 * Issue #2436 — the segments of the connection dialog's form mode.
 * `ConnectionDialogBody` renders one at a time and hands each DBMS form
 * component the segment being rendered, so a component emits only its share.
 *
 * Which segment a given control renders in is decided in the JSX and is not
 * restated here — a restatement is a second copy, and it drifts. The
 * `TabsContent` panels in `ConnectionDialog/ConnectionDialogBody.tsx` and each
 * form component's own `section` branch are the description.
 *
 * The recovery path the split has to keep working — reaching the field the last
 * failed save flagged — is stated and compile-time enforced next to
 * `segmentForField` in `ConnectionDialogBody`.
 */
export type ConnFormSection = "basic" | "advanced" | "security";
