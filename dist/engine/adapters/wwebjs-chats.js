"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WwebjsChats = void 0;
const common_1 = require("@nestjs/common");
const whatsapp_web_js_1 = require("whatsapp-web.js");
const engine_transport_error_1 = require("../../common/errors/engine-transport.error");
const wa_id_1 = require("../identity/wa-id");
class WwebjsChats {
    host;
    messaging;
    constructor(host, messaging) {
        this.host = host;
        this.messaging = messaging;
    }
    client() {
        return this.host.getClient();
    }
    async getChats() {
        this.host.ensureReady();
        let chats;
        try {
            chats = await this.client().getChats();
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'getChats');
                throw new engine_transport_error_1.EngineTransportError('Transport died while listing chats');
            }
            throw error;
        }
        const summaries = [];
        let skipped = 0;
        for (const chat of chats) {
            const id = chat.id?._serialized;
            if (!id) {
                skipped++;
                continue;
            }
            summaries.push({
                id,
                name: chat.name || id,
                isGroup: Boolean(chat.isGroup),
                kind: (0, wa_id_1.chatKind)(id),
                unreadCount: chat.unreadCount || 0,
                timestamp: chat.timestamp || 0,
                lastMessage: chat.lastMessage?.type === whatsapp_web_js_1.MessageTypes.LOCATION ? '📍' : chat.lastMessage?.body || undefined,
            });
        }
        if (skipped > 0) {
            this.host.logger.warn(`Skipped ${skipped} chat(s) without a serialized id`);
        }
        return summaries;
    }
    async sendSeen(chatId) {
        this.host.ensureReady();
        try {
            const chat = await this.client().getChatById(chatId);
            return await chat.sendSeen();
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'sendSeen');
                throw new engine_transport_error_1.EngineTransportError('Transport died while marking a chat as read');
            }
            this.host.logger.error(`Error marking chat ${chatId} as read`, String(error));
            return false;
        }
    }
    async clearChatMessages(chatId) {
        this.host.ensureReady();
        try {
            const chat = await this.client().getChatById(chatId);
            return await chat.clearMessages();
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'clearChatMessages');
                throw new engine_transport_error_1.EngineTransportError('Transport died while clearing a chat');
            }
            this.host.logger.error(`Error clearing messages in chat ${chatId}`, String(error));
            return false;
        }
    }
    async archiveChat(chatId, archive) {
        this.host.ensureReady();
        try {
            if (archive) {
                await this.client().archiveChat(chatId);
            }
            else {
                await this.client().unarchiveChat(chatId);
            }
            return true;
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'archiveChat');
                throw new engine_transport_error_1.EngineTransportError('Transport died while archiving a chat');
            }
            this.host.logger.error(`Error ${archive ? 'archiving' : 'unarchiving'} chat ${chatId}`, String(error));
            return false;
        }
    }
    async requireResolvableChat(chatId) {
        let chat;
        try {
            chat = await this.client().getChatById(chatId);
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'requireResolvableChat');
                throw new engine_transport_error_1.EngineTransportError('Transport died while resolving a chat');
            }
            chat = undefined;
        }
        if (!chat)
            throw new common_1.BadRequestException(`Chat ${chatId} does not exist on this session`);
    }
    async muteChat(chatId, muteUntil) {
        this.host.ensureReady();
        await this.requireResolvableChat(chatId);
        if (muteUntil === null) {
            await this.client().unmuteChat(chatId);
            return;
        }
        await this.client().muteChat(chatId, new Date(muteUntil));
    }
    async pinChat(chatId, pin) {
        this.host.ensureReady();
        await this.requireResolvableChat(chatId);
        if (!pin) {
            await this.client().unpinChat(chatId);
            return true;
        }
        return await this.client().pinChat(chatId);
    }
    async markUnread(chatId) {
        this.host.ensureReady();
        if ((0, wa_id_1.isChannelJid)(chatId)) {
            return false;
        }
        try {
            const chat = await this.client().getChatById(chatId);
            await chat.markUnread();
            return true;
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'markUnread');
                throw new engine_transport_error_1.EngineTransportError('Transport died while marking a chat as unread');
            }
            this.host.logger.error(`Error marking chat ${chatId} as unread`, String(error));
            return false;
        }
    }
    async deleteChat(chatId) {
        this.host.ensureReady();
        if ((0, wa_id_1.isChannelJid)(chatId)) {
            return false;
        }
        try {
            const chat = await this.client().getChatById(chatId);
            return await chat.delete();
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'deleteChat');
                throw new engine_transport_error_1.EngineTransportError('Transport died while deleting a chat');
            }
            this.host.logger.error(`Error deleting chat ${chatId}`, String(error));
            return false;
        }
    }
    async setOnlinePresence(available) {
        this.host.ensureReady();
        if (available) {
            await this.client().sendPresenceAvailable();
        }
        else {
            await this.client().sendPresenceUnavailable();
        }
    }
    async sendChatState(chatId, state) {
        this.host.ensureReady();
        if ((0, wa_id_1.isChannelJid)(chatId)) {
            return;
        }
        try {
            const to = await this.messaging.resolveSendId(chatId);
            const chat = await this.client().getChatById(to);
            if (state === 'typing') {
                await chat.sendStateTyping();
            }
            else if (state === 'recording') {
                await chat.sendStateRecording();
            }
            else {
                await chat.clearState();
            }
        }
        catch (error) {
            this.host.logger.warn(`Could not set chat state '${state}' for ${chatId} (best-effort)`, {
                error: String(error),
            });
        }
    }
}
exports.WwebjsChats = WwebjsChats;
//# sourceMappingURL=wwebjs-chats.js.map