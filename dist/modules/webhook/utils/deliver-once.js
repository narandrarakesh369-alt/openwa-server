"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postWebhookPayload = postWebhookPayload;
exports.recordTerminalFailure = recordTerminalFailure;
const ssrf_guard_1 = require("../../../common/security/ssrf-guard");
const record_delivery_failure_1 = require("./record-delivery-failure");
async function postWebhookPayload(url, body, headers, timeoutMs, fetch = ssrf_guard_1.withSafeFetch) {
    const { ok, status, statusText } = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
    }, response => ({ ok: response.ok, status: response.status, statusText: response.statusText }), { guard: (0, ssrf_guard_1.isSsrfProtectionEnabled)() });
    if (!ok)
        throw new Error(`HTTP ${status}: ${statusText}`);
    return { status, statusText };
}
async function recordTerminalFailure(failureRepository, logger, input) {
    const { error, ...row } = input;
    const errMessage = (0, ssrf_guard_1.redactSsrfError)(error);
    return (0, record_delivery_failure_1.recordWebhookDeliveryFailure)(failureRepository, logger, {
        ...row,
        lastStatusCode: (0, record_delivery_failure_1.statusCodeFromError)(errMessage),
        lastError: errMessage,
    });
}
//# sourceMappingURL=deliver-once.js.map