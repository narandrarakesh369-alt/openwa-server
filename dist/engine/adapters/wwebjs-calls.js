"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WwebjsCalls = void 0;
const call_not_found_error_1 = require("../../common/errors/call-not-found.error");
class WwebjsCalls {
    host;
    static LIVE_CALL_TTL_MS = 2 * 60_000;
    liveCalls = new Map();
    constructor(host) {
        this.host = host;
    }
    handleIncomingCall(call) {
        try {
            if (this.host.isTearingDown() || !call?.id || !call.from) {
                return;
            }
            if (call.fromMe) {
                return;
            }
            if (!this.cacheLiveCall(call.id, call)) {
                return;
            }
            const payload = {
                callId: call.id,
                from: call.from ?? '',
                isVideo: call.isVideo === true,
                isGroup: call.isGroup === true,
                timestamp: typeof call.timestamp === 'number' && call.timestamp > 0
                    ? Math.floor(call.timestamp)
                    : Math.floor(Date.now() / 1000),
            };
            this.host.getCallbacks().onCall?.(payload);
        }
        catch (error) {
            this.host.logger.error('Error processing call event', String(error));
        }
    }
    cacheLiveCall(callId, call) {
        const now = Date.now();
        for (const [id, entry] of this.liveCalls) {
            if (entry.expiresAt <= now) {
                this.liveCalls.delete(id);
            }
        }
        const isNewCall = !this.liveCalls.has(callId);
        this.liveCalls.set(callId, { call, expiresAt: now + WwebjsCalls.LIVE_CALL_TTL_MS });
        return isNewCall;
    }
    async rejectCall(callId) {
        const entry = this.liveCalls.get(callId);
        this.liveCalls.delete(callId);
        if (!entry || entry.expiresAt <= Date.now()) {
            throw new call_not_found_error_1.CallNotFoundError(callId);
        }
        await entry.call.reject();
    }
    clearLiveCalls() {
        this.liveCalls.clear();
    }
}
exports.WwebjsCalls = WwebjsCalls;
//# sourceMappingURL=wwebjs-calls.js.map