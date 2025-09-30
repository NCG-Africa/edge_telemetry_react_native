import { Sender } from '../core/telemetry';
export declare function webSender(endpoint?: string, retryCount?: number): Sender;
export declare function replayFailedWeb(endpoint?: string, retryCount?: number): Promise<void> | undefined;
