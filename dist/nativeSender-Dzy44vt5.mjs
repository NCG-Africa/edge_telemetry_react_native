import n from "@react-native-async-storage/async-storage";
const d = "https://your.telemetry.endpoint/collect", o = "telemetry_failed_events";
async function l(a) {
  const e = JSON.parse(await n.getItem(o) || "[]");
  await n.setItem(o, JSON.stringify([...e, ...a]));
}
async function i(a, e, t = 3) {
  let r = 0, c;
  for (; r < t; )
    try {
      const s = await fetch(a, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: e })
      });
      if (!s.ok)
        throw console.warn("Telemetry send failed with status:", s.status), new Error(`Telemetry send failed: ${s.status}`);
      console.log("Telemetry send succeeded, events sent:", e.length ?? 0);
      return;
    } catch (s) {
      c = s, r++, r < t && await new Promise(
        (y) => setTimeout(y, 500 * 2 ** r + Math.random() * 200)
      );
    }
  throw c;
}
function m(a = d) {
  return {
    async send(e) {
      try {
        console.log("Native sender sending events:", e.length ?? 0), await i(a, e);
      } catch (t) {
        throw console.warn("Native sender send failed after retries, persisting events:", t), await l(e), t;
      }
    },
    async onFailure(e) {
      await l(e);
    },
    async replayFailed() {
      console.log("Telemetry replayFailedNative launched"), console.log("AsyncStorage available methods:", Object.keys(n));
      const e = JSON.parse(await n.getItem(o) || "[]");
      if (e.length > 0) {
        console.log("Replaying failed events, count:", e.length), await n.removeItem(o), console.log("Failed events removed from storage, attempting to resend");
        try {
          await i(a, e);
        } catch (t) {
          throw await l(e), t;
        }
      }
    }
  };
}
async function h(a = d) {
  console.log("Telemetry replayFailedNative launched"), console.log("AsyncStorage available methods:", Object.keys(n));
  const e = JSON.parse(await n.getItem(o) || "[]");
  if (e.length > 0) {
    await n.removeItem(o);
    try {
      console.log("Replaying failed events, count:", e.length), console.log("Failed events removed from storage, attempting to resend"), await i(a, e);
    } catch (t) {
      throw console.warn("Telemetry replay failed Native Sender class:", t), await l(e), t;
    }
  }
}
export {
  m as nativeSender,
  h as replayFailedNative
};
//# sourceMappingURL=nativeSender-Dzy44vt5.mjs.map
