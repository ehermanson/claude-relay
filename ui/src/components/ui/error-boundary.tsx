import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Compact inline fallback — no heading, just a single line with an icon. */
  inline?: boolean;
  /** Override the default fallback UI. */
  fallback?: ReactNode;
  /** Section name shown in the fallback (e.g. "Input area"). */
  name?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Generic React error boundary.
 *
 * Catches render errors in its subtree and displays a lightweight fallback
 * so the rest of the page continues working.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ""}]`, error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const message = this.state.error.message;
    const name = this.props.name;

    if (this.props.inline) {
      return (
        <div className="flex items-center gap-2 px-4 py-4 text-[0.8125rem] text-muted">
          <AlertTriangle size={14} className="shrink-0 text-warning" />
          <span>
            {name ? `${name} failed to render` : "Something went wrong"}
            {message ? ` — ${message}` : ""}
          </span>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-muted">
        <AlertTriangle size={20} className="text-warning" />
        <p className="text-[0.875rem] font-medium text-text">
          {name ? `${name} failed to render` : "Something went wrong"}
        </p>
        {message ? <p className="max-w-md text-[0.8125rem]">{message}</p> : null}
      </div>
    );
  }
}
