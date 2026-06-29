import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { Button } from "@components/ui/button";
import { logger } from "@lib/logger";
import i18n from "@lib/i18n";

interface ErrorBoundaryProps {
  children: ReactNode;
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
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background p-8">
          <h1 className="text-lg font-semibold text-foreground">
            {i18n.t("shared:errorTitle")}
          </h1>
          <p className="max-w-md text-center text-sm text-secondary-foreground">
            {this.state.error?.message ?? i18n.t("shared:errorFallback")}
          </p>
          <Button onClick={this.handleReload}>{i18n.t("shared:reload")}</Button>
        </div>
      );
    }

    return this.props.children;
  }
}
