import { describe, it, expect, vi, afterEach } from "vitest";
import {
  TRACEPARENT,
  normalizeAllowlist,
  allowsHost,
  parseTraceparent,
  formatTraceparent,
  readHeader,
  withHeader,
} from "./traceHeader";

// #99 — the pure half of §6.4/§6.5. The wire-level behaviour is asserted through the public
// API in traceparent.web.test.ts / traceparent.native.test.ts; this file pins the rules that
// are cheaper to falsify one function at a time.

afterEach(() => vi.unstubAllGlobals());

describe("#99 traceHostAllowlist — bare hosts, ports ignored, punycode-normalized", () => {
  it("is empty by default, so v4 is dark on upgrade", () => {
    expect(normalizeAllowlist(undefined).size).toBe(0);
    expect(allowsHost(normalizeAllowlist(undefined), "https://api.example.com/x")).toBe(false);
  });

  it("matches exactly, ignoring the port — deliberately unlike http.host", () => {
    const allow = normalizeAllowlist(["api.example.com"]);
    expect(allowsHost(allow, "https://api.example.com/v2/accounts")).toBe(true);
    expect(allowsHost(allow, "https://api.example.com:8443/v2/accounts")).toBe(true);
    expect(allowsHost(allow, "http://api.example.com:80/")).toBe(true);
    expect(allowsHost(allow, "https://other.example.com/")).toBe(false);
    expect(allowsHost(allow, "https://sub.api.example.com/")).toBe(false);   // no wildcards
  });

  it("folds a unicode entry and a unicode URL onto the same punycode host", () => {
    expect(allowsHost(normalizeAllowlist(["münchen.de"]), "https://münchen.de/x")).toBe(true);
    expect(allowsHost(normalizeAllowlist(["xn--mnchen-3ya.de"]), "https://münchen.de/x")).toBe(true);
    expect(allowsHost(normalizeAllowlist(["münchen.de"]), "https://xn--mnchen-3ya.de/x")).toBe(true);
  });

  it("case-folds the host, since hostnames are case-insensitive", () => {
    expect(allowsHost(normalizeAllowlist(["API.Example.COM"]), "https://api.example.com/")).toBe(true);
  });

  it("throws in dev on a malformed entry", () => {
    vi.stubGlobal("__DEV__", true);
    for (const bad of ["https://api.example.com", "api.example.com/v2", "api.example.com:443",
                       "*.example.com", "", "   ", 42 as any, null as any]) {
      expect(() => normalizeAllowlist([bad])).toThrow();
    }
    expect(() => normalizeAllowlist("api.example.com" as any)).toThrow();
  });

  it("drops it silently in production, keeping the good entries — a typo must not crash a bank", () => {
    vi.stubGlobal("__DEV__", false);
    const allow = normalizeAllowlist(["https://bad.example.com", "good.example.com"]);
    expect(allowsHost(allow, "https://good.example.com/x")).toBe(true);
    expect(allowsHost(allow, "https://bad.example.com/x")).toBe(false);
    expect(normalizeAllowlist("nope" as any).size).toBe(0);
  });
});

describe("#99 traceparent — one header name, W3C version 00", () => {
  const good = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

  it("parses a valid header", () => {
    expect(parseTraceparent(good)).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    });
  });

  it("rejects everything else, including all-zero ids", () => {
    for (const bad of [
      undefined, null, "", "garbage",
      "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",   // unknown version
      "00-4bf92f3577b34da6a3ce929d0e0e473-00f067aa0ba902b7-01",    // short trace id
      "00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01",   // upper case
      "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
    ]) expect(parseTraceparent(bad as any)).toBeUndefined();
  });

  it("always writes flags=01 — an unsampled session injects nothing at all instead", () => {
    expect(formatTraceparent("a".repeat(32), "b".repeat(16))).toBe(`00-${"a".repeat(32)}-${"b".repeat(16)}-01`);
  });
});

describe("#99 header access — read one name, copy never mutate", () => {
  it("reads case-insensitively out of every HeadersInit shape", () => {
    const v = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    expect(readHeader({ TraceParent: v }, TRACEPARENT)).toBe(v);
    expect(readHeader([["Traceparent", v]], TRACEPARENT)).toBe(v);
    expect(readHeader(new Map([["traceparent", v]]), TRACEPARENT)).toBe(v);   // Headers-shaped forEach
    expect(readHeader({ authorization: "Bearer x" }, TRACEPARENT)).toBeUndefined();
    expect(readHeader(undefined, TRACEPARENT)).toBeUndefined();
  });

  it("returns a copy — never-strip holds because the consumer's object is never touched", () => {
    const mine = { authorization: "Bearer x" };
    const out = withHeader(mine, TRACEPARENT, "v");
    expect(mine).toEqual({ authorization: "Bearer x" });
    expect(out).toEqual([["authorization", "Bearer x"], [TRACEPARENT, "v"]]);
  });
});
