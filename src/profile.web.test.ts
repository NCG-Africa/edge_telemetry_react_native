import { describe, it, expect, vi, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";

// §4.10, #107 — the wire is the behaviour: drive the public API through an injected
// Sender and assert on names, keys, values and **absence**.
afterEach(() => vi.restoreAllMocks());

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

function harness() {
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_integration",
    endpoint: "https://x/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    batchSize: 100,
    flushIntervalMs: 0,
  });
  return { t, sent };
}

const PII = ["user.name", "user.email", "user.phone", "user.custom.plan", "user.custom_dropped"];

describe("user profile PII → user.profile.update only (§4.10)", () => {
  it("carries the profile on user.profile.update and on no other event", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.identify({
      userId: "u-1",
      name: "Ada Lovelace",
      email: "ada@x.io",
      phone: "+254700000000",
      customAttributes: { plan: "pro" },
    });
    await t.log("navigation", { "navigation.to_screen": "Home" });
    await t.flush();

    const profile = sent.find((e) => e.eventName === "user.profile.update")!;
    expect(profile).toBeDefined();
    expect(profile.attributes!["user.name"]).toBe("Ada Lovelace");
    expect(profile.attributes!["user.email"]).toBe("ada@x.io");
    expect(profile.attributes!["user.phone"]).toBe("+254700000000");
    expect(profile.attributes!["user.custom.plan"]).toBe("pro");
    // present by construction: the profile has to upsert on something
    expect(profile.attributes!["user.id"]).toBe("u-1");

    for (const e of sent.filter((ev) => ev.eventName !== "user.profile.update")) {
      for (const key of PII) expect(key in e.attributes!).toBe(false);
    }
    // the six deleted keys are gone from every event, this one included
    for (const e of sent) {
      for (const key of ["user.fullName", "user.firstName", "user.lastName",
                         "user.avatar", "user.createdAt", "user.updatedAt"]) {
        expect(key in e.attributes!).toBe(false);
      }
    }
  });

  it("identify({ userId }) sets user.id on every subsequent event", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.log("navigation", { "navigation.to_screen": "Anon" });
    await t.identify({ userId: "u-2", name: "Ada" });
    await t.log("navigation", { "navigation.to_screen": "Known" });
    await t.flush();

    const before = sent.find((e) => e.attributes?.["navigation.to_screen"] === "Anon")!;
    const after = sent.find((e) => e.attributes?.["navigation.to_screen"] === "Known")!;
    expect("user.id" in before.attributes!).toBe(false);   // omitted while anonymous (§3.2)
    expect(after.attributes!["user.id"]).toBe("u-2");
  });

  it("identify() without userId leaves user.id untouched", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.identify({ name: "Ada" });
    await t.flush();

    const profile = sent.find((e) => e.eventName === "user.profile.update")!;
    expect("user.id" in profile.attributes!).toBe(false);
  });

  it('identify({ userId: "" }) clears the id rather than shipping an empty string', async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.setUserId("u-old");
    await t.identify({ userId: "", name: "Ada" });
    await t.flush();

    // §3.2: `setUserId("")` clears, and identify() routes through it — so the profile ships
    // unkeyed rather than keyed to "". The SDK will not mint a stand-in either way.
    const a = sent.find((e) => e.eventName === "user.profile.update")!.attributes!;
    expect("user.id" in a).toBe(false);
  });

  it("ships the live profile, so setUserContact() before identify() reaches the wire", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.setUserContact("ada@x.io", "+254700000000");
    await t.identify({ userId: "u-3", name: "Ada" });
    await t.flush();

    const a = sent.find((e) => e.eventName === "user.profile.update")!.attributes!;
    expect(a["user.email"]).toBe("ada@x.io");
    expect(a["user.phone"]).toBe("+254700000000");
  });

  it("enforces 255 / 255 / 50 on the wire", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.identify({
      name: "n".repeat(400), email: "e".repeat(400), phone: "p".repeat(90),
    });
    await t.flush();

    const a = sent.find((e) => e.eventName === "user.profile.update")!.attributes!;
    expect(a["user.name"]).toHaveLength(255);
    expect(a["user.email"]).toHaveLength(255);
    expect(a["user.phone"]).toHaveLength(50);
  });

  it("a cyclic custom value is a dropped key, not a RangeError in the host's render tree", async () => {
    silenceConsole();
    const { t, sent } = harness();

    const cyclic: any = { name: "loop" };
    cyclic.self = cyclic;
    await expect(t.identify({ userId: "u-4", customAttributes: { cyclic, plan: "pro" } }))
      .resolves.not.toThrow();
    await t.flush();

    const a = sent.find((e) => e.eventName === "user.profile.update")!.attributes!;
    expect("user.custom.cyclic" in a).toBe(false);
    expect(a["user.custom.plan"]).toBe("pro");
    expect(a["user.custom_dropped"]).toBe(1);
  });

  it("an array value does not leak as a non-primitive into the bag", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.identify({ customAttributes: { tags: ["a", "b"], nested: { deep: { x: 1 } } } });
    await t.flush();

    const a = sent.find((e) => e.eventName === "user.profile.update")!.attributes!;
    expect(a["user.custom.tags"]).toBe('["a","b"]');
    expect(a["user.custom.nested"]).toBe('{"deep":{"x":1}}');
    expect("user.custom.nested.deep.x" in a).toBe(false);   // no recursion into the bag
    expect("user.custom_dropped" in a).toBe(false);         // stringified, not dropped
  });

  it("a cyclic value in a plain log() payload does not blow the stack — and stays JSON-serializable", async () => {
    silenceConsole();
    const { t, sent } = harness();

    const cyclic: any = {};
    cyclic.self = cyclic;
    await expect(t.log("navigation", { cyclic })).resolves.not.toThrow();
    await t.flush();

    const e = sent.find((ev) => ev.eventName === "navigation")!;
    expect(e).toBeDefined();
    // the depth guard has to leave the row *sendable*: a real Sender stringifies the batch,
    // so handing the cyclic object through raw would only move the throw downstream.
    expect(() => JSON.stringify(e)).not.toThrow();
  });

  it("a cycle reached through an array is sendable too — the array branch never recurses", async () => {
    silenceConsole();
    const { t, sent } = harness();

    // The hole the depth guard alone cannot see: `flattenWithPrefix` does not descend into
    // arrays, so this cycle never meets the depth counter. Passed through raw it throws in
    // the sender's JSON.stringify, where flush() swallows it and the whole batch is lost
    // silently — data loss with no counter and no log.
    const cyclic: any = {};
    cyclic.self = cyclic;
    await expect(t.log("navigation", { wrapped: [{ inner: cyclic }] })).resolves.not.toThrow();
    await t.flush();

    const e = sent.find((ev) => ev.eventName === "navigation")!;
    expect(e).toBeDefined();
    expect(() => JSON.stringify(e)).not.toThrow();
  });

  it("a plain array in a log() payload ships as JSON, not as a raw non-primitive", async () => {
    silenceConsole();
    const { t, sent } = harness();

    await t.log("navigation", { tags: ["a", "b"] });
    await t.flush();

    const a = sent.find((ev) => ev.eventName === "navigation")!.attributes!;
    expect(a.tags).toBe('["a","b"]');
  });
});
