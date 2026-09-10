import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { SyncStore } from "./core/store";

// #93 — sessionSampleRate and beforeSend, observed the way the contract is observed:
// the public API in, the injected Sender's TelemetryEvent[] out. Time is fake timers,
// persisted state is the in-memory Store fake, the sample roll is a stubbed Math.random.

const MIN = 60 * 1000;

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

type LaunchOpts = {
  store?: SyncStore;
  beforeSend?: (e: TelemetryEvent) => TelemetryEvent | null;
  sessionSampleRate?: number;
  sender?: any;
};

/** One "process": a fresh SDK, plus everything it handed the sender. */
function launch(opts: LaunchOpts = {}) {
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_sampling",
    endpoint: "https://x/telemetry",
    sender: opts.sender ?? { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store: opts.store,
    beforeSend: opts.beforeSend,
    sessionSampleRate: opts.sessionSampleRate,
    batchSize: 50,
    flushIntervalMs: 0,
  });
  return { t, sent, names: () => sent.map((e) => e.eventName ?? e.metricName) };
}

/**
 * The metric path. The entry classes expose no metric method — metrics come from the
 * frame/memory adapters, which hold the core instance — so this is how a metric is
 * emitted for real. The assertion still lands on the wire, not on private state.
 */
async function logMetric(t: any, name: string, value: number, data?: Record<string, any>) {
  const inst = await t.instancePromise;
  await inst.logMetric(name, value, data);
}

const attrsOf = (sent: TelemetryEvent[], name: string) =>
  sent.filter((e) => e.eventName === name).map((e) => e.attributes!);

beforeEach(() => {
  silenceConsole();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#93 beforeSend — constructor-only, at enqueue, over events and metrics", () => {
  it("exposes no runtime setter for either option", () => {
    const { t } = launch();
    expect((t as any).setBeforeSend).toBeUndefined();
    expect((t as any).setSessionSampleRate).toBeUndefined();
    expect((t as any).beforeSend).toBeUndefined();
  });

  it("runs over metrics as well as events — vital.target is the least sanitised key on the wire", async () => {
    const seen: string[] = [];
    const { t, sent } = launch({
      beforeSend: (e) => {
        seen.push(e.type);
        delete e.attributes!["vital.target"];
        return e;
      },
    });

    await t.log("custom_event", { "vital.target": "#pay > input" });
    await logMetric(t, "memory_usage", 42, { "vital.target": "#pay > input" });
    await t.flush();

    expect(seen).toContain("event");
    expect(seen).toContain("metric");
    expect(sent.some((e) => e.metricName === "memory_usage")).toBe(true);
    for (const e of sent) expect(e.attributes!["vital.target"]).toBeUndefined();
  });

  it("scrubs at enqueue, so a failed send persists an already-scrubbed batch", async () => {
    const persisted: TelemetryEvent[] = [];
    const sender = {
      send: async () => { throw new Error("collector down"); },
      onFailure: async (e: TelemetryEvent[]) => { persisted.push(...e); },
    };

    const { t } = launch({
      sender,
      beforeSend: (e) => { delete e.attributes!["user.email"]; return e; },
    });

    await t.identify({ email: "ada@x.io" });
    await t.flush().catch(() => {});

    expect(persisted.length).toBeGreaterThan(0);
    for (const e of persisted) expect(e.attributes!["user.email"]).toBeUndefined();
  });
});

describe("#93 beforeSend — the tiers hold on the wire", () => {
  it("re-stamps Tier A and Tier B when the hook deletes everything", async () => {
    const { t, sent } = launch({
      beforeSend: (e) => {
        for (const k of Object.keys(e.attributes!)) delete e.attributes![k];
        return e;
      },
    });

    await t.log("navigation", { "navigation.to_screen": "Home" });
    await t.flush();

    const a = attrsOf(sent, "navigation")[0];
    expect(a["session.id"]).toMatch(/^session_/);
    expect(a["session.start_time"]).toBeDefined();
    expect(a["sdk.platform"]).toBe("react-native");
    expect(a["sdk.version"]).toBeDefined();
    expect(a["device.id"]).toMatch(/^device_/);          // Tier B: deleting it 400s the batch
    expect(a["navigation.to_screen"]).toBeUndefined();   // Tier C really went
  });

  it("keeps a hashed device.id — rewriting Tier B is the legitimate case", async () => {
    const { t, sent } = launch({
      beforeSend: (e) => { e.attributes!["device.id"] = "sha256:deadbeef"; return e; },
    });

    await t.log("custom_event");
    await t.flush();

    expect(attrsOf(sent, "custom_event")[0]["device.id"]).toBe("sha256:deadbeef");
  });
});

describe("#93 beforeSend — dropped is not failed", () => {
  it("a hook returning null drops the row and counts sdk.hook_dropped", async () => {
    let drop = true;
    const { t, sent } = launch({ beforeSend: (e) => (drop ? null : e) });

    await t.log("custom_event");     // dropped, along with session.started before it
    drop = false;
    await t.log("navigation");
    await t.flush();

    expect(sent.map((e) => e.eventName)).toEqual(["navigation"]);
    const a = attrsOf(sent, "navigation")[0];
    expect(a["sdk.hook_dropped"]).toBe(2);   // session.started + custom_event
    expect(a["sdk.hook_failed"]).toBe(0);
  });

  it("a throwing hook fails closed and counts sdk.hook_failed separately", async () => {
    let boom = true;
    const { t, sent } = launch({
      beforeSend: (e) => {
        if (boom) throw new Error("bug in the scrubber");
        return e;
      },
    });

    await t.log("custom_event", { "user.email": "ada@x.io" });
    boom = false;
    await t.log("navigation");
    await t.flush();

    // The original is never sent — it carries the exact field the hook existed to remove.
    expect(sent.map((e) => e.eventName)).toEqual(["navigation"]);
    const a = attrsOf(sent, "navigation")[0];
    expect(a["sdk.hook_failed"]).toBe(2);
    expect(a["sdk.hook_dropped"]).toBe(0);
  });
});

describe("#93 sessionSampleRate — sticky, and silent when it says no", () => {
  it("a sampled-out session sends zero payloads, crashes included", async () => {
    const send = vi.fn(async () => {});
    const { t } = launch({ sessionSampleRate: 0, sender: { send } });

    await t.log("custom_event");
    await t.log("app.crash", { "error.message": "boom" });
    await logMetric(t, "memory_usage", 42);
    await t.flush();

    expect(send).not.toHaveBeenCalled();
  });

  it("stamps session.sample_rate on every row of a sampled-in session", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);   // 0.1 < 0.5 — sampled in
    const { t, sent } = launch({ sessionSampleRate: 0.5 });

    await t.log("custom_event");
    await t.flush();

    expect(sent.length).toBeGreaterThan(0);
    for (const e of sent) expect(e.attributes!["session.sample_rate"]).toBe(0.5);
  });

  it("an out-of-range rate falls back to 1 rather than muting the deployment", async () => {
    const { t, sent } = launch({ sessionSampleRate: Number.NaN });

    await t.log("custom_event");
    await t.flush();

    expect(sent.length).toBeGreaterThan(0);
    expect(attrsOf(sent, "custom_event")[0]["session.sample_rate"]).toBe(1);
  });

  it("ignores a persisted rate it cannot trust rather than stamping it as a divisor", async () => {
    // On web the record is browser-wide localStorage; an out-of-range rate shipped as
    // session.sample_rate would silently mis-scale every count taken off it.
    const store = memoryStore({
      seed: {
        telemetry_session: JSON.stringify({
          id: "session_1_corrupt", start: Date.now(), lastActivity: Date.now(),
          sequence: 0, eventCount: 0, errorCount: 0, sampled: true, sampleRate: -3,
        }),
      },
    });

    const { t, sent } = launch({ store, sessionSampleRate: 1 });
    await t.log("custom_event");
    await t.flush();

    expect(attrsOf(sent, "custom_event")[0]["session.sample_rate"]).toBe(1);
  });

  it("the decision survives process death and is re-rolled only at rotation", async () => {
    const store = memoryStore();
    const roll = vi.spyOn(Math, "random").mockReturnValue(0.9);   // 0.9 >= 0.5 — sampled out

    const first = launch({ store, sessionSampleRate: 0.5 });
    await first.t.log("custom_event");
    await first.t.flush();
    expect(first.sent).toHaveLength(0);

    // Relaunch inside the idle window with a roll that *would* sample in. A resume is
    // not a rotation, so the session stays out — otherwise it would be half-sampled.
    roll.mockReturnValue(0.1);
    vi.setSystemTime(Date.now() + 10 * MIN);
    const second = launch({ store, sessionSampleRate: 0.5 });
    await second.t.log("custom_event");
    await second.t.flush();
    expect(second.sent).toHaveLength(0);

    // Past the idle boundary the session rotates, and the fresh one re-rolls.
    vi.setSystemTime(Date.now() + 45 * MIN);
    const third = launch({ store, sessionSampleRate: 0.5 });
    await third.t.log("custom_event");
    await third.t.flush();
    expect(third.names()).toEqual(["session.started", "custom_event"]);
    // session.finalized belonged to the sampled-out session and correctly never shipped.
    expect(third.names()).not.toContain("session.finalized");
  });
});
