export interface GridWaitDiagnosticState {
  visibleAlerts: string[];
  bodyText: string;
}

export function formatGridWaitDiagnostic({
  visibleAlerts,
  bodyText,
}: GridWaitDiagnosticState) {
  return `visible_alerts=${JSON.stringify(visibleAlerts)} body=${JSON.stringify(bodyText)}`;
}
