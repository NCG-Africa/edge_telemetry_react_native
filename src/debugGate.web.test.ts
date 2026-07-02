import { describe, it, expect, vi, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";

// #23 Workstream E: the SDK must not spam the host app's console. With debug off (the
// default), driving the public API produces zero console output; with debug on, it talks.
afterEach(() => vi.restoreAllMocks());

function spyConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

describe("debug gate — public API (web)", () => {
  it("is silent by default across construct → log → flush", async () => {
    const c = spyConsole();
    const sender = { send: async (_e: TelemetryEvent[]) => {} };

    const t = createTelemetry({
      apiKey: "edge_test",
      endpoint: "https://x/collector/telemetry",
      sender,
      batchSize: 10,
      flushIntervalMs: 0,
    });
    await t.log("navigation", { "navigation.to_screen": "Home" });
    await t.flush();

    expect(c.log).not.toHaveBeenCalled();
    expect(c.warn).not.toHaveBeenCalled();
    expect(c.error).not.toHaveBeenCalled();
  });

  it("emits diagnostics when debug:true", async () => {
    const c = spyConsole();
    const sender = { send: async (_e: TelemetryEvent[]) => {} };

    const t = createTelemetry({
      apiKey: "edge_test",
      endpoint: "https://x/collector/telemetry",
      sender,
      batchSize: 10,
      flushIntervalMs: 0,
      debug: true,
    });
    await t.log("navigation", { "navigation.to_screen": "Home" });
    await t.flush();

    expect(c.log).toHaveBeenCalled();
  });
});
