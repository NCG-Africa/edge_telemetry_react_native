import { describe, it, expect, vi, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";

// #100 / §4.7 — the error surface, asserted where the contract lives: the TelemetryEvent[]
// that reaches the injected Sender. Names, keys, values and **absence**, since this
// contract's null discipline is "absent means the SDK had nothing".
afterEach(() => vi.restoreAllMocks());

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

function harness() {
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_k", endpoint: "https://x/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    batchSize: 500, flushIntervalMs: 0,
  });
  return { t, sent };
}

const attrsOf = (sent: TelemetryEvent[], name: string) =>
  sent.find((e) => e.eventName === name)!.attributes!;

/** Let the ctor's fire-and-forget trackErrors() finish its dynamic import and attach. */
async function settle(t: any) {
  await (t as any).instancePromise;
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("captureError — the one public error path (§4.7)", () => {
  it("accepts an Error, a string and a plain object, and emits app.error every time", async () => {
    silenceConsole();
    const { t, sent } = harness();

    class a extends Error { name = "PaymentError"; }   // minified binding, stable name literal
    await t.captureError(new a("declined"));
    await t.captureError("just a string");
    await t.captureError({ status: 500 });
    await t.flush();

    const errors = sent.filter((e) => e.eventName === "app.error");
    expect(errors).toHaveLength(3);
    expect(sent.some((e) => e.eventName === "app.crash")).toBe(false);
    expect(errors.every((e) => e.attributes!["error.source"] === "reported")).toBe(true);

    // error.type from error.name only — constructor.name is "a" in a minified bundle.
    expect(errors[0].attributes!["error.type"]).toBe("PaymentError");
    expect(errors[0].attributes!["error.message"]).toBe("declined");
    expect(errors[1].attributes!["error.message"]).toBe("just a string");
    // A plain object has neither name nor message: honest defaults, and no wire null.
    expect(errors[2].attributes!["error.type"]).toBe("Error");
    expect("error.message" in errors[2].attributes!).toBe(false);
  });

  it("carries the caller's context, but the SDK's own error.* keys win a collision", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.captureError(new Error("real"), { "checkout.step": "pay", "error.source": "forged" });
    await t.flush();

    const a = attrsOf(sent, "app.error");
    expect(a["checkout.step"]).toBe("pay");
    expect(a["error.source"]).toBe("reported");
  });

  it("omits error.fatal on web — nothing here is fatal, the page keeps running", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.captureError(new Error("boom"));
    await t.flush();

    expect("error.fatal" in attrsOf(sent, "app.error")).toBe(false);
  });

  it("carries no breadcrumbs, no fingerprint and none of the retired crash.* keys", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.log("navigation");
    await t.captureError(new Error("boom"));
    await t.flush();

    const a = attrsOf(sent, "app.error");
    // Breadcrumbs ride app.crash only: app.error volume is consumer-controlled (§4.7).
    expect("error.breadcrumbs" in a).toBe(false);
    expect("error.handled" in a).toBe(false);
    expect(Object.keys(a).some((k) => k.startsWith("crash."))).toBe(false);
    expect(Object.keys(a).some((k) => k.includes("fingerprint"))).toBe(false);
  });

  it("is Tier 2 — annotated with the live root, no span of its own (§6.3)", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.captureError(new Error("boom"));
    await t.flush();

    const a = attrsOf(sent, "app.error");
    expect(typeof a["trace.id"]).toBe("string");        // the launch root is live at init
    expect(typeof a["rum.action.id"]).toBe("string");
    expect("span.id" in a).toBe(false);
    expect("span.duration_ms" in a).toBe(false);
  });
});

describe("cross_origin — the instrumentation gap, not a mystery Error (§4.7)", () => {
  it("stamps cross_origin when window.onerror arrives with error === undefined", async () => {
    silenceConsole();
    const handlers: any = {};
    vi.stubGlobal("window", {
      set onerror(h: any) { handlers.onerror = h; },
      set onunhandledrejection(h: any) { handlers.rejection = h; },
      addEventListener: () => {},
    });

    const { t, sent } = harness();
    await settle(t);                                 // the ctor's trackErrors() attaches async

    // A bundle served from a CDN without CORS headers: "Script error.", no stack, no error object.
    handlers.onerror("Script error.", "", 0, 0, undefined);
    await settle(t);
    await t.flush();

    const a = attrsOf(sent, "app.crash");
    expect(a["error.source"]).toBe("cross_origin");
    expect(a["error.message"]).toBe("Script error.");
    expect("error.stacktrace" in a).toBe(false);
    expect("error.fatal" in a).toBe(false);          // web omits it — nothing here is fatal

    // ...and a real error object on the same hook is a global_handler, not this rung.
    handlers.onerror("boom", "", 0, 0, new Error("boom"));
    await settle(t);
    await t.flush();
    expect(sent.filter((e) => e.eventName === "app.crash")
      .map((e) => e.attributes!["error.source"]))
      .toEqual(["cross_origin", "global_handler"]);
  });
});

describe("no public path to app.crash (§4.7)", () => {
  it("routes a consumer-supplied app.crash to app.error instead of manufacturing a crash row", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.log("app.crash", { "error.message": "I am not a crash" });
    await t.flush();

    // COUNT(event_name='app.crash') stays a crash count nobody can forge.
    expect(sent.some((e) => e.eventName === "app.crash")).toBe(false);
    const a = attrsOf(sent, "app.error");
    expect(a["error.message"]).toBe("I am not a crash");
    expect(a["error.source"]).toBe("reported");
  });
});

describe("captureConsole defaults off (§4.7)", () => {
  it("emits nothing for a console.error under the default", async () => {
    silenceConsole();
    const { t, sent } = harness();

    // The ctor's fire-and-forget trackErrors() has had every chance to patch by now.
    await t.log("navigation");
    console.error("React thinks something is wrong");
    await t.flush();

    expect(sent.some((e) => e.eventName === "app.error")).toBe(false);
    expect(sent.some((e) => e.eventName === "app.crash")).toBe(false);
  });
});
