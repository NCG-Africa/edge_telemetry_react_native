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

  it("ships the engine's stack byte-for-byte under the cap — metro-symbolicate consumes it raw", () => {
    // A real Hermes trace: `line` is a constant 1 and the column is a bytecode offset, so any
    // normalization, reformatting or path rewriting breaks the resolve (§4.8).
    const hermes = [
      "TypeError: undefined is not a function",
      "    at anonymous (address at index.android.bundle:1:132161)",
      "    at p (address at index.android.bundle:1:2921)",
      "    at forEach (native)",
    ].join("\n");

    const a = buildErrorAttributes("global_handler", { stack: hermes });
    expect(a["error.stacktrace"]).toBe(hermes);   // identical, not merely equivalent
  });

  it("cuts a real Hermes trace on a frame boundary — mixed frame widths, header line and all", () => {
    // Frames of genuinely different widths, so the cut cannot land on a boundary by luck the
    // way a repeated-frame fixture can. `line` is a constant 1 and the column is a bytecode
    // offset: half of `1:132161` resolves to a different, wrong place rather than failing.
    const header = "TypeError: undefined is not a function (evaluating 'r.checkout()')";
    const frames = [
      "    at anonymous (address at index.android.bundle:1:132161)",
      "    at p (address at index.android.bundle:1:2921)",
      "    at forEach (native)",
      "    at renderWithHooks (address at index.android.bundle:1:441209)",
      "    at Wl (address at index.android.bundle:1:87233)",
    ];
    const stack = [header, ...Array.from({ length: 12 }, (_, i) => frames[i % frames.length])].join("\n");
    expect(stack.length).toBeGreaterThan(2000 / 4);   // fixture is real-shaped, not padded

    const out = buildErrorAttributes("global_handler", { stack: "x".repeat(1500) + "\n" + stack })["error.stacktrace"] as string;

    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out.endsWith("\n… [truncated]")).toBe(true);
    // Every surviving line is a whole line of the original — no half-frame anywhere.
    const original = new Set(("x".repeat(1500) + "\n" + stack).split("\n"));
    for (const line of out.replace("\n… [truncated]", "").split("\n")) {
      expect(original.has(line)).toBe(true);
    }
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

describe("the Error.stackTraceLimit advisory — §4.8, once per process, dev only", () => {
  /** The flag is module state and per-process by design, so each case gets a fresh module. */
  async function freshModule() {
    vi.resetModules();
    return await import("./crashCapture");
  }

  it("is said exactly once, however many stacks are captured", async () => {
    vi.stubGlobal("__DEV__", true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { buildErrorAttributes: build } = await freshModule();

    build("global_handler", new Error("boom"));
    build("reported", new Error("again"));
    build("unhandled_rejection", new Error("and again"));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("Error.stackTraceLimit");
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it("is silent in production — a shipped app's console is not ours to write to", async () => {
    vi.stubGlobal("__DEV__", false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { buildErrorAttributes: build } = await freshModule();

    build("global_handler", new Error("boom"));

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it("does not burn its one shot on a production call — dev is still told later", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { buildErrorAttributes: build } = await freshModule();

    vi.stubGlobal("__DEV__", false);
    build("global_handler", new Error("in prod"));
    expect(warn).not.toHaveBeenCalled();

    vi.stubGlobal("__DEV__", true);
    build("global_handler", new Error("in dev"));
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it("says nothing for a stackless error — the advice is about stacks", async () => {
    vi.stubGlobal("__DEV__", true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { buildErrorAttributes: build } = await freshModule();

    build("reported", { message: "no stack here" });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it("never assigns Error.stackTraceLimit — advising is the whole point", async () => {
    vi.stubGlobal("__DEV__", true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = Error.stackTraceLimit;
    let assigned = false;
    Object.defineProperty(Error, "stackTraceLimit", {
      configurable: true,
      get: () => before,
      set: () => { assigned = true; },
    });

    try {
      const { buildErrorAttributes: build } = await freshModule();
      build("global_handler", new Error("boom"));
      expect(assigned).toBe(false);
    } finally {
      Object.defineProperty(Error, "stackTraceLimit", { configurable: true, writable: true, value: before });
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
