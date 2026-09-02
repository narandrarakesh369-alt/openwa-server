import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Webhook } from './entities/webhook.entity';
import { WebhookOutboxService } from './webhook-outbox.service';
import { WebhookDeliveryFailure } from './entities/webhook-delivery-failure.entity';
import { LidMappingStoreService } from '../../engine/identity/lid-mapping-store.service';
import { HookManager } from '../../core/hooks';
export interface WebhookPayload {
    event: string;
    timestamp: string;
    sessionId: string;
    idempotencyKey: string;
    deliveryId: string;
    data: Record<string, unknown>;
}
export interface WebhookJobData {
    webhookId: string;
    url: string;
    event: string;
    payload: WebhookPayload;
    headers: Record<string, string>;
    attempt: number;
    maxRetries: number;
}
export type WebhookDeliveryOutcome = 'delivered' | 'enqueued' | 'cancelled' | 'failed';
export declare class WebhookDeliveryService implements OnModuleInit, OnModuleDestroy {
    private readonly webhookRepository;
    private readonly failureRepository;
    private readonly configService;
    private readonly hookManager;
    private readonly outbox;
    private readonly lidMappingStore?;
    private readonly webhookQueue?;
    private readonly logger;
    private readonly queueEnabled;
    private readonly dispatchLimiter;
    private readonly inFlightDeliveries;
    private readonly pendingBookkeeping;
    constructor(webhookRepository: Repository<Webhook>, failureRepository: Repository<WebhookDeliveryFailure>, configService: ConfigService, hookManager: HookManager, outbox: WebhookOutboxService, lidMappingStore?: LidMappingStoreService | undefined, webhookQueue?: Queue<WebhookJobData> | undefined);
    onModuleInit(): void;
    onModuleDestroy(): Promise<void>;
    dispatch(sessionId: string, event: string, data: Record<string, unknown>): Promise<void>;
    private loadActiveWebhooks;
    private filterMatchingWebhooks;
    private recordUndelivered;
    private preflightDelivery;
    private deliverOne;
    private enqueueWithFallback;
    private deliverDirect;
    private dispatchWithLimit;
    redeliver(webhook: Webhook, sessionId: string, event: string, idempotencyKey: string, data: Record<string, unknown>): Promise<WebhookDeliveryOutcome>;
    private deliverWebhook;
    sanitizeCustomHeaders(custom: Record<string, string> | null | undefined): Record<string, string>;
    generateSignature(payload: string, secret: string): string;
}
