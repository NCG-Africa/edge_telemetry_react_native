import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { Store } from "./core/store";

// #164 — manual spans, observed at the `createTelemetry({ sender, store })` seam on both
// builds: what reaches the Sender, never registry internals.

vi.mock("react-native", () => ({ Dimensions: { get: () => ({ width: 390, height: 844 }) }, PixelRatio: { get: () => 3 }, Platform: { OS: "android" }, AppState: { currentState: "active", addEventListener: () => {} } }));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({ default: new Proxy({}, { get: () => async () => "x" }) }));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const MIN = 60 * 1000;
const settle = async () => { for (let i = 0; i < 50; i++) await vi.advanceTimersByTimeAsync(0); };

for (const build of ["native", "web"] as const) {
  describe(`#164 manual spans (${build})`, () => {
    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
    });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    async function launch(store: Store = memoryStore()) {
      const { createTelemetry } = build === "native"
        ? await import("./createTelemetry.native")
        : await import("./createTelemetry.web");
      const sent: TelemetryEvent[] = [];
      const t = createTelemetry({
        apiKey: "edge_span", endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        store: store as any, batchSize: 500, flushIntervalMs: 0,
      });
      const inst = await (t as any).instancePromise;
      await settle();
      return { t, inst, sent };
    }
    const tasks = (sent: TelemetryEvent[]) =>
      sent.filter((e) => e.eventName === "task.complete").map((e) => e.attributes!);

    it("a standalone span mints a `custom` root and emits exactly one task.complete with its width", async () => {
      const { t, sent } = await launch();
      await vi.advanceTimersByTimeAsync(3000);   // the launch root has expired
      const span = t.startSpan("checkout", { cart: 3 });
      await vi.advanceTimersByTimeAsync(1500);
      span.end();
      span.end();   // idempotent
      await settle();
      await t.flush();

      const [row, ...rest] = tasks(sent);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        "task.name": "checkout", "task.outcome": "completed", "span.duration_ms": 1500,
        "trace.root_type": "custom", cart: 3,
      });
      expect(row["span.id"]).toBe(row["rum.action.id"]);
      expect(row).not.toHaveProperty("parent.span.id");
      const ev = sent.find((e) => e.eventName === "task.complete")!;
      expect(ev.timestamp).toBe("2026-06-14T10:00:04.500Z");
    });

    it("joins a live root as a child, still carrying span.duration_ms; a request inside parents to the root", async () => {
      const { t, inst, sent } = await launch();
      await inst.enterView("Home", "route");   // upgrades the launch view in place
      await vi.advanceTimersByTimeAsync(3000);
      await inst.enterView("Cart", "route");   // a navigation, with no live root: mints one
      const span = t.startSpan("load_cart");
      const req = inst.trace.requestTrace(Date.now(), { url: "https://api/x", sampled: true }).finish(Date.now());
      span.end({ outcome: "failed", attributes: { reason: "timeout" } });
      await settle();
      await t.flush();

      const [row] = tasks(sent);
      expect(row["trace.root_type"]).toBe("navigation");
      expect(row["parent.span.id"]).toBe(row["rum.action.id"]);
      expect(row["span.duration_ms"]).toBe(0);
      expect(row).toMatchObject({ "task.outcome": "failed", reason: "timeout" });
      expect(req["parent.span.id"]).toBe(row["rum.action.id"]);
    });

    it("withSpan times sync and async work, ends `failed` on throw and rethrows", async () => {
      const { t, sent } = await launch();
      expect(t.withSpan("sync", () => 7)).toBe(7);
      const p = t.withSpan("async", async () => { await new Promise((r) => setTimeout(r, 200)); return "ok"; });
      await vi.advanceTimersByTimeAsync(200);
      expect(await p).toBe("ok");
      expect(() => t.withSpan("boom", () => { throw new Error("x"); })).toThrow("x");
      await expect(t.withSpan("reject", async () => { throw new Error("y"); })).rejects.toThrow("y");
      await settle();
      await t.flush();

      const byName = Object.fromEntries(tasks(sent).map((r) => [r["task.name"], r]));
      expect(byName.sync["task.outcome"]).toBe("completed");
      expect(byName.async).toMatchObject({ "task.outcome": "completed", "span.duration_ms": 200 });
      expect(byName.boom["task.outcome"]).toBe("failed");
      expect(byName.reject["task.outcome"]).toBe("failed");
      expect(sent.some((e) => e.eventName === "app.error")).toBe(false);
    });

    it("endSpan closes by name; unknown, blank, superseded and over-cap are inert and never throw", async () => {
      const { t, sent } = await launch();
      t.startSpan("journey");
      t.endSpan("journey", "completed", { step: 3 });
      t.endSpan("journey");            // already closed
      t.endSpan("never-opened");
      t.startSpan("  ").end();          // blank
      const first = t.startSpan("dup");
      const second = t.startSpan("dup");   // supersedes
      first.end();                       // cannot close its successor
      second.end({ outcome: "failed" });
      for (let i = 0; i < 33; i++) t.startSpan(`s${i}`);   // the 33rd is inert
      t.endSpan("s32");
      t.endSpan("s31");
      await settle();
      await t.flush();

      expect(tasks(sent).map((r) => [r["task.name"], r["task.outcome"]])).toEqual([
        ["journey", "completed"], ["dup", "failed"], ["s31", "completed"],
      ]);
    });

    it("attributes cannot overwrite task.*, span.*, trace.* or rum.*", async () => {
      const { t, sent } = await launch();
      t.startSpan("pay", { "task.name": "forged", "trace.id": "f", span: { id: "f" }, ok: 1 })
        .end({ attributes: { "task.outcome": "forged", "rum.action.id": "f", ok2: 2 } });
      await settle();
      await t.flush();
      const [row] = tasks(sent);
      expect(row).toMatchObject({ "task.name": "pay", "task.outcome": "completed", ok: 1, ok2: 2 });
      expect(row["trace.id"]).toMatch(/^[0-9a-f]{32}$/);
      expect(row["span.id"]).toMatch(/^[0-9a-f]{16}$/);
      expect(row["rum.action.id"]).toMatch(/^[0-9a-f]{16}$/);
    });

    it("freezes view.id at start, and is not a view action", async () => {
      const { t, inst, sent } = await launch();
      await inst.enterView("A", "route");
      const span = t.startSpan("cross_screen");
      await inst.enterView("B", "route");
      span.end();
      await settle();
      await t.flush();

      const viewA = sent.find((e) => e.eventName === "view" && e.attributes!["view.name"] === "A")!.attributes!;
      expect(tasks(sent)[0]["view.id"]).toBe(viewA["view.id"]);
      expect(tasks(sent)[0]["view.name"]).toBe("A");
      expect(viewA["view.action_count"]).toBe(0);
    });

    it("refreshes lastActivity: a span start keeps the session alive", async () => {
      const { t, sent } = await launch();
      await vi.advanceTimersByTimeAsync(20 * MIN);
      t.startSpan("long");
      await vi.advanceTimersByTimeAsync(20 * MIN);
      await t.log("custom_event");
      await t.flush();
      expect(sent.some((e) => e.eventName === "session.finalized")).toBe(false);
    });

    it("an open span is `abandoned` only at finalize, under the old session.id, ended at last activity", async () => {
      const { t, sent } = await launch();
      t.startSpan("left_open");
      await vi.advanceTimersByTimeAsync(1000);
      await t.log("custom_event");
      await vi.advanceTimersByTimeAsync(31 * MIN);
      await t.log("custom_event");   // idle rotation
      await t.flush();

      const [row] = tasks(sent);
      const finalized = sent.find((e) => e.eventName === "session.finalized")!;
      expect(row).toMatchObject({ "task.outcome": "abandoned", "span.duration_ms": 1000 });
      expect(row["session.id"]).toBe(finalized.attributes!["session.id"]);
      expect(sent.indexOf(sent.find((e) => e.eventName === "task.complete")!)).toBeLessThan(sent.indexOf(finalized));
      expect(tasks(sent)).toHaveLength(1);
    });

    it("a span started on an expired session belongs to the new one, not abandoned by it", async () => {
      const { t, sent } = await launch();
      await vi.advanceTimersByTimeAsync(31 * MIN);
      const span = t.startSpan("after_idle");
      await settle();
      span.end();
      await settle();
      await t.flush();

      const started = sent.filter((e) => e.eventName === "session.started").slice(-1)[0];
      const [row] = tasks(sent);
      expect(row["task.outcome"]).toBe("completed");
      expect(row["session.id"]).toBe(started.attributes!["session.id"]);
    });

    it("survives a relaunch and is closable by name under its original session", async () => {
      const store = memoryStore();
      const first = await launch(store);
      first.t.startSpan("upload", { files: 2 });
      await settle();
      await first.t.flush();
      const sessionId = first.sent.find((e) => e.eventName === "session.started")!.attributes!["session.id"];

      await vi.advanceTimersByTimeAsync(5 * MIN);
      const second = await launch(store);
      second.t.endSpan("upload");
      await settle();
      await second.t.flush();

      const [row] = tasks(second.sent);
      expect(row).toMatchObject({ "task.name": "upload", "task.outcome": "completed", files: 2, "span.duration_ms": 5 * MIN });
      expect(row["session.id"]).toBe(sessionId);
    });
  });
}
