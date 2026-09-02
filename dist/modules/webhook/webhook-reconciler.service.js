"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookReconcilerService = void 0;
exports.resolveWebhookReconcilerOptions = resolveWebhookReconcilerOptions;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const webhook_entity_1 = require("./entities/webhook.entity");
const webhook_outbox_service_1 = require("./webhook-outbox.service");
const webhook_delivery_service_1 = require("./webhook-delivery.service");
const logger_service_1 = require("../../common/services/logger.service");
const configuration_1 = require("../../config/configuration");
function resolveWebhookReconcilerOptions(env = process.env) {
    const batch = Number(env.WEBHOOK_RECONCILE_BATCH_SIZE);
    const maxAttempts = Number(env.WEBHOOK_RECONCILE_MAX_ATTEMPTS);
    return {
        intervalMs: (0, configuration_1.resolveNonNegativeIntEnv)(env.WEBHOOK_RECONCILE_INTERVAL_MS, 60_000),
        graceMs: (0, configuration_1.resolveNonNegativeIntEnv)(env.WEBHOOK_RECONCILE_GRACE_MS, 60_000),
        batchSize: Number.isInteger(batch) && batch >= 1 ? batch : 50,
        maxAttempts: Number.isInteger(maxAttempts) && maxAttempts >= 1 ? maxAttempts : 5,
    };
}
let WebhookReconcilerService = class WebhookReconcilerService {
    webhooks;
    outbox;
    delivery;
    logger = (0, logger_service_1.createLogger)('WebhookReconcilerService');
    timer;
    sweeping = false;
    constructor(webhooks, outbox, delivery) {
        this.webhooks = webhooks;
        this.outbox = outbox;
        this.delivery = delivery;
    }
    onModuleInit() {
        const opts = resolveWebhookReconcilerOptions();
        if (opts.intervalMs <= 0) {
            this.logger.log('Webhook delivery reconciler disabled (WEBHOOK_RECONCILE_INTERVAL_MS <= 0)');
            return;
        }
        this.timer = setInterval(() => {
            this.sweep(opts).catch(err => this.logger.error('Webhook reconcile sweep failed', err instanceof Error ? err.stack : String(err)));
        }, opts.intervalMs);
        this.timer.unref?.();
    }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async sweep(opts, now = new Date()) {
        const stats = { scanned: 0, replayed: 0, failed: 0, skipped: 0 };
        if (this.sweeping)
            return stats;
        this.sweeping = true;
        try {
            const rows = await this.outbox.findStale(new Date(now.getTime() - opts.graceMs), opts.batchSize);
            stats.scanned = rows.length;
            for (const row of rows) {
                if (row.attempts >= opts.maxAttempts) {
                    await this.outbox.close(row.webhookId, row.idempotencyKey, 'failed');
                    stats.failed++;
                    continue;
                }
                const webhook = await this.webhooks.findOne({ where: { id: row.webhookId } });
                if (!webhook || !webhook.active) {
                    await this.outbox.close(row.webhookId, row.idempotencyKey, 'failed');
                    stats.skipped++;
                    continue;
                }
                await this.outbox.countAttempt(row.id, row.attempts);
                try {
                    const outcome = await this.delivery.redeliver(webhook, row.sessionId, row.event, row.idempotencyKey, row.payload);
                    if (outcome === 'failed') {
                        this.logger.warn(`Replay of ${row.event} to webhook ${row.webhookId} did not deliver`);
                        stats.failed++;
                        continue;
                    }
                    await this.outbox.close(row.webhookId, row.idempotencyKey, 'dispatched');
                    stats.replayed++;
                }
                catch (error) {
                    this.logger.warn(`Replay of ${row.event} to webhook ${row.webhookId} failed: ${String(error)}`);
                    stats.failed++;
                }
            }
        }
        finally {
            this.sweeping = false;
        }
        return stats;
    }
};
exports.WebhookReconcilerService = WebhookReconcilerService;
exports.WebhookReconcilerService = WebhookReconcilerService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(webhook_entity_1.Webhook, 'data')),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        webhook_outbox_service_1.WebhookOutboxService,
        webhook_delivery_service_1.WebhookDeliveryService])
], WebhookReconcilerService);
//# sourceMappingURL=webhook-reconciler.service.js.map