// Shared delegation base for TelemetryWeb / TelemetryNative.
// Both platform classes lazily build a core `Telemetry` behind `instancePromise`
// and forward every public call to it; these methods are identical across platforms.
// Platform-specific capture (getDeviceInfo, track*, navigation/screen) stays in the
// subclasses because each imports a different platform adapter.

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

    async generateUserId() {
        const inst = await this.instancePromise;
        return inst.generateUserId();
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
}
