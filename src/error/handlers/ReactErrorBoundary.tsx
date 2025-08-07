import React, { Component, ErrorInfo, ReactNode } from 'react';
import type { ErrorEvent, ErrorSource, ErrorHandling, ErrorSeverity } from '../types/ErrorTypes';

/**
 * Props for ReactErrorBoundary component
 */
interface ReactErrorBoundaryProps {
  children: ReactNode;
  onError?: (event: ErrorEvent) => void;
  fallback?: ReactNode | ((error: Error, errorInfo: ErrorInfo) => ReactNode);
  debugMode?: boolean;
}

/**
 * State for ReactErrorBoundary component
 */
interface ReactErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

/**
 * ReactErrorBoundary - React component for catching component-level errors
 * Provides identical functionality to Flutter's error boundary handling
 */
export class ReactErrorBoundary extends Component<ReactErrorBoundaryProps, ReactErrorBoundaryState> {
  constructor(props: ReactErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  /**
   * Static method called when an error occurs during rendering
   */
  static getDerivedStateFromError(error: Error): ReactErrorBoundaryState {
    // Update state to trigger fallback UI
    return {
      hasError: true,
      error: error
    };
  }

  /**
   * Called when an error occurs during rendering, in lifecycle methods, or constructors
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    try {
      // Update state with error info
      this.setState({
        error: error,
        errorInfo: errorInfo
      });

      // Create error event matching Flutter format
      const errorEvent: ErrorEvent = {
        type: 'react_component' as ErrorSource,
        message: error.message || 'React component error',
        timestamp: Date.now(),
        hasStackTrace: !!error.stack,
        stackTrace: error.stack,
        handling: 'handled' as ErrorHandling, // React Error Boundaries handle the error
        severity: 'non_fatal' as ErrorSeverity, // Component errors are typically non-fatal
        errorClass: error.name || error.constructor?.name || 'ReactError',
        context: {
          'error.source': 'react_error_boundary',
          'error.component_stack': errorInfo.componentStack,
          'error.error_boundary': this.constructor.name
        }
      };

      // Call error handler if provided
      if (this.props.onError) {
        this.props.onError(errorEvent);
      }

      if (this.props.debugMode) {
        console.log('ReactErrorBoundary: Captured React component error:', errorEvent);
        console.error('React Error Boundary caught an error:', error, errorInfo);
      }
    } catch (handlerError) {
      if (this.props.debugMode) {
        console.error('ReactErrorBoundary: Error in error boundary handler:', handlerError);
      }
    }
  }

  /**
   * Reset error boundary state
   */
  resetError = (): void => {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined
    });
  };

  /**
   * Render method
   */
  render(): ReactNode {
    if (this.state.hasError) {
      // Render fallback UI
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'function') {
          return this.props.fallback(this.state.error!, this.state.errorInfo!);
        }
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div style={{ 
          padding: 20, 
          border: '1px solid #ff6b6b', 
          borderRadius: 4, 
          backgroundColor: '#ffe0e0',
          color: '#d63031'
        }}>
          <h3>Something went wrong</h3>
          <p>An error occurred in this component. Please try again.</p>
          <button 
            onClick={this.resetError}
            style={{
              padding: '8px 16px',
              backgroundColor: '#d63031',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer'
            }}
          >
            Try Again
          </button>
          {this.props.debugMode && this.state.error && (
            <details style={{ marginTop: 10 }}>
              <summary>Error Details</summary>
              <pre style={{ 
                fontSize: 12, 
                backgroundColor: '#f8f8f8', 
                padding: 10, 
                overflow: 'auto',
                maxHeight: 200
              }}>
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook version of ReactErrorBoundary for functional components
 */
export const useErrorBoundary = () => {
  const [error, setError] = React.useState<Error | null>(null);

  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  const captureError = React.useCallback((error: Error) => {
    setError(error);
  }, []);

  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return {
    captureError,
    resetError
  };
};

/**
 * Higher-order component version of ReactErrorBoundary
 */
export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ReactErrorBoundaryProps, 'children'>
) => {
  const WrappedComponent = (props: P) => (
    <ReactErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ReactErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
};
