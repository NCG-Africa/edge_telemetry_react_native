import { describe, it, expect, afterEach, vi } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import { TelemetryWeb } from "./telemetryWeb.web";

// Background adapter imports (DOM-dependent) are fire-and-forget in the ctor and
// rejected harmlessly under node; silence the resulting console noise.
afterEach(() => vi.restoreAllMocks());

describe("createTelemetry (web)", () => {
  it("returns the platform's class without runtime navigator sniffing", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const t = createTelemetry({ apiKey: "edge_abc", endpoint: "https://x/telemetry" });
    expect(t).toBeInstanceOf(TelemetryWeb);
  });

  it("does not reference navigator.product (no runtime platform check)", () => {
    expect(createTelemetry.toString()).not.toContain("navigator");
  });

  it("accepts a JWT-shaped credential — assertApiKey must not tighten to a segment count (#90)", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // `edge_<jwt>` has fewer than three `_`-parts; the collector's API-key check would
    // reject it, and adopting that check here would make the segmented deployment unreachable.
    const t = createTelemetry({
      apiKey: "edge_eyJhbGciOiJSUzI1NiJ9.eyJ0ZW5hbnRfaWQiOiJ0MSJ9.sig",
      endpoint: "https://x/telemetry",
    });
    expect(t).toBeInstanceOf(TelemetryWeb);
  });

  it("rejects a missing or non-edge_ apiKey", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => createTelemetry({ endpoint: "https://x" } as any)).toThrow(/edge_/);
    expect(() => createTelemetry({ apiKey: "nope", endpoint: "https://x" })).toThrow(/edge_/);
  });
});

describe("construction goes through createTelemetry() only (#159)", () => {
  it("neither public entry exports a constructible class", async () => {
    const web = await import("./index.web");
    const native = await import("./index.native");
    expect("TelemetryWeb" in web).toBe(false);
    expect("TelemetryNative" in native).toBe(false);
    expect(typeof web.createTelemetry).toBe("function");
    expect(typeof native.createTelemetry).toBe("function");
  });

  it("the class is still nameable as a type", () => {
    // Type-level: compiles only while the entry exports the class type.
    const asType = (t: import("./index.web").TelemetryWeb) => t.flush;
    expect(typeof asType).toBe("function");
  });
});

// Never called: `tsc` is what runs this. `export type` makes the class unusable as a value.
export const _noDirectConstruction = (entry: typeof import("./index.web")) =>
  // @ts-expect-error — the class is a type-only export from the public entry (#159)
  new entry.TelemetryWeb();
