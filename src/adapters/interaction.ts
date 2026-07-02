import { Telemetry } from "../core/telemetry";

/**
 * Best-effort native tap capture → v3 `user.interaction` (#33). No DOM `target_tag`/
 * `target_class` — those are web-only; their absence on native is intentional, not an error.
 *
 * RN has no global tap stream, so `responderProps()` returns a top-level responder-capture
 * handler the consumer spreads onto their app root <View>. It records the tap and returns
 * false, so it observes the gesture without ever claiming it.
 */
export class InteractionEmitter {
  constructor(private telemetry: Telemetry) {}

  record(type: string = "tap", extra?: Record<string, any>): Promise<void> {
    const screen = (this.telemetry as any).currentScreen;
    return this.telemetry.log("user.interaction", {
      "interaction.type": type,
      ...(screen ? { "interaction.screen": screen } : {}),
      ...extra,
    });
  }

  // Spread onto the app root <View>: each tap → user.interaction, gesture never stolen.
  responderProps() {
    return {
      onStartShouldSetResponderCapture: () => {
        this.record("tap");
        return false;
      },
    };
  }
}
