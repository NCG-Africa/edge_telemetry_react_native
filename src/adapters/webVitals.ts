// §5.3's attribute shaping for the five Core Web Vitals — the pure half, so the rules are
// unit-tested against plain objects and the `.web.ts` half is left with nothing but the
// library subscription. Shared-file, but web-only in practice: `TelemetryNative` never
// imports it, which is what keeps `web-vitals` out of the native bundle entirely.

/** The five names. All are already on `ALLOWED_NAMES`, and all ride the **metric** path. */
export type VitalName = "LCP" | "FCP" | "CLS" | "INP" | "TTFB";

/**
 * Structurally typed against `web-vitals/attribution`'s metric, so this module compiles and
 * tests without the library and cannot pull it into a shared import graph.
 */
export type VitalMetric = {
    name: string;
    value: number;
    rating: string;
    navigationType: string;
    // `any`, not `unknown`: `web-vitals`' concrete `LCPAttribution` &c. have no index
    // signature, so a `Record<string, unknown>` here rejects every one of them at the
    // subscription. Everything downstream of this field is read through `num`/`str`.
    attribution?: Record<string, any>;
};

const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

const str = (v: unknown): string | undefined =>
    typeof v === "string" && v !== "" ? v : undefined;

/**
 * `vital.target` is the raw CSS selector the library derived — LCP's `target`, CLS's
 * `largestShiftTarget`, INP's `interactionTarget`; **absent on FCP and TTFB**, which have no
 * element.
 *
 * ⚠ §4.6's action-name ladder was rejected for it on the record: the role gate blanks `<img>`,
 * `<h1>` and banners, which is most vital targets, and un-gating the ladder would rebuild the
 * `textContent` hole the gate exists to close. A selector is developer-authored structure —
 * tags, ids, classes — never user content. It is still **the least sanitized key on the wire**,
 * which is the reason `beforeSend` covers metrics at all.
 */
function target(a: Record<string, unknown>): string | undefined {
    return str(a.target) ?? str(a.largestShiftTarget) ?? str(a.interactionTarget);
}

/**
 * §5.3: `lcp.url` is **query-stripped**, and query-stripped only — the contract is the authority
 * on every wire key's value discipline, and a fragment never leaves the browser anyway.
 */
function stripQuery(url?: string): string | undefined {
    return url === undefined ? undefined : url.split("?")[0];
}

/**
 * Build a vital row's attribute bag: four shared keys plus the per-vital ones (§5.3).
 *
 * ⚠ **LCP's four phases sum exactly to `value`** — that is the library's own guarantee and a
 * testable claim, which is why `lcp.time_to_first_byte` deliberately duplicates the `TTFB` row
 * rather than forcing a cross-row join to decompose one number.
 *
 * Everything the library did not produce is **omitted**, never nulled: `vital.target` and
 * `vital.load_state` are absent on the vitals that have no element and no load state, and the
 * SDK's absent-means-nothing discipline is what tells that apart from a zero.
 */
export function vitalAttributes(m: VitalMetric): Record<string, any> {
    const a: Record<string, unknown> = m.attribution ?? {};
    const out: Record<string, any> = {
        "vital.rating": m.rating,
        // ⚠ Load-bearing, not decoration: a `back-forward-cache` LCP is ~0 ms and will
        // silently drag a p75 down if the population is not separable.
        "vital.navigation_type": m.navigationType,
    };
    const t = target(a);
    if (t !== undefined) out["vital.target"] = t;
    const load = str(a.loadState);
    if (load !== undefined) out["vital.load_state"] = load;

    const put = (key: string, v: number | string | undefined) => {
        if (v !== undefined) out[key] = v;
    };

    switch (m.name) {
        case "LCP":
            put("lcp.time_to_first_byte", num(a.timeToFirstByte));
            put("lcp.resource_load_delay", num(a.resourceLoadDelay));
            put("lcp.resource_load_duration", num(a.resourceLoadDuration));
            put("lcp.element_render_delay", num(a.elementRenderDelay));
            put("lcp.url", stripQuery(str(a.url)));
            break;
        case "INP":
            put("inp.input_delay", num(a.inputDelay));
            put("inp.processing_duration", num(a.processingDuration));
            put("inp.presentation_delay", num(a.presentationDelay));
            put("inp.interaction_type", str(a.interactionType));
            break;
        case "CLS":
            put("cls.largest_shift_value", num(a.largestShiftValue));
            break;
        // TTFB and FCP carry no per-vital keys (§5.3).
    }
    return out;
}
