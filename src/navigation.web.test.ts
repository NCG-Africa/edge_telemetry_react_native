import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #163 — web emits no `navigation` on any path, and the history path that used to emit it now
// feeds rung 3 (`url`) of the view ladder. v4 wired it through a method core never had, so it
// never ran at all; the raw query-string leak on that feed closes by deletion.

const win: any = {};
const hist: any = {};

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "warn").mockImplementation(() => { });
    win._l = {} as Record<string, any[]>;
    win.addEventListener = (t: string, fn: any) => { (win._l[t] ??= []).push(fn); };
    win.location = { pathname: "/", search: "", href: "https://app.example.com/" };
    hist.pushState = (_d: any, _u: string, url: string) => {
        const u = new URL(url, "https://app.example.com");
        win.location = { pathname: u.pathname, search: u.search, href: u.href };
    };
    hist.replaceState = hist.pushState;
    vi.stubGlobal("window", win);
    vi.stubGlobal("history", hist);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function settle() { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); }

describe("#163 web navigation", () => {
    it("a pushState names the view by its normalized path and emits no navigation row", async () => {
        const { createTelemetry } = await import("./createTelemetry.web");
        const sent: TelemetryEvent[] = [];
        const t = createTelemetry({
            apiKey: "edge_k", endpoint: "https://x/telemetry",
            sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
            store: memoryStore(), batchSize: 500, flushIntervalMs: 0,
        });
        const original = hist.pushState;
        // The tracker installs behind a dynamic import; wait for the patch rather than guess.
        await vi.waitFor(() => expect(hist.pushState).not.toBe(original));

        history.pushState({}, "", "/accounts/91/statements?token=secret");
        await settle();
        history.pushState({}, "", "/settings");
        await settle();
        await t.log("custom_event");
        await t.flush();

        expect(sent.map(e => e.eventName)).not.toContain("navigation");
        expect(JSON.stringify(sent)).not.toContain("token=secret");
        const views = sent.filter(e => e.eventName === "view").map(e => e.attributes!);
        expect(views.map(v => [v["view.name"], v["view.name_source"]])).toEqual([["/accounts/{id}/statements", "url"]]);
        expect(sent.find(e => e.eventName === "custom_event")!.attributes!["view.name"]).toBe("/settings");
    });
});
