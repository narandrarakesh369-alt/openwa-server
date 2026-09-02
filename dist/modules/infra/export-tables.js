"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXPORT_TABLE_EXCLUSIONS = exports.EXPORT_TABLES = void 0;
function isMediaPointer(data) {
    return /^https?:\/\//i.test(data);
}
function redactWebhookCredentials(rows) {
    for (const row of rows) {
        delete row.secret;
        delete row.headers;
    }
}
function stripBodyTs(rows) {
    for (const row of rows) {
        delete row.body_ts;
    }
}
function stripInlineMediaPayload(row, exceedsBudget) {
    const raw = row.metadata;
    if (typeof raw !== 'string')
        return;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return;
    }
    if (typeof parsed !== 'object' || parsed === null)
        return;
    const bag = parsed;
    const media = bag.media;
    if (!media || typeof media.data !== 'string' || isMediaPointer(media.data))
        return;
    if (!exceedsBudget(Buffer.byteLength(media.data, 'utf8')))
        return;
    const { data, ...withoutPayload } = media;
    bag.media = {
        ...withoutPayload,
        omitted: true,
        sizeBytes: media.sizeBytes ?? Buffer.byteLength(data, 'base64'),
    };
    row.metadata = JSON.stringify(bag);
}
function stripBatchInlineMedia(row, exceedsBudget) {
    const raw = row.messages;
    if (typeof raw !== 'string')
        return;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return;
    }
    if (!Array.isArray(parsed))
        return;
    let stripped = false;
    for (const entry of parsed) {
        const content = entry?.content;
        if (typeof content !== 'object' || content === null)
            continue;
        for (const key of ['image', 'video', 'audio', 'document']) {
            const media = content[key];
            if (!media || typeof media !== 'object' || typeof media.base64 !== 'string')
                continue;
            if (!exceedsBudget(Buffer.byteLength(media.base64, 'utf8')))
                continue;
            delete media.base64;
            stripped = true;
        }
    }
    if (stripped)
        row.messages = JSON.stringify(parsed);
}
function defineExportTable(table) {
    return table;
}
exports.EXPORT_TABLES = [
    defineExportTable({ key: 'sessions', table: 'sessions' }),
    defineExportTable({ key: 'webhooks', table: 'webhooks', afterRead: redactWebhookCredentials }),
    defineExportTable({
        key: 'messages',
        table: 'messages',
        optional: true,
        afterRead: stripBodyTs,
        inlineMedia: {
            bucket: 'messages',
            newestFirst: (row) => Number(row.timestamp),
            strip: stripInlineMediaPayload,
        },
    }),
    defineExportTable({
        key: 'messageBatches',
        table: 'message_batches',
        optional: true,
        inlineMedia: {
            bucket: 'messageBatches',
            newestFirst: (row) => Date.parse(row.created_at),
            strip: stripBatchInlineMedia,
        },
    }),
    defineExportTable({ key: 'templates', table: 'templates', optional: true }),
    defineExportTable({ key: 'baileysStoredMessages', table: 'baileys_stored_messages', optional: true }),
    defineExportTable({ key: 'lidMappings', table: 'lid_mappings', optional: true }),
    defineExportTable({ key: 'pluginInstances', table: 'plugin_instances', optional: true }),
    defineExportTable({ key: 'conversationMappings', table: 'conversation_mappings', optional: true }),
    defineExportTable({ key: 'ingressEvents', table: 'ingress_events', optional: true }),
    defineExportTable({ key: 'webhookDeliveryFailures', table: 'webhook_delivery_failures', optional: true }),
    defineExportTable({ key: 'webhookOutboxEvents', table: 'webhook_outbox_events', optional: true }),
    defineExportTable({
        key: 'integrationDeliveryFailures',
        table: 'integration_delivery_failures',
        optional: true,
    }),
    defineExportTable({ key: 'statusUpdates', table: 'status_updates', optional: true }),
    defineExportTable({ key: 'automationRules', table: 'automation_rules', optional: true }),
];
exports.EXPORT_TABLE_EXCLUSIONS = {};
//# sourceMappingURL=export-tables.js.map