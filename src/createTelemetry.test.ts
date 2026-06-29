import { describe, it, expect, afterEach, vi } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import { TelemetryWeb } from "./index.web";

// Background adapter imports (DOM-dependent) are fire-and-forget in the ctor and
// rejected harmlessly under node; silence the resulting console noise.
afterEach(() => vi.restoreAllMocks());

describe("createTelemetry (web)", () => {
  it("returns the platform's class without runtime navigator sniffing", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const t = createTelemetry({ apiKey: "edge_abc", endpoint: "https://x/collector/telemetry" });
    expect(t).toBeInstanceOf(TelemetryWeb);
  });

  it("does not reference navigator.product (no runtime platform check)", () => {
    expect(createTelemetry.toString()).not.toContain("navigator");
  });

  it("rejects a missing or non-edge_ apiKey", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => createTelemetry({ endpoint: "https://x" } as any)).toThrow(/edge_/);
    expect(() => createTelemetry({ apiKey: "nope", endpoint: "https://x" })).toThrow(/edge_/);
  });
});
