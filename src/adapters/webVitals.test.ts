import { describe, it, expect } from "vitest";
import { vitalAttributes, type VitalMetric } from "./webVitals";

const metric = (over: Partial<VitalMetric>): VitalMetric => ({
    name: "LCP", value: 2500, rating: "good", navigationType: "navigate", ...over,
});

describe("vitalAttributes — the four shared keys (§5.3)", () => {
    it("always ships rating and navigation_type", () => {
        const a = vitalAttributes(metric({ name: "TTFB", rating: "poor", navigationType: "back-forward-cache" }));
        expect(a["vital.rating"]).toBe("poor");
        expect(a["vital.navigation_type"]).toBe("back-forward-cache");
    });

    it("reads vital.target from whichever attribution field the vital uses", () => {
        expect(vitalAttributes(metric({ name: "LCP", attribution: { target: "img#hero" } }))["vital.target"])
            .toBe("img#hero");
        expect(vitalAttributes(metric({ name: "CLS", attribution: { largestShiftTarget: "div.ad" } }))["vital.target"])
            .toBe("div.ad");
        expect(vitalAttributes(metric({ name: "INP", attribution: { interactionTarget: "button#buy" } }))["vital.target"])
            .toBe("button#buy");
    });

    it("omits vital.target and vital.load_state where the vital has neither (FCP/TTFB shapes)", () => {
        const a = vitalAttributes(metric({ name: "TTFB", attribution: { waitingDuration: 12 } }));
        expect("vital.target" in a).toBe(false);
        expect("vital.load_state" in a).toBe(false);
    });

    it("ships vital.load_state when the library produced one", () => {
        expect(vitalAttributes(metric({ name: "FCP", attribution: { loadState: "dom-interactive" } }))["vital.load_state"])
            .toBe("dom-interactive");
    });
});

describe("vitalAttributes — per-vital keys", () => {
    it("LCP's four phases sum exactly to value", () => {
        const m = metric({
            name: "LCP", value: 2500,
            attribution: {
                timeToFirstByte: 500, resourceLoadDelay: 100,
                resourceLoadDuration: 1200, elementRenderDelay: 700,
            },
        });
        const a = vitalAttributes(m);
        const sum = a["lcp.time_to_first_byte"] + a["lcp.resource_load_delay"]
            + a["lcp.resource_load_duration"] + a["lcp.element_render_delay"];
        expect(sum).toBe(m.value);
    });

    it("query-strips lcp.url", () => {
        const a = vitalAttributes(metric({ name: "LCP", attribution: { url: "https://x/hero.jpg?token=secret#frag" } }));
        expect(a["lcp.url"]).toBe("https://x/hero.jpg");
    });

    it("ships INP's three phases and the interaction type", () => {
        const a = vitalAttributes(metric({
            name: "INP", value: 240,
            attribution: { inputDelay: 40, processingDuration: 100, presentationDelay: 100, interactionType: "pointer" },
        }));
        expect(a["inp.input_delay"]).toBe(40);
        expect(a["inp.processing_duration"]).toBe(100);
        expect(a["inp.presentation_delay"]).toBe(100);
        expect(a["inp.interaction_type"]).toBe("pointer");
    });

    it("ships CLS's largest shift value", () => {
        expect(vitalAttributes(metric({ name: "CLS", value: 0.08, attribution: { largestShiftValue: 0.05 } }))["cls.largest_shift_value"])
            .toBe(0.05);
    });

    it("gives TTFB and FCP no per-vital keys", () => {
        for (const name of ["TTFB", "FCP"]) {
            const keys = Object.keys(vitalAttributes(metric({ name, attribution: { loadState: "loading" } })));
            expect(keys.every(k => k.startsWith("vital."))).toBe(true);
        }
    });

    it("omits a phase the library could not measure rather than shipping a zero-ish null", () => {
        const a = vitalAttributes(metric({ name: "LCP", attribution: { timeToFirstByte: 500, resourceLoadDelay: undefined } }));
        expect(a["lcp.time_to_first_byte"]).toBe(500);
        expect("lcp.resource_load_delay" in a).toBe(false);
    });
});
