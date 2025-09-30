import { Sender } from '../core/telemetry';
export declare function nativeSender(endpoint?: string): Sender;
export declare function replayFailedNative(endpoint?: string): Promise<void>;
