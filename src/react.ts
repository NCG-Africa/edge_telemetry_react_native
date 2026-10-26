// The React module (#166, decision #144) — on the main entry, no subpath, no Provider, no
// context: the telemetry instance is a prop. `createElement`, not JSX, so the build emits no
// `react/jsx-runtime` import for the externalization list to miss.

import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { debug } from "./core/debug";
import { markBoundaryCaught } from "./adapters/crashCapture";

type BoundaryTelemetry = { captureBoundaryError(error: unknown, componentStack?: string | null): Promise<unknown> };

export type EdgeErrorBoundaryProps = {
    telemetry: BoundaryTelemetry;
    children?: ReactNode;
    /** Rendered in place of the failed subtree: a node, or a render function given the error and a reset. */
    fallback?: ReactNode | ((props: { error: unknown; resetError: () => void }) => ReactNode);
    /** Runs after the SDK's emit. A throw here is swallowed — your handler cannot break the boundary. */
    onError?: (error: unknown, info: ErrorInfo) => void;
};

/**
 * Reports a caught render error as `app.error`, `error.source: boundary` — **never**
 * `app.crash`: the boundary handled it — exactly once. The error is marked in
 * `getDerivedStateFromError`, before React's own reporting, so `captureConsole` and the
 * global handlers skip it.
 */
export class EdgeErrorBoundary extends Component<EdgeErrorBoundaryProps, { error?: unknown; failed: boolean }> {
    state = { error: undefined as unknown, failed: false };

    static getDerivedStateFromError(error: unknown) {
        markBoundaryCaught(error);
        return { error, failed: true };
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        this.props.telemetry.captureBoundaryError(error, info?.componentStack)
            .catch((err) => debug.warn("EdgeErrorBoundary: report failed:", err));
        try {
            this.props.onError?.(error, info);
        } catch (err) {
            debug.warn("EdgeErrorBoundary: onError threw:", err);
        }
    }

    resetError = () => this.setState({ error: undefined, failed: false });

    render() {
        if (!this.state.failed) return this.props.children ?? null;
        const { fallback } = this.props;
        return typeof fallback === "function"
            ? (fallback as (p: { error: unknown; resetError: () => void }) => ReactNode)({ error: this.state.error, resetError: this.resetError })
            : fallback ?? null;
    }
}


/**
 * Marks the current screen ready (#171) once `ready` is truthy — `useScreenReady(telemetry,
 * !loading)`. First mark per view wins, so re-renders and a `ready` that flips back are harmless.
 */
export function useScreenReady(telemetry: { markScreenReady(): void }, ready: unknown = true): void {
    useEffect(() => {
        if (ready) telemetry.markScreenReady();
    }, [telemetry, ready]);
}
