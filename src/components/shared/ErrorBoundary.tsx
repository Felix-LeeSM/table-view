import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { Button } from "@components/ui/button";
import { logger } from "@lib/logger";
import i18n from "@lib/i18n";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * `screen` (default) fills the viewport — used at the App/router root so a
   * total render failure gets a full-page fallback. `panel` fills only its
   * container so one crashed panel (sidebar, grid, query result, detail)
   * degrades in place while the rest of the workspace keeps working (#1312).
   */
  variant?: "screen" | "panel";
  /** Optional panel name shown in the `panel` fallback heading. */
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = this.state.error?.message ?? i18n.t("shared:errorFallback");

    if (this.props.variant === "panel") {
      return (
        <div
          role="alert"
          className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background p-6"
        >
          <h2 className="text-sm font-semibold text-foreground">
            {this.props.label ?? i18n.t("shared:errorTitle")}
          </h2>
          <p className="max-w-md text-center text-xs text-secondary-foreground">
            {message}
          </p>
          <Button size="sm" onClick={this.handleReload}>
            {i18n.t("shared:retry")}
          </Button>
        </div>
      );
    }

    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background p-8">
        <h1 className="text-lg font-semibold text-foreground">
          {i18n.t("shared:errorTitle")}
        </h1>
        <p className="max-w-md text-center text-sm text-secondary-foreground">
          {message}
        </p>
        <Button onClick={this.handleReload}>{i18n.t("shared:reload")}</Button>
      </div>
    );
  }
}
