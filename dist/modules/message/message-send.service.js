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
exports.MessageSendService = exports.DEFAULT_TEMPLATE_RENDER_MAX_CHARS = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const session_service_1 = require("../session/session.service");
const engine_registry_service_1 = require("../../engine/engine-registry.service");
const media_cap_util_1 = require("./media-cap.util");
const message_entity_1 = require("./entities/message.entity");
const hooks_1 = require("../../core/hooks");
const send_pacing_service_1 = require("./send-pacing.service");
const template_service_1 = require("../template/template.service");
const template_render_1 = require("../../common/utils/template-render");
const logger_service_1 = require("../../common/services/logger.service");
const ssrf_guard_1 = require("../../common/security/ssrf-guard");
const feature_flags_1 = require("../../config/feature-flags");
const db_errors_1 = require("../../common/utils/db-errors");
const chat_media_archive_service_1 = require("../chat-media/chat-media-archive.service");
exports.DEFAULT_TEMPLATE_RENDER_MAX_CHARS = 64 * 1024;
function isUrlPointerMetadata(metadata) {
    const data = metadata?.media?.data;
    return typeof data === 'string' && /^https?:\/\//i.test(data);
}
let MessageSendService = class MessageSendService {
    messageRepository;
    sessionService;
    engines;
    hookManager;
    templateService;
    pacing;
    configService;
    chatMediaArchive;
    logger = (0, logger_service_1.createLogger)('MessageSend');
    constructor(messageRepository, sessionService, engines, hookManager, templateService, pacing, configService, chatMediaArchive) {
        this.messageRepository = messageRepository;
        this.sessionService = sessionService;
        this.engines = engines;
        this.hookManager = hookManager;
        this.templateService = templateService;
        this.pacing = pacing;
        this.configService = configService;
        this.chatMediaArchive = chatMediaArchive;
    }
    async sendText(sessionId, dto) {
        if (dto.linkPreview === false && dto.customLinkPreview) {
            throw new common_1.BadRequestException('linkPreview: false cannot be combined with customLinkPreview');
        }
        const finalDto = await this.applySendingGate(sessionId, 'text', dto);
        const engine = this.getEngine(sessionId);
        const message = await this.saveOutgoingMessage(sessionId, {
            chatId: finalDto.chatId,
            body: finalDto.text,
            type: 'text',
            quotedMessageId: finalDto.quotedMessageId,
        });
        await this.simulateTypingIfEnabled(engine, finalDto.chatId, finalDto.text);
        let result;
        try {
            const { linkPreview, customLinkPreview, quotedMessageId } = finalDto;
            if (linkPreview !== undefined || customLinkPreview || quotedMessageId) {
                result = await engine.sendTextMessage(finalDto.chatId, finalDto.text, finalDto.mentions, {
                    ...(linkPreview === undefined ? {} : { linkPreview }),
                    ...(customLinkPreview ? { customPreview: customLinkPreview } : {}),
                    ...(quotedMessageId ? { quotedMessageId } : {}),
                });
            }
            else if (finalDto.mentions?.length) {
                result = await engine.sendTextMessage(finalDto.chatId, finalDto.text, finalDto.mentions);
            }
            else {
                result = await engine.sendTextMessage(finalDto.chatId, finalDto.text);
            }
        }
        catch (error) {
            return this.failSend(sessionId, 'text', message, finalDto, error);
        }
        return this.persistSentState(message, result);
    }
    async applySendingGate(sessionId, type, input) {
        const target = input;
        await this.pacing.assertSendAllowed(sessionId, target.chatId ?? target.toChatId);
        return (0, hooks_1.applySendingGate)(this.hookManager, sessionId, type, input, 'MessageService');
    }
    async failSend(sessionId, type, message, input, error) {
        if ((0, send_pacing_service_1.countsTowardSendBreaker)(error)) {
            this.pacing.recordSendFailure(sessionId);
        }
        await this.saveFailedMessage(message);
        const hookError = error instanceof ssrf_guard_1.SsrfBlockedError
            ? ssrf_guard_1.SSRF_BLOCKED_CLIENT_MESSAGE
            : error instanceof Error
                ? error.message
                : String(error);
        await this.hookManager.execute('message:failed', { sessionId, error: hookError, input, type }, { sessionId, source: 'MessageService' });
        throw this.toClientFacingError(error);
    }
    async sendTemplate(sessionId, dto) {
        const template = await this.templateService.resolve(sessionId, {
            templateId: dto.templateId,
            templateName: dto.templateName,
        });
        const vars = dto.vars ?? {};
        const segments = [template.header, template.body, template.footer]
            .filter((segment) => segment != null && segment.length > 0)
            .map(segment => (0, template_render_1.renderTemplate)(segment, vars));
        const text = segments.join('\n\n');
        const maxChars = this.configService?.get('template.renderMaxChars', exports.DEFAULT_TEMPLATE_RENDER_MAX_CHARS) ??
            exports.DEFAULT_TEMPLATE_RENDER_MAX_CHARS;
        if (text.length > maxChars) {
            throw new common_1.BadRequestException(`Rendered template is ${text.length} characters, over the ${maxChars}-character limit`);
        }
        return this.sendText(sessionId, {
            chatId: dto.chatId,
            text,
            mentions: dto.mentions,
            linkPreview: dto.linkPreview,
        });
    }
    async sendImage(sessionId, dto) {
        const finalDto = await this.applySendingGate(sessionId, 'image', dto);
        const engine = this.getEngine(sessionId);
        const media = this.buildMediaInput(finalDto);
        const message = await this.saveOutgoingMessage(sessionId, {
            chatId: finalDto.chatId,
            body: finalDto.caption || '',
            type: 'image',
            quotedMessageId: finalDto.quotedMessageId,
            metadata: {
                media: { mimetype: finalDto.mimetype, filename: finalDto.filename, data: media.data },
            },
        });
        let result;
        try {
            result = await engine.sendImageMessage(finalDto.chatId, media);
        }
        catch (error) {
            return this.failSend(sessionId, 'image', message, finalDto, error);
        }
        return this.persistSentState(message, result);
    }
    async sendVideo(sessionId, dto) {
        const finalDto = await this.applySendingGate(sessionId, 'video', dto);
        const engine = this.getEngine(sessionId);
        const media = this.buildMediaInput(finalDto);
        const message = await this.saveOutgoingMessage(sessionId, {
            chatId: finalDto.chatId,
            body: finalDto.caption || '',
            type: 'video',
            quotedMessageId: finalDto.quotedMessageId,
            metadata: {
                media: { mimetype: finalDto.mimetype, filename: finalDto.filename, data: media.data },
            },
        });
        let result;
        try {
            result = await engine.sendVideoMessage(finalDto.chatId, media);
        }
        catch (error) {
            return this.failSend(sessionId, 'video', message, finalDto, error);
        }
        return this.persistSentState(message, result);
    }
    async sendAudio(sessionId, dto) {
        const finalDto = await this.applySendingGate(sessionId, dto.ptt ? 'voice' : 'audio', dto);
        const engine = this.getEngine(sessionId);
        const audioDto = finalDto.ptt && !finalDto.mimetype ? { ...finalDto, mimetype: 'audio/ogg; codecs=opus' } : finalDto;
        const media = this.buildMediaInput(audioDto);
        media.ptt = finalDto.ptt;
        const message = await this.saveOutgoingMessage(sessionId, {
            chatId: finalDto.chatId,
            type: finalDto.ptt ? 'voice' : 'audio',
            metadata: {
                media: { mimetype: audioDto.mimetype, filename: finalDto.filename, data: media.data },
            },
            quotedMessageId: finalDto.quotedMessageId,
        });
        let result;
        try {
            result = await engine.sendAudioMessage(finalDto.chatId, media);
        }
        catch (error) {
            return this.failSend(sessionId, finalDto.ptt ? 'voice' : 'audio', message, finalDto, error);
        }
        return this.persistSentState(message, result);
    }
    async sendDocument(sessionId, dto) {
        const finalDto = await this.applySendingGate(sessionId, 'document', dto);
        const engine = this.getEngine(sessionId);
        const media = this.buildMediaInput(finalDto);
        const message = await this.saveOutgoingMessage(sessionId, {
            chatId: finalDto.chatId,
            body: finalDto.caption || finalDto.filename || '',
            type: 'document',
            quotedMessageId: finalDto.quotedMessageId,
            metadata: {
                media: { mimetype: finalDto.mimetype, filename: finalDto.filename, data: media.data },
            },
        });
        let result;
        try {
            result = await engine.sendDocumentMessage(finalDto.chatId, media);
        }
        catch (error) {
            return this.failSend(sessionId, 'document', message, finalDto, error);
        }
        return this.persistSentState(message, result);
    }
    async sendLocation(sessionId, dto) {
        const finalDto = await this.applySendingGate(sessionId, 'location', dto);
        const engine = this.getEngine(sessionId);
        const message = await this.saveOutgoingMessage(sessionId, {
            chatId: finalDto.chatId,
            body: `📍 ${finalDto.description || 'Location'}`,
            type: 'location',
            quotedMessageId: finalDto.quotedMessageId,
        });
        let result;
        try {
            result = await engine.sendLocationMessage(finalDto.chatId, {
                latitude: finalDto.latitude,
                longitude: finalDto.longitude,
                description: finalDto.description,
                address: finalDto.address,
                quotedMessageId: finalDto.quotedMessageId,
            });
        }
        catch (error) {
            return this.failSend(sessionId, 'location', message, finalDto, error);
        }
        return this.persistSentState(message, result);
    }
    async sendContact(sessionId, dto) {
        const finalDto = await this.applySendingGate(sessionId, 'contact', dto);
        const engine = this.getEngine(sessionId);
        const message = await this.saveOutgoingMessage(sessionId, {
            chatId: finalDto.chatId,
            body: `📇 ${finalDto.contactName}`,
            type: 'contact',
            quotedMessageId: finalDto.quotedMessageId,
        });
        let result;
        try {
            result = await engine.sendContactMessage(finalDto.chatId, {
                name: finalDto.contactName,
                number: finalDto.contactNumber,
                quotedMessageId: finalDto.quotedMessageId,
            });
        }
        catch (error) {
            return this.failSend(sessionId, 'contact', message, finalDto, error);
        }
        return this.persistSentState(message, result);
    }
    async sendPoll(sessionId, dto) {
        const finalDto = await this.applySendingGate(sessionId, 'poll', dto);
        const engine = this.getEngine(sessionId);
        const message = await this.saveOutgoingMessage(sessionId, {
            chatId: finalDto.chatId,
            body: `📊 ${finalDto.name}`,
            type: 'poll',
            quotedMessageId: finalDto.quotedMessageId,
        });
        let result;
        try {
            result = await engine.sendPollMessage(finalDto.chatId, {
                name: finalDto.name,
                options: finalDto.options,
                allowMultipleAnswers: finalDto.allowMultipleAnswers === true,
                quotedMessageId: finalDto.quotedMessageId,
            });
        }
        catch (error) {
            return this.failSend(sessionId, 'poll', message, finalDto, error);
        }
        return this.persistSentState(message, result);
    }
    async sendSticker(sessionId, dto) {
        const finalDto = await this.applySendingGate(sessionId, 'sticker', dto);
        const engine = this.getEngine(sessionId);
        const media = this.buildMediaInput(finalDto);
        const message = await this.saveOutgoingMessage(sessionId, {
            chatId: finalDto.chatId,
            type: 'sticker',
            quotedMessageId: finalDto.quotedMessageId,
            metadata: {
                media: { mimetype: finalDto.mimetype, filename: finalDto.filename, data: media.data },
            },
        });
        let result;
        try {
            result = await engine.sendStickerMessage(finalDto.chatId, media);
        }
        catch (error) {
            return this.failSend(sessionId, 'sticker', message, finalDto, error);
        }
        return this.persistSentState(message, result);
    }
    async reply(sessionId, dto) {
        const finalDto = await this.applySendingGate(sessionId, 'reply', dto);
        const engine = this.getEngine(sessionId);
        let quotedBody = '';
        try {
            const quoted = await this.messageRepository.findOne({
                where: { sessionId, waMessageId: finalDto.quotedMessageId },
            });
            quotedBody = quoted?.body || '';
        }
        catch (err) {
            this.logger.warn(`Failed to resolve quoted message ${finalDto.quotedMessageId}`, { error: String(err) });
        }
        const message = await this.saveOutgoingMessage(sessionId, {
            chatId: finalDto.chatId,
            body: finalDto.text,
            type: 'text',
            metadata: {
                quotedMessage: { id: finalDto.quotedMessageId, body: quotedBody },
            },
        });
        let result;
        try {
            result = finalDto.mentions?.length
                ? await engine.replyToMessage(finalDto.chatId, finalDto.quotedMessageId, finalDto.text, finalDto.mentions)
                : await engine.replyToMessage(finalDto.chatId, finalDto.quotedMessageId, finalDto.text);
        }
        catch (error) {
            return this.failSend(sessionId, 'reply', message, finalDto, error);
        }
        return this.persistSentState(message, result);
    }
    async forward(sessionId, dto) {
        const finalDto = await this.applySendingGate(sessionId, 'forward', dto);
        const engine = this.getEngine(sessionId);
        const message = await this.saveOutgoingMessage(sessionId, {
            chatId: finalDto.toChatId,
            body: '[Forwarded]',
            type: 'forward',
        });
        let result;
        try {
            result = await engine.forwardMessage(finalDto.fromChatId, finalDto.toChatId, finalDto.messageId);
        }
        catch (error) {
            return this.failSend(sessionId, 'forward', message, finalDto, error);
        }
        return this.persistSentState(message, result);
    }
    async saveOutgoingMessage(sessionId, data) {
        const session = await this.sessionService.findOne(sessionId);
        const message = this.messageRepository.create({
            sessionId,
            waMessageId: data.waMessageId || undefined,
            chatId: data.chatId,
            from: session?.phone || 'me',
            to: data.chatId,
            body: data.body,
            type: data.type,
            direction: message_entity_1.MessageDirection.OUTGOING,
            timestamp: data.timestamp,
            status: data.status ?? message_entity_1.MessageStatus.PENDING,
            metadata: data.quotedMessageId
                ? { ...data.metadata, quotedMessage: { id: data.quotedMessageId, body: '' } }
                : data.metadata,
        });
        const saved = await this.messageRepository.save(message).catch(async (err) => {
            const waMessageId = message.waMessageId;
            if (!waMessageId || !(0, db_errors_1.isUniqueViolation)(err))
                throw err;
            const patch = {
                status: message.status,
                timestamp: message.timestamp,
            };
            if (message.metadata && !isUrlPointerMetadata(message.metadata)) {
                patch.metadata = message.metadata;
            }
            await this.messageRepository.update({ sessionId, waMessageId }, patch);
            const surviving = await this.messageRepository.findOne({ where: { sessionId, waMessageId } });
            if (!surviving)
                throw err;
            return surviving;
        });
        this.emitPersisted(sessionId, saved);
        return saved;
    }
    emitPersisted(sessionId, message) {
        void this.hookManager
            .execute('message:persisted', { sessionId, message: { ...message } }, { sessionId, source: 'MessageService' })
            .catch(() => undefined);
        if (message.status === message_entity_1.MessageStatus.SENT && this.archiveOutboundEnabled) {
            void this.chatMediaArchive?.archive(message).catch(() => undefined);
        }
    }
    get archiveOutboundEnabled() {
        return this.configService?.get('chatMedia.archiveOutbound', false) === true;
    }
    async saveFailedMessage(message) {
        const media = message.metadata?.media;
        if (media) {
            delete media.data;
        }
        message.status = message_entity_1.MessageStatus.FAILED;
        await this.messageRepository.save(message);
        this.emitPersisted(message.sessionId, message);
    }
    async persistSentState(message, result) {
        this.pacing.recordSendSuccess(message.sessionId);
        if (result.id)
            message.waMessageId = result.id;
        message.status = message_entity_1.MessageStatus.SENT;
        message.timestamp = result.timestamp;
        try {
            await this.messageRepository.save(message);
            this.emitPersisted(message.sessionId, message);
        }
        catch (persistError) {
            if (result.id && (0, db_errors_1.isUniqueViolation)(persistError)) {
                this.logger.debug(`Send echo already persisted ${result.id}; merging state and dropping the redundant pending row`, {
                    messageId: message.id,
                });
                const patch = { status: message_entity_1.MessageStatus.SENT, timestamp: result.timestamp };
                if (message.metadata && !isUrlPointerMetadata(message.metadata)) {
                    patch.metadata = message.metadata;
                }
                await this.messageRepository
                    .update({ sessionId: message.sessionId, waMessageId: result.id }, patch)
                    .catch(err => this.logger.warn(`Merging SENT state onto the echo-persisted row failed (id=${result.id})`, {
                    error: err instanceof Error ? err.message : String(err),
                }));
                await this.messageRepository.delete({ id: message.id }).catch(() => undefined);
                const surviving = await this.messageRepository
                    .findOne({ where: { sessionId: message.sessionId, waMessageId: result.id } })
                    .catch(() => null);
                if (surviving)
                    this.emitPersisted(message.sessionId, surviving);
                void this.hookManager
                    .execute('message:deleted', { sessionId: message.sessionId, message: { ...message } }, { sessionId: message.sessionId, source: 'MessageService' })
                    .catch(() => undefined);
            }
            else {
                this.logger.warn(`Persisting SENT state failed after a successful send (id=${result.id})`, {
                    error: persistError instanceof Error ? persistError.message : String(persistError),
                });
            }
        }
        return { messageId: result.id, timestamp: result.timestamp };
    }
    getEngine(sessionId) {
        return this.engines.require(sessionId, () => new common_1.BadRequestException(`Session '${sessionId}' is not active. Start the session first.`));
    }
    async simulateTypingIfEnabled(engine, chatId, text) {
        const { simulateTyping, simulateTypingMaxMs } = (0, feature_flags_1.resolveFeatureFlags)(this.configService);
        if (!simulateTyping)
            return;
        try {
            await engine.sendChatState(chatId, 'typing');
            const maxMs = simulateTypingMaxMs;
            const planned = Math.min(maxMs, 500 + text.length * 45);
            const jittered = Math.round(planned * (0.85 + Math.random() * 0.3));
            await new Promise(resolve => setTimeout(resolve, jittered));
        }
        catch (error) {
            this.logger.warn(`simulateTyping skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    toClientFacingError(error) {
        if (error instanceof ssrf_guard_1.SsrfBlockedError) {
            this.logger.warn(`Outbound media fetch blocked by SSRF guard: ${error.message}`);
            return new common_1.BadRequestException(ssrf_guard_1.SSRF_BLOCKED_CLIENT_MESSAGE);
        }
        return error;
    }
    buildMediaInput(dto) {
        const base64 = (0, media_cap_util_1.stripBase64DataUri)(dto.base64);
        if (!dto.url && !base64) {
            throw new common_1.BadRequestException('Either url or base64 must be provided');
        }
        if (base64 && !dto.mimetype) {
            throw new common_1.BadRequestException('mimetype is required when using base64 data');
        }
        (0, media_cap_util_1.assertBase64WithinMediaCap)(base64);
        return {
            mimetype: dto.mimetype || 'application/octet-stream',
            data: base64 || dto.url,
            filename: dto.filename,
            caption: dto.caption,
            mentions: dto.mentions,
            quotedMessageId: dto.quotedMessageId,
        };
    }
};
exports.MessageSendService = MessageSendService;
exports.MessageSendService = MessageSendService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(message_entity_1.Message, 'data')),
    __param(6, (0, common_1.Optional)()),
    __param(7, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        session_service_1.SessionService,
        engine_registry_service_1.EngineRegistry,
        hooks_1.HookManager,
        template_service_1.TemplateService,
        send_pacing_service_1.SendPacingService,
        config_1.ConfigService,
        chat_media_archive_service_1.ChatMediaArchiveService])
], MessageSendService);
//# sourceMappingURL=message-send.service.js.map