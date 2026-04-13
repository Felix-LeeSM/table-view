import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

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
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-(--color-bg-primary) p-8">
          <h1 className="text-lg font-semibold text-(--color-text-primary)">
            Something went wrong
          </h1>
          <p className="max-w-md text-center text-sm text-(--color-text-secondary)">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            className="rounded bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            onClick={this.handleReload}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
