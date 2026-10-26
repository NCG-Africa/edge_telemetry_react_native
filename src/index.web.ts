// Public web entry. The class is exported as a **type only** (#159): `createTelemetry()` is
// the one construction path, so `apiKey` and `traceHostAllowlist` validation cannot be bypassed.
export { createTelemetry, type TelemetryOpts } from "./createTelemetry.web";
export type { TelemetryWeb } from "./telemetryWeb.web";

// The Store port (#89) — public so a consumer can inject their own persistence,
// and so the in-memory fake is available outside the test tree.
export type { Store, SyncStore, AsyncStore, StoreRead, StoreWrite } from "./core/store";
export { memoryStore, type MemoryStoreOpts } from "./core/memoryStore";

// The scrubbing hook (#93) — public so a consumer can type their beforeSend.
export type { BeforeSend } from "./core/beforeSend";
export type { SpanHandle } from "./index.base";
export type { TaskOutcome } from "./adapters/manualSpans";

// The React module (#166) — on the main entry, no subpath.
export { EdgeErrorBoundary, useScreenReady, type EdgeErrorBoundaryProps } from "./react";
