import { Webhook } from '../entities/webhook.entity';
import type { WebhookFilters } from '../filters/filter-types';
export declare const WEBHOOK_RESERVED_EVENTS: readonly [];
export declare const WEBHOOK_EVENTS: readonly ["message.received", "message.sent", "message.ack", "message.failed", "message.revoked", "message.reaction", "message.edited", "status.received", "session.status", "session.qr", "session.authenticated", "session.disconnected", "session.reconnect_loop", "session.restriction", "presence.update", "group.join", "group.leave", "group.update", "group.join_request", "call.received", "call.accepted", "call.rejected", "call.missed"];
export declare class CreateWebhookDto {
    url: string;
    events?: string[];
    secret?: string;
    headers?: Record<string, string>;
    filters?: WebhookFilters | null;
    retryCount?: number;
}
export declare class UpdateWebhookDto {
    url?: string;
    events?: string[];
    secret?: string;
    headers?: Record<string, string>;
    filters?: WebhookFilters | null;
    active?: boolean;
    retryCount?: number;
}
export declare class WebhookResponseDto {
    id: string;
    sessionId: string;
    url: string;
    events: string[];
    filters?: WebhookFilters | null;
    active: boolean;
    retryCount: number;
    lastTriggeredAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    static fromEntity(entity: Webhook): WebhookResponseDto;
    static fromEntities(entities: Webhook[]): WebhookResponseDto[];
}
export declare class WebhookDeliveryFailureDto {
    id: string;
    webhookId: string;
    sessionId: string;
    event: string;
    url: string;
    idempotencyKey?: string | null;
    deliveryId?: string | null;
    attempts: number;
    lastStatusCode?: number | null;
    lastError: string;
    createdAt: Date;
}
export declare class WebhookTestResponseDto {
    success: boolean;
    statusCode?: number;
    error?: string;
}
