// Shared delegation base for TelemetryWeb / TelemetryNative.
// Both platform classes lazily build a core `Telemetry` behind `instancePromise`
// and forward every public call to it; these methods are identical across platforms.
// Platform-specific capture (getDeviceInfo, track*, screen) stays in the subclasses
// because each imports a different platform adapter.

import { debug } from "./core/debug";
import type { TaskOutcome } from "./adapters/manualSpans";

/** What `startSpan()` returns. `end()` is idempotent, never throws, and returns nothing to await. */
export type SpanHandle = {
    end(opts?: { outcome?: TaskOutcome; attributes?: Record<string, unknown> }): void;
};

type ProfileInput = {
    userId?: string;
    /** @deprecated Removed in v5 — use `identify({ name })`. */
    fullName?: string;
    /** @deprecated Removed in v5 — never reaches the wire (§3.4). */
    firstName?: string;
    /** @deprecated Removed in v5 — never reaches the wire (§3.4). */
    lastName?: string;
    email?: string;
    phone?: string;
    /** @deprecated Removed in v5 — never reaches the wire (§3.4). */
    avatar?: string;
    customAttributes?: Record<string, any>;
};

export abstract class TelemetryBase {
    protected instancePromise!: Promise<any>;
    /**
     * The resolved core, once `instancePromise` settles — set by each entry. The synchronous
     * methods (`startSpan`, native `trackTap`) cannot afford an `await` before they read the
     * world: the host navigates on the very next line (§4.6's mint/emit split). Before it is
     * set they fall back to emit-time identity.
     */
    protected resolved?: any;

    /** Run `fn` against the core now if it is resolved, else once it is. Never throws. */
    private now(fn: (inst: any) => unknown, what: string): void {
        const swallow = (err: unknown) => debug.warn(`${what} failed:`, err);
        try {
            if (this.resolved) Promise.resolve(fn(this.resolved)).catch(swallow);
            else this.instancePromise.then(fn).catch(swallow);
        } catch (err) { swallow(err); }
    }

    /**
     * "This screen is usable now" (#171). Synchronous, no arguments: it marks the **current**
     * view, so your name and the SDK's cannot disagree. The time is taken now; the view is
     * chosen one macrotask later, so a mark from a new screen's mount effect lands on that
     * screen even though the navigation that opened it settles behind it. The `view` row then
     * carries `view.ready_time` and `view.ready_outcome`. First mark per view wins. Before init
     * the mark is buffered and lands on the initial view.
     */
    markScreenReady(): void {
        const at = Date.now();
        this.now((inst) => { setTimeout(() => inst.views.markReady(at), 0); }, "markScreenReady");
    }

    // ---------- Manual spans (#164) ----------

    /**
     * Time a journey: one `task.complete` row when the handle is ended. Synchronous — the
     * trace keys, `view.id` and `session.id` freeze here. A span joins the live action's
     * root, else mints a `custom` one; requests inside it parent to that root, not the span.
     * Starting a name that is already open supersedes it. Blank names and a 33rd open span
     * are inert. Misuse never throws.
     */
    startSpan(name: string, attributes?: Record<string, unknown>): SpanHandle {
        const at = Date.now();
        let span: unknown;
        let ended = false;
        this.now((inst) => { span = inst.startSpan(name, attributes, at); }, "startSpan");
        return {
            end: (opts) => {
                if (ended) return;
                ended = true;
                const endAt = Date.now();
                this.now((inst) => span && inst.endSpan(name, opts?.outcome ?? "completed", opts?.attributes, endAt, span), "span.end");
            },
        };
    }

    /**
     * `startSpan` + `end` around `fn`, sync or async. A throw (or rejection) ends the span
     * `failed` and is rethrown untouched — no `app.error` is emitted; your catch decides.
     */
    withSpan<T>(name: string, fn: () => T, attributes?: Record<string, unknown>): T {
        const span = this.startSpan(name, attributes);
        let result: T;
        try {
            result = fn();
        } catch (err) {
            span.end({ outcome: "failed" });
            throw err;
        }
        if (result && typeof (result as any).then === "function") {
            return (result as any).then(
                (v: unknown) => { span.end(); return v; },
                (err: unknown) => { span.end({ outcome: "failed" }); throw err; },
            );
        }
        span.end();
        return result;
    }

    /** Close an open span by name — for a journey that ends in a different component. */
    endSpan(name: string, outcome: TaskOutcome = "completed", attributes?: Record<string, unknown>): void {
        const at = Date.now();
        this.now((inst) => inst.endSpan(name, outcome, attributes, at), "endSpan");
    }

    async log(event: string, data?: Record<string, any>) {
        const inst = await this.instancePromise;
        // §4.7 — **there is no public path to `app.crash`.** It is the one name an unfiltered
        // `COUNT(event_name='app.crash') / sessions` is read from, so a consumer's own code
        // must not be able to manufacture rows in it. Routed to `app.error` rather than
        // dropped: a reported error is data, it just isn't a crash. (#100)
        if (event === "app.crash") {
            debug.warn("app.crash is SDK-owned (§4.7); routing to app.error — use captureError()");
            // The whole bag still rides as context; this only decides which key gets promoted
            // to `error.message`. `crash.message` is here for v3 callers the rename stranded.
            const message = data?.["error.message"] ?? data?.["message"] ?? data?.["crash.message"];
            return inst.captureError(message, data);
        }
        return inst.log(event, data);
    }

    async flush() {
        const inst = await this.instancePromise;
        return inst.flush();
    }

    async shutdown() {
        const inst = await this.instancePromise;
        return inst.shutdown();
    }

    /**
     * React Navigation → rung 2 of the name ladder, on **both** builds (§4.5.1, #96).
     * `getCurrentRoute()` is a navigation-tree API that works identically on RN-Web, so a
     * consumer wires navigation once and gets the same `view.name` on web and native.
     */
    async attachNavigation(navigationRef: any) {
        debug.log("Attaching navigation tracker");
        if (!navigationRef) {
            debug.warn("Navigation reference is undefined. Cannot attach navigation tracker.");
            return;
        }
        const inst = await this.instancePromise;
        const { NavigationRefTracker } = await import("./adapters/navigationRef");
        new NavigationRefTracker(inst).attach(navigationRef);
    }

    /**
     * §4.7 — report a handled error as `app.error`. Accepts `unknown`, so a `catch` block
     * that received a string or an axios rejection object needs no narrowing first.
     * There is no public path to `app.crash`, by design (#100).
     */
    async captureError(error: unknown, context?: Record<string, any>) {
        const inst = await this.instancePromise;
        return inst.captureError(error, context);
    }

    /**
     * `<EdgeErrorBoundary>`'s path (#166) — `app.error` with `error.source: boundary` and the
     * component stack. Not for host code: `captureError()` is the public way to report.
     * @internal
     */
    async captureBoundaryError(error: unknown, componentStack?: string | null) {
        const inst = await this.instancePromise;
        const { capComponentStack } = await import("./adapters/crashCapture");
        const context = componentStack ? { "error.component_stack": capComponentStack(componentStack) } : undefined;
        return inst.captureError(error, context, "boundary");
    }

    /**
     * Wired per entry (#160): each build imports its own crash handler. Shared code importing
     * the native one is what made the web build resolve it at runtime and reject.
     */
    abstract trackErrors(options?: { captureConsole?: boolean }): Promise<void>;

    // ---------- User Profile Management ----------

    async setUserId(id: string) {
        const inst = await this.instancePromise;
        inst.setUserId(id);
    }

    async setUserProfile(profile: ProfileInput) {
        const inst = await this.instancePromise;
        inst.setUserProfile(profile);
    }

    async setUserDetails(details: ProfileInput) {
        const inst = await this.instancePromise;
        inst.setUserDetails(details);
    }

    async updateUserProfile(updates: ProfileInput) {
        const inst = await this.instancePromise;
        inst.updateUserProfile(updates);
    }

    async getUserProfile() {
        const inst = await this.instancePromise;
        return inst.getUserProfile();
    }

    async clearUserProfile() {
        const inst = await this.instancePromise;
        inst.clearUserProfile();
    }

    async setUserName(fullName: string, firstName?: string, lastName?: string) {
        const inst = await this.instancePromise;
        inst.setUserName(fullName, firstName, lastName);
    }

    async setUserContact(email?: string, phone?: string) {
        const inst = await this.instancePromise;
        inst.setUserContact(email, phone);
    }

    // EdgeRum-style identify(): emits `user.profile.update`, the **only** event carrying
    // `user.name` / `.email` / `.phone` / `user.custom.*` (§4.10, #107).
    // `userId` is optional and sets the consumer-owned `user.id` the profile upserts on —
    // omit it and `user.id` is untouched; the SDK still never mints one (§3.2).
    async identify(profile: { userId?: string; name?: string; email?: string; phone?: string; avatar?: string; customAttributes?: Record<string, any> }) {
        const inst = await this.instancePromise;
        return inst.identify(profile);
    }
}
