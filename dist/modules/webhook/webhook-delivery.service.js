"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookDeliveryService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const crypto = __importStar(require("crypto"));
const promises_1 = require("node:timers/promises");
const webhook_entity_1 = require("./entities/webhook.entity");
const webhook_outbox_service_1 = require("./webhook-outbox.service");
const webhook_delivery_failure_entity_1 = require("./entities/webhook-delivery-failure.entity");
const record_delivery_failure_1 = require("./utils/record-delivery-failure");
const deliver_once_1 = require("./utils/deliver-once");
const logger_service_1 = require("../../common/services/logger.service");
const inline_media_1 = require("../../common/utils/inline-media");
const webhook_delivery_metrics_1 = require("../../common/metrics/webhook-delivery-metrics");
const queue_names_1 = require("../queue/queue-names");
const idempotency_util_1 = require("./utils/idempotency.util");
const filter_evaluator_1 = require("./filters/filter-evaluator");
const lid_mapping_store_service_1 = require("../../engine/identity/lid-mapping-store.service");
const ssrf_guard_1 = require("../../common/security/ssrf-guard");
const hooks_1 = require("../../core/hooks");
const concurrency_limiter_1 = require("../../common/utils/concurrency-limiter");
const DEFAULT_WEBHOOK_MAX_PAYLOAD_BYTES = 1024 * 1024;
const DEFAULT_WEBHOOK_SHUTDOWN_DRAIN_MS = 5000;
let WebhookDeliveryService = class WebhookDeliveryService {
    webhookRepository;
    failureRepository;
    configService;
    hookManager;
    outbox;
    lidMappingStore;
    webhookQueue;
    logger = (0, logger_service_1.createLogger)('WebhookDelivery');
    queueEnabled;
    dispatchLimiter;
    inFlightDeliveries = new Map();
    pendingBookkeeping = new Set();
    constructor(webhookRepository, failureRepository, configService, hookManager, outbox, lidMappingStore, webhookQueue) {
        this.webhookRepository = webhookRepository;
        this.failureRepository = failureRepository;
        this.configService = configService;
        this.hookManager = hookManager;
        this.outbox = outbox;
        this.lidMappingStore = lidMappingStore;
        this.webhookQueue = webhookQueue;
        this.queueEnabled = configService.get('queue.enabled', false);
        this.dispatchLimiter = new concurrency_limiter_1.ConcurrencyLimiter(this.configService.get('webhook.dispatchConcurrency', 16), this.configService.get('webhook.dispatchMaxQueued', 1000));
    }
    onModuleInit() {
        const drainMs = this.configService.get('webhook.shutdownDrainMs', DEFAULT_WEBHOOK_SHUTDOWN_DRAIN_MS);
        const deliveryTimeoutMs = this.configService.get('webhook.timeout', 10_000);
        if (Number.isFinite(drainMs) && Number.isFinite(deliveryTimeoutMs) && drainMs < deliveryTimeoutMs) {
            this.logger.warn(`WEBHOOK_SHUTDOWN_DRAIN_MS (${drainMs}ms) is shorter than WEBHOOK_TIMEOUT (${deliveryTimeoutMs}ms) — ` +
                `an in-flight delivery that takes nearly the full timeout will be abandoned at shutdown. ` +
                `Raise WEBHOOK_SHUTDOWN_DRAIN_MS to at least WEBHOOK_TIMEOUT if you want shutdown to wait for deliveries to complete.`);
        }
    }
    async onModuleDestroy() {
        if (!this.queueEnabled) {
            this.dispatchLimiter.close();
        }
        const drainMs = Math.max(0, this.configService.get('webhook.shutdownDrainMs', DEFAULT_WEBHOOK_SHUTDOWN_DRAIN_MS));
        const deadline = Date.now() + drainMs;
        while (this.dispatchLimiter.activeCount > 0 || this.pendingBookkeeping.size > 0) {
            const remaining = deadline - Date.now();
            if (remaining <= 0)
                break;
            await (0, promises_1.setTimeout)(Math.min(50, remaining));
        }
        for (const lost of this.inFlightDeliveries.values()) {
            this.logger.error('Webhook delivery abandoned during shutdown', undefined, {
                ...lost,
                action: 'webhook_delivery_abandoned_shutdown',
            });
        }
        this.inFlightDeliveries.clear();
    }
    async dispatch(sessionId, event, data) {
        const webhooks = await this.loadActiveWebhooks(sessionId, event);
        const matchingWebhooks = this.filterMatchingWebhooks(webhooks, event, data);
        const occurredAt = new Date().toISOString();
        const baseIdempotencyKey = (0, idempotency_util_1.generateIdempotencyKey)(event, { ...data, sessionId }, occurredAt);
        const baseData = matchingWebhooks.length > 0
            ? (0, inline_media_1.shedInlineMedia)(data, this.configService.get('webhook.mediaInlineMaxBytes', inline_media_1.DEFAULT_WEBHOOK_MEDIA_INLINE_MAX_BYTES))
            : data;
        const ctx = { sessionId, event, baseData };
        await Promise.allSettled(matchingWebhooks.map(webhook => this.dispatchWithLimit(webhook, baseIdempotencyKey, ctx)));
    }
    async loadActiveWebhooks(sessionId, event) {
        try {
            return await this.webhookRepository.find({
                where: { sessionId, active: true },
            });
        }
        catch (error) {
            this.logger.error(`Webhook dispatch lookup failed for ${event}`, String(error), {
                sessionId,
                action: 'webhook_dispatch_lookup_failed',
            });
            return [];
        }
    }
    filterMatchingWebhooks(webhooks, event, data) {
        const resolveLid = (jid) => this.lidMappingStore?.resolveLid(jid) ?? null;
        const subscribed = webhooks.filter(w => w.events.includes(event) || w.events.includes('*'));
        const matching = subscribed.filter(w => (0, filter_evaluator_1.evaluateFilters)(w.filters, event, data, resolveLid));
        if (matching.length < subscribed.length) {
            this.logger.debug('Webhook filters suppressed a delivery', {
                action: 'webhook_filter_suppressed',
                event,
                subscribed: subscribed.length,
                suppressed: subscribed.length - matching.length,
                payloadFields: Object.keys(data).sort().join(','),
            });
        }
        return matching;
    }
    async recordUndelivered(webhook, deliveryId, idempotencyKey, error, action, ctx) {
        const { sessionId, event } = ctx;
        const lastError = (0, ssrf_guard_1.redactSsrfError)(error, this.logger, 'webhook dispatch');
        const recorded = await (0, record_delivery_failure_1.recordWebhookDeliveryFailure)(this.failureRepository, this.logger, {
            webhookId: webhook.id,
            sessionId,
            event,
            url: webhook.url,
            idempotencyKey,
            deliveryId,
            attempts: 0,
            lastStatusCode: null,
            lastError,
        });
        if (recorded) {
            (0, webhook_delivery_metrics_1.incrementWebhookDeliveryFailures)();
        }
        try {
            await this.hookManager.execute('webhook:error', { sessionId, event, webhookId: webhook.id, deliveryId, error: lastError }, { sessionId, source: 'WebhookService' });
        }
        catch (hookError) {
            this.logger.error('webhook:error hook failed while reporting an undelivered webhook', String(hookError), {
                webhookId: webhook.id,
                deliveryId,
                action: 'webhook_error_hook_failed',
            });
        }
        this.logger.error(`Webhook ${webhook.id} was not dispatched`, lastError, {
            webhookId: webhook.id,
            deliveryId,
            action,
        });
    }
    async preflightDelivery(webhook, deliveryId, idempotencyKey, ctx) {
        const { sessionId, event, baseData } = ctx;
        try {
            const payload = {
                event,
                timestamp: new Date().toISOString(),
                sessionId,
                idempotencyKey,
                deliveryId,
                data: structuredClone(baseData),
            };
            const payloadTimestamp = payload.timestamp;
            const { continue: shouldContinue, data: hookResult } = await this.hookManager.execute('webhook:before', { sessionId, event, payload }, { sessionId, source: 'WebhookService' });
            if (!shouldContinue) {
                this.logger.debug(`Webhook dispatch cancelled by plugin for ${event}`, {
                    webhookId: webhook.id,
                    action: 'webhook_cancelled_by_plugin',
                });
                return 'cancelled';
            }
            const finalPayload = hookResult?.payload ?? payload;
            finalPayload.event = event;
            finalPayload.sessionId = sessionId;
            finalPayload.timestamp = payloadTimestamp;
            finalPayload.idempotencyKey = idempotencyKey;
            finalPayload.deliveryId = deliveryId;
            const maxPayloadBytes = this.configService.get('webhook.maxPayloadBytes', DEFAULT_WEBHOOK_MAX_PAYLOAD_BYTES);
            let body = JSON.stringify(finalPayload);
            let payloadBytes = Buffer.byteLength(body, 'utf8');
            if (payloadBytes > maxPayloadBytes) {
                const shedData = (0, inline_media_1.shedInlineMedia)(finalPayload.data, 0);
                if (shedData !== finalPayload.data) {
                    finalPayload.data = shedData;
                    body = JSON.stringify(finalPayload);
                    payloadBytes = Buffer.byteLength(body, 'utf8');
                }
            }
            if (payloadBytes > maxPayloadBytes) {
                await this.recordUndelivered(webhook, deliveryId, idempotencyKey, new Error(`Webhook payload is ${payloadBytes} bytes after webhook:before hooks, exceeding the ${maxPayloadBytes}-byte cap`), 'webhook_payload_oversize', ctx);
                return null;
            }
            const headers = {
                ...this.sanitizeCustomHeaders(webhook.headers),
                'Content-Type': 'application/json',
                'User-Agent': 'OpenWA-Webhook/1.0.0',
                'X-OpenWA-Event': event,
                'X-OpenWA-Idempotency-Key': idempotencyKey,
                'X-OpenWA-Delivery-Id': deliveryId,
                'X-OpenWA-Retry-Count': '0',
            };
            return { finalPayload, body, headers };
        }
        catch (error) {
            await this.recordUndelivered(webhook, deliveryId, idempotencyKey, error, 'webhook_dispatch_preflight_failed', ctx);
            return null;
        }
    }
    async deliverOne(webhook, deliveryId, idempotencyKey, ctx) {
        const preflight = await this.preflightDelivery(webhook, deliveryId, idempotencyKey, ctx);
        if (preflight === 'cancelled') {
            return 'cancelled';
        }
        if (!preflight) {
            return 'failed';
        }
        const { finalPayload, body, headers } = preflight;
        if (this.queueEnabled && this.webhookQueue) {
            return this.enqueueWithFallback(webhook, finalPayload, body, headers, deliveryId, idempotencyKey, ctx);
        }
        return this.deliverDirect(webhook, finalPayload, body, headers, deliveryId, ctx);
    }
    async enqueueWithFallback(webhook, finalPayload, body, headers, deliveryId, idempotencyKey, ctx) {
        const { sessionId, event } = ctx;
        try {
            const signature = webhook.secret ? this.generateSignature(body, webhook.secret) : '';
            if (webhook.secret) {
                headers['X-OpenWA-Signature'] = signature;
            }
            const jobData = {
                webhookId: webhook.id,
                url: webhook.url,
                event,
                payload: finalPayload,
                headers,
                attempt: 1,
                maxRetries: webhook.retryCount,
            };
            await this.webhookQueue.add(`webhook-${webhook.id}`, jobData, {
                jobId: deliveryId,
                attempts: webhook.retryCount,
                backoff: {
                    type: 'exponential',
                    delay: this.configService.get('webhook.retryDelay', 5000),
                },
            });
            await this.hookManager.execute('webhook:queued', { sessionId, event, webhookId: webhook.id, deliveryId }, { sessionId, source: 'WebhookService' });
            this.logger.debug(`Webhook job queued for ${webhook.id}`, {
                webhookId: webhook.id,
                event,
                idempotencyKey,
                deliveryId,
                action: 'webhook_queued',
            });
        }
        catch (error) {
            await this.hookManager.execute('webhook:error', { sessionId, event, webhookId: webhook.id, error: `Queue failed: ${String(error)}` }, { sessionId, source: 'WebhookService' });
            this.logger.error(`Failed to queue webhook ${webhook.id}`, String(error), {
                webhookId: webhook.id,
                action: 'webhook_queue_failed',
            });
            try {
                await this.deliverWebhook(webhook, finalPayload, headers, body);
                await this.hookManager.execute('webhook:delivered', { sessionId, event, webhookId: webhook.id, deliveryId, fallback: 'queue_failed' }, { sessionId, source: 'WebhookService' });
                await this.hookManager.execute('webhook:after', { sessionId, event, webhookId: webhook.id, success: true, fallback: 'queue_failed' }, { sessionId, source: 'WebhookService' });
            }
            catch (fallbackError) {
                await this.hookManager.execute('webhook:error', {
                    sessionId,
                    event,
                    webhookId: webhook.id,
                    error: `Queue fallback delivery failed: ${(0, ssrf_guard_1.redactSsrfError)(fallbackError, this.logger, 'webhook fallback delivery')}`,
                }, { sessionId, source: 'WebhookService' });
                this.logger.error(`Queue fallback delivery failed for webhook ${webhook.id}`, String(fallbackError), {
                    webhookId: webhook.id,
                    action: 'webhook_queue_fallback_failed',
                });
                return 'failed';
            }
            return 'delivered';
        }
        return 'enqueued';
    }
    async deliverDirect(webhook, finalPayload, body, headers, deliveryId, ctx) {
        const { sessionId, event } = ctx;
        try {
            await this.deliverWebhook(webhook, finalPayload, headers, body);
            await this.hookManager.execute('webhook:delivered', { sessionId, event, webhookId: webhook.id, deliveryId }, { sessionId, source: 'WebhookService' });
            await this.hookManager.execute('webhook:after', { sessionId, event, webhookId: webhook.id, success: true }, { sessionId, source: 'WebhookService' });
        }
        catch (error) {
            await this.hookManager.execute('webhook:error', { sessionId, event, webhookId: webhook.id, error: (0, ssrf_guard_1.redactSsrfError)(error, this.logger, 'webhook delivery') }, { sessionId, source: 'WebhookService' });
            this.logger.error(`Failed to deliver webhook ${webhook.id}`, String(error), {
                webhookId: webhook.id,
                action: 'webhook_delivery_failed',
            });
            return 'failed';
        }
        return 'delivered';
    }
    async dispatchWithLimit(webhook, baseIdempotencyKey, ctx) {
        const { sessionId, event } = ctx;
        const deliveryId = (0, idempotency_util_1.generateDeliveryId)();
        const idempotencyKey = `${baseIdempotencyKey}_${webhook.id}`;
        await this.outbox.open({
            webhookId: webhook.id,
            sessionId,
            event,
            idempotencyKey,
            deliveryId,
            payload: ctx.baseData,
        });
        await this.dispatchLimiter
            .run(async () => {
            this.inFlightDeliveries.set(deliveryId, {
                webhookId: webhook.id,
                sessionId,
                event,
                idempotencyKey,
                url: webhook.url,
            });
            try {
                await this.deliverOne(webhook, deliveryId, idempotencyKey, ctx);
                await this.outbox.close(webhook.id, idempotencyKey, 'dispatched');
            }
            finally {
                this.inFlightDeliveries.delete(deliveryId);
            }
        })
            .catch(async (error) => {
            if (error instanceof Error && error.message === 'ConcurrencyLimiter queue full') {
                await this.recordUndelivered(webhook, deliveryId, idempotencyKey, error, 'webhook_dispatch_capacity_exceeded', ctx);
                return;
            }
            if (error instanceof Error && error.message === 'ConcurrencyLimiter closed') {
                const record = this.recordUndelivered(webhook, deliveryId, idempotencyKey, error, 'webhook_dispatch_shutdown', ctx);
                this.pendingBookkeeping.add(record);
                try {
                    await record;
                }
                finally {
                    this.pendingBookkeeping.delete(record);
                }
                return;
            }
            throw error;
        });
    }
    async redeliver(webhook, sessionId, event, idempotencyKey, data) {
        const deliveryId = (0, idempotency_util_1.generateDeliveryId)();
        return this.deliverOne(webhook, deliveryId, idempotencyKey, { sessionId, event, baseData: data });
    }
    async deliverWebhook(webhook, payload, headers, body, attempt = 1) {
        headers['X-OpenWA-Retry-Count'] = String(attempt - 1);
        if (webhook.secret && !headers['X-OpenWA-Signature']) {
            headers['X-OpenWA-Signature'] = this.generateSignature(body, webhook.secret);
        }
        try {
            await (0, deliver_once_1.postWebhookPayload)(webhook.url, body, headers, this.configService.get('webhook.timeout', 10000));
            try {
                await this.webhookRepository.update(webhook.id, {
                    lastTriggeredAt: new Date(),
                });
            }
            catch (bookkeepingError) {
                this.logger.error(`Webhook delivered to ${webhook.id} but lastTriggeredAt update failed`, bookkeepingError instanceof Error ? bookkeepingError.message : String(bookkeepingError), { webhookId: webhook.id, deliveryId: payload.deliveryId, action: 'webhook_bookkeeping_failed' });
            }
            this.logger.debug(`Webhook delivered to ${webhook.id}`, {
                webhookId: webhook.id,
                deliveryId: payload.deliveryId,
                action: 'webhook_delivered',
            });
        }
        catch (error) {
            this.logger.error(`Webhook delivery failed for ${webhook.id}`, String(error), {
                webhookId: webhook.id,
                attempt,
                deliveryId: payload.deliveryId,
                action: 'webhook_delivery_failed',
            });
            if (attempt < webhook.retryCount) {
                const delay = this.configService.get('webhook.retryDelay', 5000);
                await (0, promises_1.setTimeout)(delay * attempt);
                return this.deliverWebhook(webhook, payload, headers, body, attempt + 1);
            }
            const recorded = await (0, deliver_once_1.recordTerminalFailure)(this.failureRepository, this.logger, {
                webhookId: webhook.id,
                sessionId: payload.sessionId,
                event: payload.event,
                url: webhook.url,
                idempotencyKey: payload.idempotencyKey,
                deliveryId: payload.deliveryId,
                attempts: attempt,
                error,
            });
            if (recorded) {
                (0, webhook_delivery_metrics_1.incrementWebhookDeliveryFailures)();
            }
            throw error;
        }
    }
    sanitizeCustomHeaders(custom) {
        const safe = {};
        for (const [key, value] of Object.entries(custom ?? {})) {
            if (!/^(content-type|x-openwa-)/i.test(key)) {
                safe[key] = value;
            }
        }
        return safe;
    }
    generateSignature(payload, secret) {
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(payload);
        return `sha256=${hmac.digest('hex')}`;
    }
};
exports.WebhookDeliveryService = WebhookDeliveryService;
exports.WebhookDeliveryService = WebhookDeliveryService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(webhook_entity_1.Webhook, 'data')),
    __param(1, (0, typeorm_1.InjectRepository)(webhook_delivery_failure_entity_1.WebhookDeliveryFailure, 'data')),
    __param(5, (0, common_1.Optional)()),
    __param(6, (0, common_1.Optional)()),
    __param(6, (0, bullmq_1.InjectQueue)(queue_names_1.QUEUE_NAMES.WEBHOOK)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        config_1.ConfigService,
        hooks_1.HookManager,
        webhook_outbox_service_1.WebhookOutboxService,
        lid_mapping_store_service_1.LidMappingStoreService,
        bullmq_2.Queue])
], WebhookDeliveryService);
//# sourceMappingURL=webhook-delivery.service.js.map