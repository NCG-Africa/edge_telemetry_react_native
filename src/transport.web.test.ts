import { describe, it, expect, vi, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import { SESSION_KEY, type TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #94 — transport hardening (§2 / §9.4 / §11), driven through the public API and asserted
// on what reaches the injected Sender. The wire *is* the external behaviour here; reaching
// into the queue would test the implementation and break on the first refactor.
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

/** A Sender that records every batch boundary, not just the flattened event stream. */
function recordingSender() {
  const batches: TelemetryEvent[][] = [];
  const persisted: TelemetryEvent[][] = [];
  return {
    batches,
    persisted,
    sent: () => batches.flat(),
    sender: {
      send: async (e: TelemetryEvent[]) => { batches.push([...e]); },
      onFailure: async (e: TelemetryEvent[]) => { persisted.push([...e]); },
    },
  };
}

const seq = (e: TelemetryEvent) => e.attributes!["event.sequence"];

describe("batch defaults (§9.4)", () => {
  it("fills to 50 before flushing, not 2", async () => {
    silenceConsole();
    const r = recordingSender();
    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry",
      sender: r.sender, flushIntervalMs: 0,   // interval off; only the size trigger is under test
    });

    // session.started is #1, so events 2..49 must not trigger anything.
    for (let i = 0; i < 48; i++) await t.log("custom_event", { i });
    expect(r.batches).toHaveLength(0);

    await t.log("custom_event", { last: true });
    // The size-trigger flush is fire-and-forget; let the microtask queue drain.
    await Promise.resolve(); await Promise.resolve();
    expect(r.batches).toHaveLength(1);
    expect(r.batches[0]).toHaveLength(50);
  });

  it("flushes on a 30s interval, not a 10s one", async () => {
    silenceConsole();
    vi.useFakeTimers();
    const r = recordingSender();
    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry", sender: r.sender,
    });
    await t.log("custom_event");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(r.batches).toHaveLength(0);   // the old default would have shipped here
    await vi.advanceTimersByTimeAsync(20_000);
    expect(r.batches).toHaveLength(1);
  });
});

describe("the in-memory queue cap (§9.4)", () => {
  it("caps at 500 drop-oldest, and an app.crash outlives older ordinary events", async () => {
    silenceConsole();
    const r = recordingSender();
    // batchSize above the cap so nothing auto-flushes and the cap is what we observe.
    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry",
      sender: r.sender, batchSize: 5000, flushIntervalMs: 0,
    });

    await t.log("app.crash", { "crash.message": "first" });
    await t.log("custom_event", { marker: "oldest-ordinary" });
    for (let i = 0; i < 600; i++) await t.log("custom_event", { i });
    await t.flush();

    const sent = r.sent();
    // The crash path already sent one batch; what matters is the *live* queue never
    // grew past the cap, so the final flush cannot carry more than 500.
    expect(r.batches[r.batches.length - 1].length).toBeLessThanOrEqual(500);
    // Evicted last: the crash is still on the wire...
    expect(sent.filter(e => e.eventName === "app.crash")).toHaveLength(1);
    // ...while the ordinary event that was queued right after it is gone.
    expect(sent.some(e => e.attributes?.marker === "oldest-ordinary")).toBe(false);
  });
});

describe("event.sequence (§2.4)", () => {
  it("is monotonic from 0 per session and rides every event and metric", async () => {
    silenceConsole();
    const r = recordingSender();
    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry",
      sender: r.sender, batchSize: 50, flushIntervalMs: 0,
    });

    await t.log("navigation");
    await t.log("custom_event");
    await t.flush();

    const sent = r.sent();
    expect(sent.map(seq)).toEqual(sent.map((_, i) => i));
    expect(sent.every(e => typeof seq(e) === "number")).toBe(true);
  });

  it("is stamped after beforeSend — a dropped event does not consume an ordinal", async () => {
    silenceConsole();
    const r = recordingSender();
    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry",
      sender: r.sender, batchSize: 50, flushIntervalMs: 0,
      beforeSend: (e) => (e.attributes?.secret ? null : e),
    });

    await t.log("custom_event", { secret: true });
    await t.log("custom_event", { secret: true });
    await t.log("navigation");
    await t.flush();

    // session.started took 0; the two scrubbed rows take nothing; navigation is 1, not 3.
    // A gap here would be indistinguishable from real loss, which is what §2.4 forbids.
    expect(seq(r.sent().find(e => e.eventName === "navigation")!)).toBe(1);
  });

  it("continues across a resume — a restart at 0 would forge duplicate dedup keys", async () => {
    silenceConsole();
    const r = recordingSender();
    const now = Date.now();
    const store = memoryStore({
      seed: {
        [SESSION_KEY]: JSON.stringify({
          id: "session_1_aaaaaaaaaaaaaaaa", start: now - 60_000, lastActivity: now - 1_000,
          sequence: 3, eventSequence: 42, eventCount: 42, errorCount: 0,
          sampled: true, sampleRate: 1,
        }),
      },
    });

    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry",
      sender: r.sender, batchSize: 50, flushIntervalMs: 0, store,
    });

    await t.log("navigation");
    await t.flush();

    // Resumed: no session.started, and the ordinal picks up where the record left off.
    expect(r.sent().some(e => e.eventName === "session.started")).toBe(false);
    expect(seq(r.sent().find(e => e.eventName === "navigation")!)).toBe(42);
  });

  it("cannot be forged or deleted by beforeSend — it is Tier A", async () => {
    silenceConsole();
    const r = recordingSender();
    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry",
      sender: r.sender, batchSize: 50, flushIntervalMs: 0,
      beforeSend: (e) => {
        delete e.attributes!["event.sequence"];
        e.attributes!["event.sequence"] = 9999;
        return e;
      },
    });

    await t.log("navigation");
    await t.flush();
    expect(r.sent().map(seq)).toEqual([0, 1]);
  });
});

describe("drop accounting (§3.7 / §11)", () => {
  it("omits sdk.drop_reason until a drop happens, and keeps sdk.events_dropped monotonic", async () => {
    silenceConsole();
    const r = recordingSender();
    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry",
      sender: r.sender, batchSize: 5000, flushIntervalMs: 0,
    });

    await t.log("navigation");
    await t.flush();
    const clean = r.sent();
    expect(clean.every(e => e.attributes!["sdk.events_dropped"] === 0)).toBe(true);
    expect(clean.every(e => !("sdk.drop_reason" in e.attributes!))).toBe(true);

    // Overflow the queue, then emit one more so the counters have a row to ride on:
    // they are reported by the *next* event, never the one whose enqueue caused the drop.
    for (let i = 0; i < 600; i++) await t.log("custom_event", { i });
    await t.log("navigation", { after: true });
    await t.flush();

    const last = r.sent().find(e => e.attributes?.after === true)!;
    expect(last.attributes!["sdk.drop_reason"]).toBe("queue_full");
    expect(last.attributes!["sdk.events_dropped"]).toBeGreaterThan(0);
  });
});

describe("the crash path (§2 / §9.4)", () => {
  it("persists the whole queue and sends exactly one batch carrying the crash", async () => {
    silenceConsole();
    const r = recordingSender();
    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry",
      // batchSize 2 so a crash behind older events could not ride out by accident
      sender: r.sender, batchSize: 2, flushIntervalMs: 0,
    });

    await t.log("navigation", { n: 1 });   // session.started + navigation = the 2-event batch
    await Promise.resolve(); await Promise.resolve();
    r.batches.length = 0;

    await t.log("custom_event", { n: 2 });
    await t.log("app.crash", { "crash.message": "boom" });

    // One round trip, not a drain.
    expect(r.batches).toHaveLength(1);
    // Reordered so the crash rides in it, even though it was enqueued last.
    expect(r.batches[0][0].eventName).toBe("app.crash");
    // The persist is the guarantee; it covers the whole queue, not just the batch.
    expect(r.persisted).toHaveLength(1);
    expect(r.persisted[0].map(e => e.eventName)).toContain("app.crash");
    expect(r.persisted[0].map(e => e.eventName)).toContain("custom_event");
  });

  it("still sends the crash when the persist fails — the send is not gated on the store", async () => {
    silenceConsole();
    const r = recordingSender();
    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry", flushIntervalMs: 0,
      sender: {
        send: r.sender.send,
        onFailure: async () => { throw new Error("storage exploded"); },
      },
    });

    await t.log("app.crash", { "crash.message": "boom" });
    expect(r.sent().some(e => e.eventName === "app.crash")).toBe(true);
  });
});
