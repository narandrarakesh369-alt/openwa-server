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
var MessageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageService = exports.DEFAULT_PIN_DURATION_SECONDS = exports.DEFAULT_MESSAGE_LIST_INLINE_MEDIA_BUDGET_BYTES = exports.DEFAULT_TEMPLATE_RENDER_MAX_CHARS = void 0;
exports.resolveMessageListInlineMediaBudgetBytes = resolveMessageListInlineMediaBudgetBytes;
exports.spendInlineMediaBudget = spendInlineMediaBudget;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const engine_registry_service_1 = require("../../engine/engine-registry.service");
const message_projector_service_1 = require("../session/message-projector.service");
const message_entity_1 = require("./entities/message.entity");
const hooks_1 = require("../../core/hooks");
const send_pacing_service_1 = require("./send-pacing.service");
const logger_service_1 = require("../../common/services/logger.service");
const wa_id_1 = require("../../engine/identity/wa-id");
const lid_mapping_store_service_1 = require("../../engine/identity/lid-mapping-store.service");
const chat_media_archive_service_1 = require("../chat-media/chat-media-archive.service");
const storage_service_1 = require("../../common/storage/storage.service");
const message_send_service_1 = require("./message-send.service");
var message_send_service_2 = require("./message-send.service");
Object.defineProperty(exports, "DEFAULT_TEMPLATE_RENDER_MAX_CHARS", { enumerable: true, get: function () { return message_send_service_2.DEFAULT_TEMPLATE_RENDER_MAX_CHARS; } });
exports.DEFAULT_MESSAGE_LIST_INLINE_MEDIA_BUDGET_BYTES = 8 * 1024 * 1024;
function resolveMessageListInlineMediaBudgetBytes() {
    const parsed = Number.parseInt(process.env.MESSAGE_LIST_INLINE_MEDIA_BUDGET_BYTES ?? '', 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : exports.DEFAULT_MESSAGE_LIST_INLINE_MEDIA_BUDGET_BYTES;
}
const MEDIA_URL_POINTER = /^https?:\/\//i;
function spendInlineMediaBudget(messages, budgetBytes) {
    let spent = 0;
    for (const message of messages) {
        const metadata = message.metadata;
        if (!metadata || typeof metadata !== 'object')
            continue;
        const media = metadata.media;
        if (!media || typeof media.data !== 'string' || MEDIA_URL_POINTER.test(media.data))
            continue;
        const encoded = Buffer.byteLength(media.data, 'utf8');
        const allowanceApplies = spent === 0 && budgetBytes > 0;
        if (spent + encoded <= budgetBytes || allowanceApplies) {
            spent += encoded;
            continue;
        }
        const { data, ...withoutPayload } = media;
        metadata.media = {
            ...withoutPayload,
            omitted: true,
            sizeBytes: media.sizeBytes ?? Buffer.byteLength(data, 'base64'),
        };
    }
    return messages;
}
exports.DEFAULT_PIN_DURATION_SECONDS = 86400;
const INERT_MEDIA_MIMETYPE = /^(image\/(jpeg|png|gif|webp|bmp)|video\/(mp4|webm|quicktime|3gpp)|audio\/(mpeg|mp4|ogg|aac|wav|webm))(;|$)/;
function inertMimetype(mimetype) {
    return INERT_MEDIA_MIMETYPE.test(mimetype) ? mimetype : 'application/octet-stream';
}
let MessageService = class MessageService {
    static { MessageService_1 = this; }
    messageRepository;
    engines;
    messageProjector;
    hookManager;
    lidMappingStore;
    pacing;
    sender;
    chatMediaArchive;
    storageService;
    logger = (0, logger_service_1.createLogger)('MessageService');
    constructor(messageRepository, engines, messageProjector, hookManager, lidMappingStore, pacing, sender, chatMediaArchive, storageService) {
        this.messageRepository = messageRepository;
        this.engines = engines;
        this.messageProjector = messageProjector;
        this.hookManager = hookManager;
        this.lidMappingStore = lidMappingStore;
        this.pacing = pacing;
        this.sender = sender;
        this.chatMediaArchive = chatMediaArchive;
        this.storageService = storageService;
    }
    sendText(sessionId, dto) {
        return this.sender.sendText(sessionId, dto);
    }
    sendTemplate(sessionId, dto) {
        return this.sender.sendTemplate(sessionId, dto);
    }
    sendImage(sessionId, dto) {
        return this.sender.sendImage(sessionId, dto);
    }
    sendVideo(sessionId, dto) {
        return this.sender.sendVideo(sessionId, dto);
    }
    sendAudio(sessionId, dto) {
        return this.sender.sendAudio(sessionId, dto);
    }
    sendDocument(sessionId, dto) {
        return this.sender.sendDocument(sessionId, dto);
    }
    sendLocation(sessionId, dto) {
        return this.sender.sendLocation(sessionId, dto);
    }
    sendContact(sessionId, dto) {
        return this.sender.sendContact(sessionId, dto);
    }
    sendPoll(sessionId, dto) {
        return this.sender.sendPoll(sessionId, dto);
    }
    sendSticker(sessionId, dto) {
        return this.sender.sendSticker(sessionId, dto);
    }
    reply(sessionId, dto) {
        return this.sender.reply(sessionId, dto);
    }
    forward(sessionId, dto) {
        return this.sender.forward(sessionId, dto);
    }
    saveOutgoingMessage(sessionId, data) {
        return this.sender.saveOutgoingMessage(sessionId, data);
    }
    async getMessages(sessionId, options = {}) {
        const { chatId, from } = options;
        const rawLimit = options.limit;
        const rawOffset = options.offset;
        const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 50;
        const offset = typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;
        const query = this.messageRepository
            .createQueryBuilder('message')
            .where('message.sessionId = :sessionId', { sessionId })
            .orderBy('message.createdAt', 'DESC')
            .skip(offset)
            .take(limit);
        if (chatId) {
            query.andWhere('message.chatId IN (:...chatIds)', { chatIds: this.resolveJidCandidates(chatId) });
        }
        if (from) {
            const froms = this.resolveJidCandidates(from);
            query.andWhere('(message.from IN (:...froms) OR message.author IN (:...authorFroms))', {
                froms,
                authorFroms: froms,
            });
        }
        const [messages, total] = await query.getManyAndCount();
        return { messages: spendInlineMediaBudget(messages, resolveMessageListInlineMediaBudgetBytes()), total };
    }
    resolveJidCandidates(value) {
        const parsed = (0, wa_id_1.parseWaId)(value);
        if (parsed.kind !== 'user' && parsed.kind !== 'lid' && parsed.kind !== 'unknown') {
            return [value];
        }
        if (parsed.kind === 'lid') {
            const candidates = new Set([value]);
            const resolved = this.lidMappingStore.getCached(parsed.userPart);
            if (resolved) {
                candidates.add(`${resolved}@c.us`);
                candidates.add(`${resolved}@s.whatsapp.net`);
            }
            return [...candidates];
        }
        const phone = parsed.userPart;
        const candidates = new Set([value, `${phone}@c.us`, `${phone}@s.whatsapp.net`]);
        for (const lid of this.lidMappingStore.lidsForPhone(phone)) {
            candidates.add(`${lid}@lid`);
        }
        return [...candidates];
    }
    async saveIncomingMessage(sessionId, data) {
        const message = this.messageRepository.create({
            ...data,
            sessionId,
            direction: message_entity_1.MessageDirection.INCOMING,
        });
        return this.messageRepository.save(message);
    }
    async reactToMessage(sessionId, dto) {
        const engine = this.getEngine(sessionId);
        await engine.reactToMessage(dto.chatId, dto.messageId, dto.emoji);
    }
    async getMessageReactions(sessionId, chatId, messageId) {
        const engine = this.getEngine(sessionId);
        return engine.getMessageReactions(chatId, messageId);
    }
    async getChatMedia(sessionId, chatId, messageId) {
        const chatIds = this.resolveJidCandidates(chatId);
        const media = await this.chatMediaArchive?.getMedia(sessionId, chatIds, messageId);
        if (media && this.storageService) {
            try {
                return { buffer: await this.storageService.getFile(media.path), mimetype: inertMimetype(media.mimetype) };
            }
            catch (error) {
                if (!(0, storage_service_1.isMissingObjectError)(error)) {
                    throw error;
                }
            }
        }
        const row = await this.messageRepository.findOne({
            where: { sessionId, chatId: (0, typeorm_2.In)(chatIds), waMessageId: messageId },
        });
        const inline = row?.metadata?.media;
        if (!inline ||
            inline.omitted ||
            typeof inline.data !== 'string' ||
            !inline.data ||
            typeof inline.mimetype !== 'string' ||
            !inline.mimetype ||
            /^https?:\/\//i.test(inline.data)) {
            throw new common_1.NotFoundException('No media stored for this message');
        }
        return { buffer: Buffer.from(inline.data, 'base64'), mimetype: inertMimetype(inline.mimetype) };
    }
    static MAX_CHAT_HISTORY_LIMIT = 100;
    static MAX_DEEP_CHAT_HISTORY_LIMIT = 2000;
    async getChatHistory(sessionId, chatId, limit = 50, includeMedia = false, deep = false, signal) {
        const engine = this.getEngine(sessionId);
        const ceiling = deep ? MessageService_1.MAX_DEEP_CHAT_HISTORY_LIMIT : MessageService_1.MAX_CHAT_HISTORY_LIMIT;
        const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), ceiling) : 50;
        const media = deep ? false : includeMedia;
        return signal
            ? engine.getChatHistory(chatId, safeLimit, media, undefined, signal)
            : engine.getChatHistory(chatId, safeLimit, media);
    }
    async pinMessage(sessionId, dto) {
        const engine = this.getEngine(sessionId);
        await engine.pinMessage(dto.chatId, dto.messageId, dto.durationSeconds ?? exports.DEFAULT_PIN_DURATION_SECONDS);
        return { success: true };
    }
    async unpinMessage(sessionId, dto) {
        const engine = this.getEngine(sessionId);
        await engine.unpinMessage(dto.chatId, dto.messageId);
        return { success: true };
    }
    async starMessage(sessionId, dto) {
        const engine = this.getEngine(sessionId);
        await engine.starMessage(dto.chatId, dto.messageId, dto.star);
        return { success: true };
    }
    async votePoll(sessionId, dto) {
        const engine = this.getEngine(sessionId);
        await engine.votePoll(dto.chatId, dto.pollMessageId, dto.options);
        return { success: true };
    }
    async deleteMessage(sessionId, dto) {
        const engine = this.getEngine(sessionId);
        await engine.deleteMessage(dto.chatId, dto.messageId, dto.forEveryone ?? true);
        try {
            await this.messageRepository.update({ sessionId, waMessageId: dto.messageId }, { body: '', type: 'revoked' });
        }
        catch (err) {
            this.logger.warn(`Failed to flag deleted message ${dto.messageId} as revoked`, { error: String(err) });
        }
    }
    async editMessage(sessionId, dto) {
        const engine = this.getEngine(sessionId);
        const finalDto = await this.applySendingGate(sessionId, 'edit', dto);
        const result = finalDto.mentions?.length
            ? await engine.editMessage(finalDto.chatId, finalDto.messageId, finalDto.body, finalDto.mentions)
            : await engine.editMessage(finalDto.chatId, finalDto.messageId, finalDto.body);
        await this.messageProjector.recordOutboundMessageEdit(sessionId, finalDto.messageId, finalDto.body);
        return { messageId: result.id, timestamp: result.timestamp };
    }
    async applySendingGate(sessionId, type, input) {
        const target = input;
        await this.pacing.assertSendAllowed(sessionId, target.chatId ?? target.toChatId);
        return (0, hooks_1.applySendingGate)(this.hookManager, sessionId, type, input, 'MessageService');
    }
    getEngine(sessionId) {
        return this.engines.require(sessionId, () => new common_1.BadRequestException(`Session '${sessionId}' is not active. Start the session first.`));
    }
};
exports.MessageService = MessageService;
exports.MessageService = MessageService = MessageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(message_entity_1.Message, 'data')),
    __param(7, (0, common_1.Optional)()),
    __param(8, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        engine_registry_service_1.EngineRegistry,
        message_projector_service_1.MessageProjector,
        hooks_1.HookManager,
        lid_mapping_store_service_1.LidMappingStoreService,
        send_pacing_service_1.SendPacingService,
        message_send_service_1.MessageSendService,
        chat_media_archive_service_1.ChatMediaArchiveService,
        storage_service_1.StorageService])
], MessageService);
//# sourceMappingURL=message.service.js.map