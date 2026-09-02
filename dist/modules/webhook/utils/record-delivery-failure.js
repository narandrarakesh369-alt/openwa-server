"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusCodeFromError = statusCodeFromError;
exports.recordWebhookDeliveryFailure = recordWebhookDeliveryFailure;
function statusCodeFromError(message) {
    const m = /^HTTP (\d{3})\b/.exec(message);
    return m ? Number(m[1]) : null;
}
async function recordWebhookDeliveryFailure(repo, logger, input) {
    try {
        if (input.idempotencyKey) {
            const existing = await repo.count({
                where: { webhookId: input.webhookId, idempotencyKey: input.idempotencyKey },
            });
            if (existing > 0) {
                return false;
            }
        }
        await repo.insert({ ...input, lastStatusCode: input.lastStatusCode ?? null });
        return true;
    }
    catch (err) {
        logger.error('Failed to persist webhook delivery-failure record', err instanceof Error ? err.message : String(err), { webhookId: input.webhookId, deliveryId: input.deliveryId, action: 'webhook_failure_record_error' });
        return true;
    }
}
//# sourceMappingURL=record-delivery-failure.js.map