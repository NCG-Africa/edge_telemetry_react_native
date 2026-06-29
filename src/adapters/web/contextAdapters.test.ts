import { describe, it, expect, vi } from "vitest";
import { NetworkInfoTrackerWeb } from "./networkInfo.web";
import { DeviceInfoTrackerWeb } from "./deviceInfo.web";

// ADR-0002: device/network data is context on every event, not its own event.
// start() registers the handler; it must NOT emit a standalone device_info/network_info event.
describe("web context adapters — no standalone events (ADR-0002)", () => {
  it("NetworkInfoTrackerWeb.start() does not emit a network_info event", async () => {
    const tracker = new NetworkInfoTrackerWeb();
    vi.spyOn(tracker, "collect").mockResolvedValue({ type: "wifi" } as any);

    const logged: string[] = [];
    await tracker.start({ log: (n: string) => { logged.push(n); } } as any);

    expect(logged).not.toContain("network_info");
  });

  it("DeviceInfoTrackerWeb.start() does not emit a device_info event", async () => {
    const tracker = new DeviceInfoTrackerWeb();
    vi.spyOn(tracker, "collect").mockResolvedValue({
      app: { name: "a", version: "1" },
      device: { id: "d", platform: "web" },
    } as any);

    const logged: string[] = [];
    await tracker.start({ log: (n: string) => { logged.push(n); } } as any);

    expect(logged).not.toContain("device_info");
  });
});
