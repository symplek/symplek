import { Component, type ErrorInfo, type ReactNode } from "react";
import type { WeftErrorDetail } from "weft-core";

/**
 * Props for the AIErrorBoundary component.
 */
export interface AIErrorBoundaryProps {
  /**
   * The content to be wrapped by the error boundary.
   */
  children: ReactNode;
  /**
   * Custom fallback UI to show when an error occurs.
   * Can be a ReactNode or a function that receives the error and a reset function.
   */
  fallback?:
    | ReactNode
    | ((props: { error: Error; reset: () => void }) => ReactNode);
  /**
   * Callback fired when an error is caught.
   */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /**
   * Callback fired when the error boundary is reset.
   */
  onReset?: () => void;
}

interface AIErrorBoundaryState {
  error: Error | null;
}

/**
 * A specialized Error Boundary for Weft components.
 * Catches errors in the component tree, including those from AI hooks,
 * and provides specialized handling for WeftError.
 */
export class AIErrorBoundary extends Component<
  AIErrorBoundaryProps,
  AIErrorBoundaryState
> {
  constructor(props: AIErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): AIErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo);
  }

  /**
   * Resets the error state, allowing the component tree to re-render.
   */
  reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      if (typeof fallback === "function") {
        return fallback({ error, reset: this.reset });
      }
      if (fallback) {
        return fallback;
      }

      // Default Fallback UI - Designed to be clean and informative
      return (
        <div
          style={{
            padding: "1.5rem",
            border: "1px solid #ef4444",
            borderRadius: "0.5rem",
            backgroundColor: "#fef2f2",
            color: "#991b1b",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
          role="alert"
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5rem",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="currentColor"
              style={{ marginRight: "0.5rem" }}
              aria-hidden="true"
            >
              <title>Error Icon</title>
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>
              AI Component Error
            </h3>
          </div>

          <p
            style={{
              margin: "0 0 1rem 0",
              fontSize: "0.875rem",
              lineHeight: "1.25rem",
            }}
          >
            {error.message}
          </p>

          {"WeftError" in error && (
            <div
              style={{
                marginTop: "1rem",
                padding: "0.75rem",
                backgroundColor: "#fee2e2",
                borderRadius: "0.375rem",
                fontSize: "0.8125rem",
                borderLeft: "4px solid #f87171",
              }}
            >
              <p
                style={{
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.025em",
                  fontSize: "0.75rem",
                }}
              >
                Suggested Action
              </p>
              <p style={{ margin: 0 }}>
                {(error as Error & { WeftError: WeftErrorDetail }).WeftError
                  ?.fix?.description ?? "Please try again."}
              </p>
            </div>
          )}

          <div style={{ marginTop: "1.5rem" }}>
            <button
              onClick={this.reset}
              type="button"
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "#991b1b",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: 500,
                transition: "background-color 0.2s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = "#7f1d1d";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = "#991b1b";
              }}
              onFocus={(e) => {
                e.currentTarget.style.backgroundColor = "#7f1d1d";
              }}
              onBlur={(e) => {
                e.currentTarget.style.backgroundColor = "#991b1b";
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}
