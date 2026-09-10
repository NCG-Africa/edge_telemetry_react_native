import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";
import { SESSION_KEY } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { SyncStore } from "./core/store";

// #92 — session continuity, driven the way the contract is observed: the public API in,
// the injected Sender's TelemetryEvent[] out. Time is fake timers, persisted state is the
// in-memory Store fake. Nothing reaches into a manager's private state.

const MIN = 60 * 1000;

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

/** One "process": a fresh SDK over shared persistence, plus everything it sent. */
function launch(store: SyncStore) {
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_session",
    endpoint: "https://x/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store,
    batchSize: 50,
    flushIntervalMs: 0,
  });
  return { t, sent, names: () => sent.map((e) => e.eventName) };
}

const attrsOf = (sent: TelemetryEvent[], name: string) =>
  sent.filter((e) => e.eventName === name).map((e) => e.attributes!);

/** The listeners the SDK registered on `window`, so a bfcache restore can be fired for real. */
const listeners: Record<string, ((e: any) => void)[]> = {};

/** Fire `pageshow` with `persisted: true` — a genuine restore, not a fresh load. */
async function restore() {
  for (const fn of listeners.pageshow ?? []) fn({ persisted: true });
  // the handler is fire-and-forget behind instancePromise; drain the chain it kicks off
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

beforeEach(() => {
  silenceConsole();
  for (const k of Object.keys(listeners)) delete listeners[k];
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (e: any) => void) => {
      (listeners[type] ??= []).push(fn);
    },
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("#92 session continuity — resume across process death", () => {
  it("a relaunch inside 30 min continues the same session.id and emits no second session.started", async () => {
    const store = memoryStore();

    const first = launch(store);
    await first.t.log("custom_event");
    await first.t.flush();
    const id = attrsOf(first.sent, "custom_event")[0]["session.id"];
    expect(first.names().filter((n) => n === "session.started")).toHaveLength(1);

    vi.setSystemTime(Date.now() + 29 * MIN);   // hard reload / process death, inside the window

    const second = launch(store);
    await second.t.log("custom_event");
    await second.t.flush();

    expect(attrsOf(second.sent, "custom_event")[0]["session.id"]).toBe(id);
    expect(second.names()).not.toContain("session.started");
    expect(second.names()).not.toContain("session.finalized");
  });

  it("carries session.start_time and session.sequence across the relaunch", async () => {
    const store = memoryStore();

    const first = launch(store);
    await first.t.log("custom_event");
    await first.t.flush();
    const before = attrsOf(first.sent, "custom_event")[0];

    vi.setSystemTime(Date.now() + 5 * MIN);
    const second = launch(store);
    await second.t.log("custom_event");
    await second.t.flush();
    const after = attrsOf(second.sent, "custom_event")[0];

    expect(after["session.start_time"]).toBe(before["session.start_time"]);
    // sequence counts acknowledged batches within a session; a resume must not reset it
    expect(after["session.sequence"]).toBe(1);
  });

  it("a relaunch after 30 min idle rotates, with the idle reason on both events", async () => {
    const store = memoryStore();

    const first = launch(store);
    await first.t.log("custom_event");
    await first.t.flush();
    const id = attrsOf(first.sent, "custom_event")[0]["session.id"];

    vi.setSystemTime(Date.now() + 31 * MIN);

    const second = launch(store);
    await second.t.log("custom_event");
    await second.t.flush();

    expect(attrsOf(second.sent, "session.finalized")[0]["session.reason"]).toBe("idle");
    expect(attrsOf(second.sent, "session.started")[0]["session.reason"]).toBe("idle");
    // the finalize ships under the *old* id, the fresh session under a new one
    expect(attrsOf(second.sent, "session.finalized")[0]["session.id"]).toBe(id);
    expect(attrsOf(second.sent, "custom_event")[0]["session.id"]).not.toBe(id);
  });

  it("stamps duration_ms from lastActivity, not from the relaunch clock", async () => {
    const store = memoryStore();

    const first = launch(store);
    await first.t.log("custom_event");
    vi.setSystemTime(Date.now() + 2 * MIN);
    await first.t.log("custom_event");    // two minutes of real use...
    await first.t.flush();

    vi.setSystemTime(Date.now() + 6 * 60 * MIN);   // ...then six idle hours

    const second = launch(store);
    await second.t.flush();

    // the v3 defect was reporting 6 hours here
    expect(attrsOf(second.sent, "session.finalized")[0]["session.duration_ms"]).toBe(2 * MIN);
  });

  it("mints a fresh launch session when the durable record is corrupt", async () => {
    const store = memoryStore({ seed: { [SESSION_KEY]: "{not json" } });

    const { t, sent, names } = launch(store);
    await t.flush();

    expect(names()).toContain("session.started");
    expect(attrsOf(sent, "session.started")[0]["session.reason"]).toBe("launch");
    expect(names()).not.toContain("session.finalized");
  });

  it("a collector that is down at init does not brick the instance", async () => {
    // The init rotation finalizes, finalizeSession() flushes, and flush() rethrows. If that
    // reached instancePromise the SDK would reject every call for the life of the process.
    const store = memoryStore();
    const first = launch(store);
    await first.t.log("custom_event");
    await first.t.flush();

    vi.setSystemTime(Date.now() + 31 * MIN);   // the relaunch owes a finalize

    const sent: TelemetryEvent[] = [];
    let down = true;
    const t = createTelemetry({
      apiKey: "edge_session",
      endpoint: "https://x/telemetry",
      sender: {
        send: async (e: TelemetryEvent[]) => {
          if (down) { down = false; throw new Error("collector down"); }
          sent.push(...e);
        },
      },
      store,
      batchSize: 50,
      flushIntervalMs: 0,
    });

    await expect(t.log("custom_event")).resolves.toBeUndefined();
    await t.flush();
    expect(sent.some((e) => e.eventName === "custom_event")).toBe(true);
  });

  it("still starts a session when the Store is unavailable", async () => {
    const store = memoryStore({ unavailable: true });

    const { t, sent } = launch(store);
    await t.log("custom_event");
    await t.flush();

    expect(attrsOf(sent, "session.started")[0]["session.reason"]).toBe("launch");
    expect(attrsOf(sent, "custom_event")[0]["session.id"]).toMatch(/^session_\d+_[0-9a-f]{16}_web$/);
  });
});

describe("#92 session boundaries — idle and the 4-hour cap", () => {
  it("emits session.reason: launch on the very first session", async () => {
    const { t, sent } = launch(memoryStore());
    await t.flush();
    expect(attrsOf(sent, "session.started")[0]["session.reason"]).toBe("launch");
  });

  it("rotates a live session at the 4-hour cap, with the cap reason", async () => {
    const { t, sent, names } = launch(memoryStore());
    await t.log("custom_event");
    await t.flush();
    const id = attrsOf(sent, "custom_event")[0]["session.id"];

    // busy the whole time, so idle never fires — only the cap can end this one
    for (let i = 0; i < 9; i++) {
      vi.setSystemTime(Date.now() + 27 * MIN);
      await t.log("custom_event");
    }
    await t.flush();

    expect(attrsOf(sent, "session.finalized")[0]["session.reason"]).toBe("max_duration");
    expect(attrsOf(sent, "session.started")[1]["session.reason"]).toBe("max_duration");
    expect(names().filter((n) => n === "session.finalized")).toHaveLength(1);

    const last = [...sent].reverse().find((e) => e.eventName === "custom_event")!;
    expect(last.attributes!["session.id"]).not.toBe(id);
  });

  it("a bfcache restore inside the window keeps the session and emits nothing", async () => {
    const { t, sent, names } = launch(memoryStore());
    await t.log("custom_event");
    await t.flush();
    const id = attrsOf(sent, "custom_event")[0]["session.id"];

    vi.setSystemTime(Date.now() + 20 * MIN);   // frozen in bfcache, restored inside the window
    await restore();

    await t.log("custom_event");
    await t.flush();
    expect(names()).not.toContain("session.finalized");
    expect(names().filter((n) => n === "session.started")).toHaveLength(1);
    expect(attrsOf(sent, "custom_event")[1]["session.id"]).toBe(id);
  });

  it("a bfcache restore after the window rotates on the spot", async () => {
    const { t, sent, names } = launch(memoryStore());
    await t.log("custom_event");
    await t.flush();
    const id = attrsOf(sent, "custom_event")[0]["session.id"];

    vi.setSystemTime(Date.now() + 31 * MIN);   // the freeze outlasted the idle window
    await restore();
    await t.flush();

    expect(attrsOf(sent, "session.finalized")[0]["session.reason"]).toBe("idle");
    expect(attrsOf(sent, "session.finalized")[0]["session.id"]).toBe(id);
    expect(names().filter((n) => n === "session.started")).toHaveLength(2);
  });

  it("a bfcache restore picks up a sibling tab's rotation from the shared Store", async () => {
    // Two tabs, one localStorage. The frozen tab must not keep shipping under an id the
    // other tab already finalized.
    const store = memoryStore();
    const frozen = launch(store);
    await frozen.t.log("custom_event");
    await frozen.t.flush();
    const original = attrsOf(frozen.sent, "custom_event")[0]["session.id"];

    vi.setSystemTime(Date.now() + 31 * MIN);
    const sibling = launch(store);           // the other tab rotates while this one is frozen
    await sibling.t.log("custom_event");
    await sibling.t.flush();
    const rotated = attrsOf(sibling.sent, "custom_event")[0]["session.id"];
    expect(rotated).not.toBe(original);

    await restore();
    await frozen.t.log("custom_event");
    await frozen.t.flush();

    const last = [...frozen.sent].reverse().find((e) => e.eventName === "custom_event")!;
    expect(last.attributes!["session.id"]).toBe(rotated);
  });

  it("a bfcache restore with an unavailable Store keeps the live session rather than re-announcing it", async () => {
    const { t, sent, names } = launch(memoryStore({ unavailable: true }));
    await t.log("custom_event");
    await t.flush();
    const id = attrsOf(sent, "custom_event")[0]["session.id"];

    vi.setSystemTime(Date.now() + 5 * MIN);
    await restore();
    await t.log("custom_event");
    await t.flush();

    expect(names().filter((n) => n === "session.started")).toHaveLength(1);
    expect(attrsOf(sent, "custom_event")[1]["session.id"]).toBe(id);
  });

  it("a metric is not activity, but is still checked against the boundaries", async () => {
    // A backgrounded app sampling memory must not hold a session open forever — that is the
    // whole reason the cap exists — and must not refresh the idle window either.
    const { t, sent, names } = launch(memoryStore());
    // logMetric() has no TelemetryBase delegate, so the core instance is the only way to
    // drive the metric path. This is the real method on the real object, not private state.
    const inst = await (t as any).instancePromise;
    await t.log("custom_event");
    await t.flush();
    const id = attrsOf(sent, "custom_event")[0]["session.id"];

    vi.setSystemTime(Date.now() + 20 * MIN);
    await inst.logMetric("memory_usage", 42);       // does not refresh lastActivity
    expect(names()).not.toContain("session.finalized");

    vi.setSystemTime(Date.now() + 20 * MIN);        // 40 min since the last real event
    await inst.logMetric("memory_usage", 43);       // ...so this one trips the idle boundary
    await t.flush();

    expect(attrsOf(sent, "session.finalized")[0]["session.reason"]).toBe("idle");
    const lastMetric = [...sent].reverse().find((e) => e.metricName === "memory_usage")!;
    expect(lastMetric.attributes!["session.id"]).not.toBe(id);
  });

  it("session.finalized still carries duration_ms and event_count", async () => {
    const { t, sent } = launch(memoryStore());
    await t.log("custom_event");
    await t.log("app.crash", { "crash.cause": "Error" });

    vi.setSystemTime(Date.now() + 31 * MIN);
    await t.log("custom_event");
    await t.flush();

    const fin = attrsOf(sent, "session.finalized")[0];
    expect(typeof fin["session.duration_ms"]).toBe("number");
    expect(fin["session.event_count"]).toBe(3);   // app.start + custom_event + app.crash
    expect(fin["sdk.error_count"]).toBe(1);
  });

  it("session.reason never leaves its domain: 3 values started, 2 finalized (§4.1/§4.2)", async () => {
    const { t, sent } = launch(memoryStore());
    await t.log("custom_event");
    vi.setSystemTime(Date.now() + 31 * MIN);
    await t.log("custom_event");
    await t.flush();

    for (const a of attrsOf(sent, "session.started")) {
      expect(["launch", "idle", "max_duration"]).toContain(a["session.reason"]);
    }
    for (const a of attrsOf(sent, "session.finalized")) {
      expect(["idle", "max_duration"]).toContain(a["session.reason"]);
    }
  });
});
