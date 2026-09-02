import { type Call } from 'whatsapp-web.js';
import { type EngineEventCallbacks } from '../interfaces/whatsapp-engine.interface';
import { type createLogger } from '../../common/services/logger.service';
export interface WwebjsCallsHost {
    readonly logger: ReturnType<typeof createLogger>;
    isTearingDown(): boolean;
    getCallbacks(): EngineEventCallbacks;
}
export declare class WwebjsCalls {
    private readonly host;
    private static readonly LIVE_CALL_TTL_MS;
    readonly liveCalls: Map<string, {
        call: Call;
        expiresAt: number;
    }>;
    constructor(host: WwebjsCallsHost);
    handleIncomingCall(call: Call): void;
    private cacheLiveCall;
    rejectCall(callId: string): Promise<void>;
    clearLiveCalls(): void;
}
