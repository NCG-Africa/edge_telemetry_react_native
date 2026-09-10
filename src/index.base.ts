// Shared delegation base for TelemetryWeb / TelemetryNative.
// Both platform classes lazily build a core `Telemetry` behind `instancePromise`
// and forward every public call to it; these methods are identical across platforms.
// Platform-specific capture (getDeviceInfo, track*, screen) stays in the subclasses
// because each imports a different platform adapter.

import { debug } from "./core/debug";

type ProfileInput = {
    userId?: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    avatar?: string;
    customAttributes?: Record<string, any>;
};

export abstract class TelemetryBase {
    protected instancePromise!: Promise<any>;

    async log(event: string, data?: Record<string, any>) {
        const inst = await this.instancePromise;
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

    async trackErrors(options?: { captureConsole?: boolean }) {
        const { CrashHandlerNative } = await import("./adapters/native/crashHandlerNative.native");
        const inst = await this.instancePromise;
        const crashHandler = new CrashHandlerNative(inst);
        return inst.trackErrors(crashHandler, options);
    }

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

    // EdgeRum-style identify(): emits user.profile.update. It never touches `user.id`,
    // which is consumer-owned and absent until setUserId/setUserProfile supplies one (#91).
    async identify(profile: { name?: string; email?: string; phone?: string; avatar?: string; customAttributes?: Record<string, any> }) {
        const inst = await this.instancePromise;
        return inst.identify(profile);
    }
}
