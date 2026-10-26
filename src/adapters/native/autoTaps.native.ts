// `autoTrackTaps` (#174, decisions #150/#154) — opt-in, native-only automatic capture of every
// `onPress` (`ui.type: tap`) and `onLongPress` (`long_press`). It patches the JSX runtime's
// `jsx`/`jsxs`/`jsxDEV` and `React.createElement` at init: Babel's automatic runtime reads
// `(0, _jsxRuntime.jsx)(…)` at call time, so patching the module's exports object reaches
// modules that were already loaded.
//
// Actionability *is* the prop — so there is still no `surface` on native — and the wrapper
// fires on Pressable **activation**, never on touch, so a scroll drag emits nothing.

import { debug } from "../../core/debug";

export type AutoTapKind = "tap" | "long_press";

/** What the entry hands in: called synchronously at activation, *before* the host handler. */
export type AutoTapSink = {
    /** Snapshot identity and mint the root now; returns the emit to run after the handler, or nothing. */
    prepare(kind: AutoTapKind, testID: unknown): (() => void) | undefined;
    /** Increments on every explicit `trackTap()` — an explicit call inside the handler wins. */
    explicitCount(): number;
};

const PROPS: Record<string, AutoTapKind> = { onPress: "tap", onLongPress: "long_press" };
const PATCHED = Symbol.for("edge-telemetry.autoTaps");

/**
 * One activation is one row however many wrapped handlers it passes through — `AppButton →
 * Pressable` nests two, and the innermost element's wrapper is the first one called, so it
 * claims the event and the outer ones pass straight through. Shared across both props.
 */
const claimed = new WeakSet<object>();

/**
 * The instance the wrappers report to. Module-level because the factories are patched once per
 * process: a second opted-in `Telemetry` takes over rather than stacking a second wrapper.
 */
let sink: AutoTapSink | undefined;
const cache = new WeakMap<Function, Map<unknown, Function>>();

export function wrapProps(props: any): any {
    if (!props || typeof props !== "object") return props;
    let out = props;
    for (const prop in PROPS) {
        const handler = props[prop];
        if (typeof handler !== "function") continue;
        // Keyed on (handler, testID): `onPress` keeps its identity across renders (no
        // `React.memo` breakage), and a handler shared by list rows keeps each row's name.
        let byId = cache.get(handler);
        if (!byId) cache.set(handler, (byId = new Map()));
        let wrapped = byId.get(props.testID);
        if (!wrapped) {
            wrapped = wrap(handler, PROPS[prop], props.testID);
            byId.set(props.testID, wrapped);
        }
        if (out === props) out = { ...props };
        out[prop] = wrapped;
    }
    return out;
}

function wrap(handler: Function, kind: AutoTapKind, testID: unknown): Function {
    return function (this: unknown, event?: unknown) {
        const s = sink;
        if (!s) return handler.apply(this, arguments as any);
        const claimable = event !== null && typeof event === "object";
        if (claimable && claimed.has(event as object)) return handler.apply(this, arguments as any);
        if (claimable) claimed.add(event as object);
        let emit: (() => void) | undefined;
        let before = 0;
        try {
            // Before the handler — it navigates on its first line, and the requests it fires
            // must be children of this tap's root, not of whatever was live before.
            emit = s.prepare(kind, testID);
            before = s.explicitCount();
        } catch (err) { debug.warn("autoTrackTaps: prepare failed:", err); }
        try {
            return handler.apply(this, arguments as any);
        } finally {
            if (emit && s.explicitCount() === before) {
                try { emit(); } catch (err) { debug.warn("autoTrackTaps: emit failed:", err); }
            }
        }
    };
}

/**
 * Patch the element factories on the given module exports objects (`react/jsx-runtime`,
 * `react/jsx-dev-runtime`, `react`). Idempotent per module. Never throws: a frozen exports
 * object just stays unpatched.
 */
export function patchElementFactories(modules: unknown[], next: AutoTapSink): void {
    sink = next;
    for (const mod of modules as any[]) {
        if (!mod || mod[PATCHED]) continue;
        try {
            for (const fn of ["jsx", "jsxs", "jsxDEV"]) {
                const orig = mod[fn];
                if (typeof orig !== "function") continue;
                mod[fn] = function (type: unknown, props: unknown, ...rest: unknown[]) {
                    return orig.call(this, type, wrapProps(props), ...rest);
                };
            }
            const create = mod.createElement;
            if (typeof create === "function") {
                mod.createElement = function (type: unknown, props: unknown, ...children: unknown[]) {
                    return create.call(this, type, wrapProps(props), ...children);
                };
            }
            mod[PATCHED] = true;
        } catch (err) {
            debug.warn("autoTrackTaps: could not patch a JSX factory:", err);
        }
    }
}
