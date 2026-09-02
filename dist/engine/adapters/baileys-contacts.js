"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaileysContacts = void 0;
const baileys_messaging_1 = require("./baileys-messaging");
const baileys_query_deadline_1 = require("./baileys-query-deadline");
const engine_transport_error_1 = require("../../common/errors/engine-transport.error");
const recipient_unreachable_error_1 = require("../../common/errors/recipient-unreachable.error");
class BaileysContacts {
    host;
    queryBudgetMs;
    constructor(host, queryBudgetMs = baileys_query_deadline_1.BAILEYS_QUERY_BUDGET_MS) {
        this.host = host;
        this.queryBudgetMs = queryBudgetMs;
    }
    confirmed(work, operation) {
        return (0, baileys_query_deadline_1.withQueryDeadline)(work, this.queryBudgetMs, `WhatsApp did not confirm ${operation} in time`);
    }
    sock() {
        return this.host.getSocket();
    }
    async getProfilePicture(contactId) {
        this.host.ensureReady();
        try {
            const url = await (0, baileys_query_deadline_1.withQueryDeadline)(this.sock().profilePictureUrl(contactId, 'image'), this.queryBudgetMs, 'WhatsApp did not answer the profile picture lookup in time');
            return url ?? null;
        }
        catch (err) {
            if (err instanceof engine_transport_error_1.EngineTransportError) {
                throw err;
            }
            this.host.logger.debug('profilePictureUrl failed; no picture or hidden', {
                contactId,
                error: err instanceof Error ? err.message : String(err),
            });
            return null;
        }
    }
    async upsertContact(contactId, firstName, lastName = '') {
        this.host.ensureReady();
        const fullName = [firstName, lastName].filter(Boolean).join(' ');
        await this.confirmed(this.sock().addOrEditContact(this.host.toEngineJid(contactId), {
            firstName,
            fullName,
            saveOnPrimaryAddressbook: false,
        }), 'the contact save');
    }
    async deleteContact(contactId) {
        this.host.ensureReady();
        await this.confirmed(this.sock().removeContact(this.host.toEngineJid(contactId)), 'the contact removal');
    }
    async mapUnresolvableId(contactId, op) {
        try {
            return await op();
        }
        catch (error) {
            const status = error?.output?.statusCode;
            if (status === 400)
                throw new recipient_unreachable_error_1.RecipientUnreachableError(contactId);
            throw error;
        }
    }
    async blockContact(contactId) {
        this.host.ensureReady();
        await this.mapUnresolvableId(contactId, () => this.confirmed(this.sock().updateBlockStatus(contactId, 'block'), 'the block'));
        this.invalidateBlocklist();
    }
    async unblockContact(contactId) {
        this.host.ensureReady();
        await this.mapUnresolvableId(contactId, () => this.confirmed(this.sock().updateBlockStatus(contactId, 'unblock'), 'the unblock'));
        this.invalidateBlocklist();
    }
    async getBlockedContacts(budgetMs = this.queryBudgetMs) {
        this.host.ensureReady();
        const jids = await (0, baileys_query_deadline_1.withQueryDeadline)(this.sock().fetchBlocklist(), budgetMs, 'WhatsApp did not answer the blocklist query in time');
        return (jids ?? []).filter((jid) => Boolean(jid)).map(jid => this.host.toNeutralJid(jid));
    }
    async setProfileName(name) {
        this.host.ensureReady();
        await this.confirmed(this.sock().updateProfileName(name), 'the profile name change');
    }
    async setProfileStatus(status) {
        this.host.ensureReady();
        await this.confirmed(this.sock().updateProfileStatus(status), 'the profile status change');
    }
    async setProfilePicture(media) {
        this.host.ensureReady();
        const selfJid = this.host.normalizedSelfJid();
        if (!selfJid) {
            throw new Error('cannot set the profile picture: the own JID is not known yet');
        }
        const { data } = await (0, baileys_messaging_1.resolveMediaBuffer)(media);
        await this.confirmed(this.sock().updateProfilePicture(selfJid, data), 'the profile picture change');
    }
    async deleteProfilePicture() {
        this.host.ensureReady();
        const selfJid = this.host.normalizedSelfJid();
        if (!selfJid) {
            throw new Error('cannot delete the profile picture: the own JID is not known yet');
        }
        await this.confirmed(this.sock().removeProfilePicture(selfJid), 'the profile picture removal');
    }
    async getContacts() {
        this.host.ensureReady();
        return this.withBlockedState(this.host.listContacts());
    }
    async getContactById(contactId) {
        this.host.ensureReady();
        const contact = this.host.findContact(contactId);
        if (!contact)
            return null;
        return (await this.withBlockedState([contact]))[0];
    }
    async withBlockedState(contacts) {
        if (contacts.length === 0)
            return contacts;
        const blocked = await this.blockedIds();
        if (!blocked)
            return contacts;
        return contacts.map(contact => ({ ...contact, isBlocked: blocked.has(contact.id) }));
    }
    blocklistMemo;
    blocklistInFlight;
    blocklistGeneration = 0;
    static BLOCKLIST_MEMO_MS = 5_000;
    static BLOCKLIST_ENRICHMENT_BUDGET_MS = 5_000;
    async blockedIds() {
        if (this.blocklistMemo && Date.now() - this.blocklistMemo.at < BaileysContacts.BLOCKLIST_MEMO_MS) {
            return this.blocklistMemo.ids;
        }
        this.blocklistInFlight ??= this.queryBlockedIds();
        return this.blocklistInFlight;
    }
    async queryBlockedIds() {
        const generation = this.blocklistGeneration;
        let ids;
        try {
            ids = new Set(await this.getBlockedContacts(BaileysContacts.BLOCKLIST_ENRICHMENT_BUDGET_MS));
        }
        catch (error) {
            this.host.logger.warn('Blocklist unavailable; contact isBlocked left at its default', {
                error: error instanceof Error ? error.message : String(error),
            });
            ids = null;
        }
        finally {
            if (generation === this.blocklistGeneration) {
                this.blocklistInFlight = undefined;
            }
        }
        if (generation === this.blocklistGeneration) {
            this.blocklistMemo = { at: Date.now(), ids };
        }
        return ids;
    }
    invalidateBlocklist() {
        this.blocklistMemo = undefined;
        this.blocklistInFlight = undefined;
        this.blocklistGeneration += 1;
    }
    async resolveContactPhone(contactId) {
        this.host.ensureReady();
        return this.host.resolvePhone(contactId);
    }
    async getChats() {
        this.host.ensureReady();
        return this.host.listChats();
    }
    async sendSeen(chatId, messageIds) {
        this.host.ensureReady();
        const keys = await this.receiptKeys(chatId, messageIds);
        if (keys.length === 0) {
            return false;
        }
        await this.confirmed(this.sock().readMessages(keys), 'the read receipt');
        return true;
    }
    async receiptKeys(chatId, messageIds) {
        if (messageIds === undefined || messageIds === null) {
            const last = this.host.lastMessage(chatId);
            return last ? [last.key] : [];
        }
        if (messageIds.length === 0) {
            return [];
        }
        const remoteJid = this.host.toEngineJid(chatId);
        const stored = (await this.host.getStoredMessages(messageIds)) ?? [];
        const chatKey = this.host.toNeutralJid(chatId);
        const keyById = new Map(stored
            .filter(msg => msg.key?.id && msg.key.remoteJid && this.host.toNeutralJid(msg.key.remoteJid) === chatKey)
            .map(msg => [msg.key.id, msg.key]));
        return messageIds.map(id => keyById.get(id) ?? { remoteJid, id, fromMe: false });
    }
    async markUnread(chatId) {
        this.host.ensureReady();
        const last = this.host.lastMessage(chatId);
        if (!last) {
            return false;
        }
        await this.confirmed(this.sock().chatModify({ markRead: false, lastMessages: [{ key: last.key, messageTimestamp: last.timestamp }] }, this.host.toEngineJid(chatId)), 'the unread mark');
        return true;
    }
    async clearChatMessages(chatId) {
        this.host.ensureReady();
        const last = this.host.lastMessage(chatId);
        if (!last) {
            return false;
        }
        await this.confirmed(this.sock().chatModify({ clear: true, lastMessages: [{ key: last.key, messageTimestamp: last.timestamp }] }, this.host.toEngineJid(chatId)), 'the chat clear');
        return true;
    }
    async archiveChat(chatId, archive) {
        this.host.ensureReady();
        const last = this.host.lastMessage(chatId);
        if (!last) {
            return false;
        }
        await this.confirmed(this.sock().chatModify({ archive, lastMessages: [{ key: last.key, messageTimestamp: last.timestamp }] }, this.host.toEngineJid(chatId)), 'the archive change');
        return true;
    }
    async muteChat(chatId, muteUntil) {
        this.host.ensureReady();
        await this.confirmed(this.sock().chatModify({ mute: muteUntil }, this.host.toEngineJid(chatId)), 'the mute change');
    }
    async pinChat(chatId, pin) {
        this.host.ensureReady();
        await this.confirmed(this.sock().chatModify({ pin }, this.host.toEngineJid(chatId)), 'the pin change');
        return true;
    }
    async deleteChat(chatId) {
        this.host.ensureReady();
        const last = this.host.lastMessage(chatId);
        if (!last) {
            return false;
        }
        await this.confirmed(this.sock().chatModify({ delete: true, lastMessages: [{ key: last.key, messageTimestamp: last.timestamp }] }, this.host.toEngineJid(chatId)), 'the chat delete');
        return true;
    }
}
exports.BaileysContacts = BaileysContacts;
//# sourceMappingURL=baileys-contacts.js.map