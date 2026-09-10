import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #108 — the Context block frozen at its final 39-key shape (§3.3 / §3.4).
// Driven through the public API and asserted at the injected Sender, key by key,
// including which keys are **omitted** rather than null: on this wire absent means
// "the SDK had nothing", so presence-with-undefined is itself a defect.

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

function stubDom() {
  vi.stubGlobal("document", { title: "WebApp", visibilityState: "visible", addEventListener: () => {} });
  vi.stubGlobal("window", {
    location: { hostname: "app.example.com", pathname: "/" },
    innerWidth: 800, innerHeight: 600,
    addEventListener: () => {},
  });
  vi.stubGlobal("navigator", {
    userAgent: "UA", platform: "MacIntel", appVersion: "5.0 (Macintosh)",
    vendor: "Acme", onLine: true,
  });
  vi.stubGlobal("devicePixelRatio", 2);
  process.env.BUILD_NUMBER = "42";
}

/** §3.3's web column: every key that must be present, with nothing else beside it. */
const WEB_PRESENT = [
  "session.id", "session.start_time", "session.sequence", "session.sample_rate",
  "event.sequence",
  "sdk.platform", "sdk.version", "sdk.events_dropped", "sdk.hook_dropped", "sdk.hook_failed",
  "app.name", "app.version", "app.build_number", "app.package_name",
  "device.id", "device.platform", "device.platform_version", "device.model",
  "device.manufacturer", "device.brand",
  "device.screen_density", "device.screen_width_px", "device.screen_height_px",
  "device.orientation",
  "network.type", "network.is_connected",
  "view.id", "view.name",
];

/** The other eleven of the 39: present in §3.3, omitted on a clean anonymous web row. */
const WEB_OMITTED = [
  "user.id",                                       // anonymous (§3.2)
  "app.build_id",                                  // no buildId opt (§4.8)
  "device.id_ephemeral",                           // the Store worked (§3.2)
  "sdk.drop_reason",                               // nothing dropped (§3.7)
  "device.android_sdk", "device.android_release", "device.hardware", "device.product",
  "device.ios_system_name",                        // off-native
  "device.cpu_abi", "device.low_ram",              // §3.3's `N`
];

function build(opts: Record<string, any> = {}) {
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_ctx",
    endpoint: "https://x/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    batchSize: 50,
    flushIntervalMs: 0,
    captureConsole: false,
    store: memoryStore(),
    ...opts,
  });
  return { t, sent, attrs: (name: string) => sent.find((e) => e.eventName === name)!.attributes! };
}

describe("#108 the Context block — web", () => {
  beforeEach(() => { silenceConsole(); stubDom(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("carries exactly §3.3's web key set, and nothing else", async () => {
    const { t, attrs } = build();
    await t.log("custom_event");
    await t.flush();

    const keys = Object.keys(attrs("custom_event"));
    for (const k of WEB_PRESENT) expect(keys).toContain(k);
    for (const k of WEB_OMITTED) expect(keys).not.toContain(k);
    // Nothing beyond the contract's set except §6.3's Tier 2 annotation, which a
    // `custom_event` carries when a root is live. No stray key, no leftover camelCase.
    expect(keys.filter((k) => !WEB_PRESENT.includes(k)).sort())
      .toEqual(["rum.action.id", "trace.id", "trace.root_type"]);
    expect(WEB_PRESENT.length + WEB_OMITTED.length).toBe(39);
  });

  it("ships sdk.platform as react-native-web (§3.3 / §12's item 10)", async () => {
    const { t, attrs } = build();
    await t.log("custom_event");
    await t.flush();
    expect(attrs("custom_event")["sdk.platform"]).toBe("react-native-web");
  });

  it("populates the four viewport keys from the live window (§3.3 ✱)", async () => {
    const { t, attrs } = build();
    await t.log("custom_event");
    await t.flush();
    const a = attrs("custom_event");
    expect(a["device.screen_density"]).toBe(2);
    expect(a["device.screen_width_px"]).toBe(1600);
    expect(a["device.screen_height_px"]).toBe(1200);
    expect(a["device.orientation"]).toBe("landscape");
  });

  it("ships none of §3.4's deleted keys — the fingerprint, the phone's name, the six user fields", async () => {
    const { t, attrs } = build();
    await t.identify({ userId: "u1", name: "Ada", email: "ada@x.io", phone: "+254700000000" });
    await t.log("custom_event");
    await t.flush();

    const dead = [
      "device.fingerprint", "device.iosDeviceName",
      "user.fullName", "user.firstName", "user.lastName",
      "user.avatar", "user.createdAt", "user.updatedAt",
      // moved to user.profile.update in #107, and they must not come back here
      "user.name", "user.email", "user.phone",
    ];
    for (const k of dead) expect(Object.keys(attrs("custom_event"))).not.toContain(k);
    // the join key stays, and the profile event still carries the payload
    expect(attrs("custom_event")["user.id"]).toBe("u1");
    expect(attrs("user.profile.update")["user.email"]).toBe("ada@x.io");
  });

  it("lets caller data override app./device./network.* but never an identity key", async () => {
    const { t, attrs } = build();
    await t.log("custom_event", {
      "device.model": "spoof",
      "network.type": "spoof",
      "app.name": "spoof",
      "session.id": "forged",
      "view.id": "forged",
      "sdk.platform": "forged",
      "device.id": "forged",
    });
    await t.flush();

    const a = attrs("custom_event");
    expect(a["device.model"]).toBe("spoof");
    expect(a["network.type"]).toBe("spoof");
    expect(a["app.name"]).toBe("spoof");
    expect(a["session.id"]).not.toBe("forged");
    expect(a["view.id"]).not.toBe("forged");
    expect(a["sdk.platform"]).toBe("react-native-web");
    expect(a["device.id"]).not.toBe("forged");
  });

  it("carries a non-null view.id on every row — events and metrics alike", async () => {
    const { t, sent } = build();
    await t.log("custom_event");
    const inst = await (t as any).instancePromise;
    inst.logMetric("frame_render_time", 12);
    await t.flush();

    expect(sent.length).toBeGreaterThan(1);
    for (const e of sent) {
      expect(e.attributes!["view.id"]).toMatch(/^view_\d+_[0-9a-f]{16}$/);
      expect(typeof e.attributes!["view.name"]).toBe("string");
    }
  });
});
