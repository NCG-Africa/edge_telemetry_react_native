import { describe, it, expect, vi } from "vitest";
import { buildErrorAttributes, errorType, captureConsole } from "./crashCapture";

function fakeSink() {
  const calls: Array<{ error: unknown; source?: string }> = [];
  const crumbs: Array<{ name: string; data: any }> = [];
  return {
    sink: {
      captureError: vi.fn((error: unknown, _ctx?: any, source?: any) => { calls.push({ error, source }); }),
      addBreadcrumb: vi.fn((name: string, data?: any) => { crumbs.push({ name, data }); }),
    },
    calls,
    crumbs,
  };
}

describe("errorType — error.name only, never constructor.name (§4.7)", () => {
  it("reads the name literal, which survives minification, not the class name", () => {
    // Simulates a minified bundle: the class binding is one letter, the literal is not.
    class a extends Error {
      name = "PaymentError";
    }
    const e = new a("declined");
    expect(e.constructor.name).toBe("a");    // what a naive read would ship
    expect(errorType(e)).toBe("PaymentError");
  });

  it("falls back to Error for an un-named class, a string and a plain object", () => {
    class Unnamed extends Error {}
    expect(errorType(new Unnamed("x"))).toBe("Error");   // Error.prototype.name
    expect(errorType("just a string")).toBe("Error");
    expect(errorType({ status: 500 })).toBe("Error");
    expect(errorType(undefined)).toBe("Error");
  });
});

describe("buildErrorAttributes — dotted error.* keys, no wire nulls (§4.7)", () => {
  it("emits error.type/source and omits message and stacktrace when absent", () => {
    const a = buildErrorAttributes("global_handler", {});
    expect(a["error.type"]).toBe("Error");
    expect(a["error.source"]).toBe("global_handler");
    expect("error.message" in a).toBe(false);
    expect("error.stacktrace" in a).toBe(false);
    expect("error.fatal" in a).toBe(false);       // omitted unless the caller passes it
    expect("error.handled" in a).toBe(false);     // does not exist at all
  });

  it("carries none of the retired crash.* keys and no fingerprint", () => {
    const a = buildErrorAttributes("reported", new Error("boom"), { fatal: true });
    expect(Object.keys(a).some((k) => k.startsWith("crash."))).toBe(false);
    expect(Object.keys(a).some((k) => k.includes("fingerprint"))).toBe(false);
    expect(a["error.fatal"]).toBe(true);
  });

  it("takes the message from a thrown string, and from the fallback for a bare object", () => {
    expect(buildErrorAttributes("reported", "plain string")["error.message"]).toBe("plain string");
    expect(buildErrorAttributes("cross_origin", undefined, { fallbackMessage: "Script error." })["error.message"])
      .toBe("Script error.");
  });

  it("truncates the tail — never the head — and marks the cut inline", () => {
    const long = "x".repeat(5000);
    const a = buildErrorAttributes("reported", { message: long });
    expect(a["error.message"]!.length).toBe(1000);
    expect(a["error.message"]!.startsWith("xxx")).toBe(true);
    expect(a["error.message"]!.endsWith("… [truncated]")).toBe(true);
  });

  it("cuts a stacktrace on a frame boundary — a half-frame resolves to the wrong location", () => {
    const frame = "    at p (address at bundle:1:132161)";
    const err = { stack: Array.from({ length: 200 }, () => frame).join("\n") };
    const stack = buildErrorAttributes("global_handler", err)["error.stacktrace"] as string;

    expect(stack.length).toBeLessThanOrEqual(2000);
    const frames = stack.replace("\n… [truncated]", "").split("\n");
    expect(frames.every((f) => f === frame)).toBe(true);   // no partial `…bundle:1:13`
  });
});

describe("captureConsole — console.error is app.error, console.warn is a breadcrumb (§4.7)", () => {
  it("splits the two and still calls through", () => {
    const { sink, calls, crumbs } = fakeSink();
    const orig = { error: vi.fn(), warn: vi.fn() };
    const fakeConsole: any = { ...orig };

    const restore = captureConsole(sink, fakeConsole);
    fakeConsole.error("oops", 1);
    fakeConsole.warn("careful");

    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe("console");   // captureError only ever emits app.error
    expect(calls[0].error).toBe("oops 1");

    expect(crumbs).toEqual([{ name: "console.warn", data: { message: "careful" } }]);

    expect(orig.error).toHaveBeenCalledWith("oops", 1);
    expect(orig.warn).toHaveBeenCalledWith("careful");

    restore();
    fakeConsole.error("after restore");
    expect(calls).toHaveLength(1);
  });

  it("does not recurse when the sink itself writes to console.error", () => {
    const seen: unknown[] = [];
    const fakeConsole: any = { error: vi.fn(), warn: vi.fn() };
    const sink: any = {
      captureError: vi.fn((e: unknown) => { seen.push(e); fakeConsole.error("internal noise"); }),
      addBreadcrumb: vi.fn(),
    };

    captureConsole(sink, fakeConsole);
    fakeConsole.error("user error");

    expect(seen).toEqual(["user error"]);
  });

  it("caps the breadcrumb text — 20 uncapped React warnings would bloat every app.crash", () => {
    const { sink, crumbs } = fakeSink();
    const fakeConsole: any = { error: vi.fn(), warn: vi.fn() };

    captureConsole(sink, fakeConsole);
    fakeConsole.warn("w".repeat(5000));

    expect(crumbs[0].data.message.length).toBe(200);
  });
});
