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
exports.SessionService = exports.AUTOSTART_THROTTLE_MS = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const promises_1 = require("node:timers/promises");
const engine_transport_error_1 = require("../../common/errors/engine-transport.error");
const session_entity_1 = require("./entities/session.entity");
const engine_registry_service_1 = require("../../engine/engine-registry.service");
const session_liveness_watchdog_service_1 = require("./session-liveness-watchdog.service");
const session_error_store_service_1 = require("./session-error-store.service");
const session_restriction_store_service_1 = require("./session-restriction-store.service");
const presence_store_service_1 = require("./presence-store.service");
const session_engine_lifecycle_service_1 = require("./session-engine-lifecycle.service");
const session_ownership_service_1 = require("./session-ownership.service");
const paginate_1 = require("../../common/utils/paginate");
const db_errors_1 = require("../../common/utils/db-errors");
const feature_flags_1 = require("../../config/feature-flags");
const logger_service_1 = require("../../common/services/logger.service");
const hooks_1 = require("../../core/hooks");
const SESSION_START_RETRY_DELAY_MS = 2_000;
const TRANSIENT_DB_CODES = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED']);
function isTransientLaunchFailure(error) {
    if (error instanceof engine_transport_error_1.EngineTransportError)
        return true;
    if (error instanceof common_1.HttpException)
        return false;
    if (!(error instanceof Error))
        return false;
    const code = error.code;
    if (typeof code === 'string' && TRANSIENT_DB_CODES.has(code))
        return true;
    return /connection|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|terminating connection/i.test(error.message);
}
exports.AUTOSTART_THROTTLE_MS = 2_000;
let SessionService = class SessionService {
    sessionRepository;
    dataSource;
    engineRegistry;
    watchdog;
    sessionErrors;
    sessionRestrictions;
    presence;
    hookManager;
    engineLifecycle;
    configService;
    ownership;
    logger = (0, logger_service_1.createLogger)('SessionService');
    get engines() {
        return this.engineRegistry;
    }
    autoStartRun = Promise.resolve();
    shuttingDown = false;
    constructor(sessionRepository, dataSource, engineRegistry, watchdog, sessionErrors, sessionRestrictions, presence, hookManager, engineLifecycle, configService, ownership) {
        this.sessionRepository = sessionRepository;
        this.dataSource = dataSource;
        this.engineRegistry = engineRegistry;
        this.watchdog = watchdog;
        this.sessionErrors = sessionErrors;
        this.sessionRestrictions = sessionRestrictions;
        this.presence = presence;
        this.hookManager = hookManager;
        this.engineLifecycle = engineLifecycle;
        this.configService = configService;
        this.ownership = ownership;
    }
    async onModuleInit() {
        const activeStatuses = [
            session_entity_1.SessionStatus.READY,
            session_entity_1.SessionStatus.INITIALIZING,
            session_entity_1.SessionStatus.QR_READY,
            session_entity_1.SessionStatus.AUTHENTICATING,
            session_entity_1.SessionStatus.ACTION_REQUIRED,
        ];
        const claimable = this.ownership?.claimableWhere() ?? [{}];
        const result = await this.sessionRepository.update(claimable.map(clause => ({ ...clause, status: (0, typeorm_2.In)(activeStatuses) })), { status: session_entity_1.SessionStatus.DISCONNECTED });
        if (result.affected && result.affected > 0) {
            this.logger.log(`Reset ${result.affected} session(s) to disconnected on startup`, {
                action: 'startup_reset',
                affected: result.affected,
                nodeId: this.ownership?.nodeId,
            });
        }
    }
    onApplicationBootstrap() {
        this.watchdog.start((id, engine, reason) => this.engineLifecycle.handleEngineDisconnected(id, engine, reason));
        this.ownership?.onLeaseLoss(async (ids) => void (await this.engineLifecycle.stopOrphanEngines(ids)));
        this.ownership?.setEngineLiveness(id => this.engineLifecycle.isEngineActive(id));
        this.ownership?.startHeartbeat();
        if (!(0, feature_flags_1.resolveFeatureFlags)(this.configService).autoStartSessions)
            return;
        this.autoStartRun = this.autoStartSessions().catch((error) => {
            this.logger.error('Auto-start scan failed', error instanceof Error ? error.message : String(error), {
                action: 'auto_start_scan_failed',
            });
        });
    }
    async autoStartSessions() {
        const claimable = this.ownership?.claimableWhere() ?? [{}];
        const sessions = await this.sessionRepository.find({
            where: claimable.map(clause => ({ ...clause, phone: (0, typeorm_2.Not)((0, typeorm_2.IsNull)()), status: session_entity_1.SessionStatus.DISCONNECTED })),
        });
        if (sessions.length === 0)
            return;
        this.logger.log(`Auto-starting ${sessions.length} previously authenticated session(s)`, {
            action: 'auto_start',
            count: sessions.length,
        });
        for (let i = 0; i < sessions.length; i++) {
            if (this.shuttingDown) {
                this.logger.log(`Auto-start stopped at ${i} of ${sessions.length} session(s): shutting down`, {
                    action: 'auto_start_aborted',
                });
                return;
            }
            const session = sessions[i];
            try {
                await this.start(session.id);
                this.logger.log(`Auto-started session: ${session.name}`, {
                    sessionId: session.id,
                    action: 'auto_start_success',
                });
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                this.logger.error(`Auto-start failed for session: ${session.name}`, errorMessage, {
                    sessionId: session.id,
                    action: 'auto_start_failed',
                });
            }
            if (i < sessions.length - 1) {
                await (0, promises_1.setTimeout)(exports.AUTOSTART_THROTTLE_MS);
            }
        }
    }
    async onModuleDestroy() {
        this.shuttingDown = true;
        this.watchdog.stop();
        this.ownership?.stopHeartbeat();
        await this.autoStartRun;
        await this.engineLifecycle.shutdown();
        await this.ownership?.releaseAll();
    }
    async create(dto) {
        const existing = await this.sessionRepository.findOne({
            where: { name: dto.name },
        });
        if (existing) {
            throw new common_1.ConflictException(`Session with name '${dto.name}' already exists`);
        }
        const session = this.sessionRepository.create({
            name: dto.name,
            config: dto.config || {},
            proxyUrl: dto.proxyUrl || null,
            proxyType: dto.proxyType || null,
            status: session_entity_1.SessionStatus.CREATED,
        });
        let saved;
        try {
            saved = await this.dataSource.transaction(async (manager) => {
                return await manager.save(session);
            });
        }
        catch (err) {
            if ((0, db_errors_1.isUniqueViolation)(err)) {
                throw new common_1.ConflictException(`Session with name '${dto.name}' already exists`);
            }
            throw err;
        }
        this.logger.log(`Session created: ${saved.name}`, {
            sessionId: saved.id,
            action: 'create',
        });
        await this.hookManager.execute('session:created', saved, {
            sessionId: saved.id,
            source: 'SessionService',
        });
        return saved;
    }
    async findAll(allowedSessions, opts = {}) {
        const { limit, offset } = (0, paginate_1.resolveListWindow)(opts.limit, opts.offset);
        const options = { order: { createdAt: 'DESC' }, take: limit, skip: offset };
        if (allowedSessions && allowedSessions.length > 0) {
            options.where = { id: (0, typeorm_2.In)(allowedSessions) };
        }
        const sessions = await this.sessionRepository.find(options);
        return sessions.map(session => this.attachRuntimeState(session));
    }
    async findOne(id) {
        const session = await this.sessionRepository.findOne({ where: { id } });
        if (!session) {
            throw new common_1.NotFoundException(`Session with id '${id}' not found`);
        }
        return this.attachRuntimeState(session);
    }
    attachRuntimeState(session) {
        return this.sessionRestrictions.attachTo(this.sessionErrors.attachTo(session));
    }
    projectConfig(config) {
        const { maxAttempts, baseDelay } = (0, session_engine_lifecycle_service_1.resolveReconnectConfig)(config);
        return {
            autoRejectCalls: config?.autoRejectCalls === true,
            maxReconnectAttempts: Number.isFinite(maxAttempts) ? maxAttempts : null,
            reconnectBaseDelay: baseDelay,
        };
    }
    async getConfig(id) {
        const session = await this.findOne(id);
        return this.projectConfig(session.config ?? {});
    }
    async updateConfig(id, dto) {
        const session = await this.findOne(id);
        const config = { ...(session.config ?? {}) };
        for (const key of ['autoRejectCalls', 'maxReconnectAttempts', 'reconnectBaseDelay']) {
            const value = dto[key];
            if (value === undefined)
                continue;
            if (value === null) {
                delete config[key];
            }
            else {
                config[key] = value;
            }
        }
        await this.sessionRepository.update(id, { config: config });
        return this.projectConfig(config);
    }
    async delete(id) {
        this.engineLifecycle.markStopping(id);
        try {
            if (this.ownership)
                await this.assertNotHeldElsewhere(id);
            await this.engineLifecycle.delete(id);
            await this.ownership?.release(id);
        }
        catch (error) {
            this.discardStopMarkForMissingSession(id, error);
            throw error;
        }
    }
    discardStopMarkForMissingSession(id, error) {
        if (error instanceof common_1.NotFoundException)
            this.engineLifecycle.clearStopping(id);
    }
    async assertNotHeldElsewhere(id) {
        if (await this.ownership?.isHeldByOtherNode(id)) {
            throw new common_1.ConflictException(`Session ${id} is running on another node`);
        }
    }
    async start(id) {
        if (this.ownership && !(await this.ownership.claim(id))) {
            await this.findOne(id);
            throw new common_1.ConflictException(`Session ${id} is running on another node`);
        }
        try {
            return await this.startWithTransientRetry(id);
        }
        catch (error) {
            await this.releaseUnlessEngineActive(id);
            throw error;
        }
    }
    async startWithTransientRetry(id) {
        try {
            return await this.engineLifecycle.start(id);
        }
        catch (error) {
            if (!isTransientLaunchFailure(error))
                throw error;
            this.logger.warn(`Transient launch failure for session ${id}; retrying once`, {
                sessionId: id,
                action: 'session_start_transient_retry',
                error: error instanceof Error ? error.message : String(error),
            });
            await (0, promises_1.setTimeout)(SESSION_START_RETRY_DELAY_MS);
            if (this.ownership && !(await this.ownership.claim(id))) {
                await this.findOne(id);
                throw new common_1.ConflictException(`Session ${id} is running on another node`);
            }
            return this.engineLifecycle.start(id);
        }
    }
    async stop(id) {
        this.engineLifecycle.markStopping(id);
        let session;
        try {
            if (this.ownership)
                await this.assertNotHeldElsewhere(id);
            session = await this.engineLifecycle.stop(id);
        }
        catch (error) {
            this.discardStopMarkForMissingSession(id, error);
            throw error;
        }
        await this.releaseUnlessEngineActive(id);
        return session;
    }
    async logout(id) {
        try {
            const session = await this.engineLifecycle.logout(id);
            await this.releaseUnlessEngineActive(id);
            return session;
        }
        catch (error) {
            await this.releaseUnlessEngineActive(id);
            throw error;
        }
    }
    async forceKill(id) {
        try {
            const session = await this.engineLifecycle.forceKill(id);
            await this.releaseUnlessEngineActive(id);
            return session;
        }
        catch (error) {
            await this.releaseUnlessEngineActive(id);
            throw error;
        }
    }
    async releaseUnlessEngineActive(id) {
        if (!this.ownership || this.engineLifecycle.isEngineActive(id)) {
            return;
        }
        await this.ownership.release(id);
    }
    async getQRCode(id) {
        const session = await this.findOne(id);
        const engine = this.engines.require(id, () => new common_1.BadRequestException('Session is not started. Call POST /sessions/:sessionId/start first.'));
        const qrCode = engine.getQRCode();
        if (!qrCode) {
            if (session.status === session_entity_1.SessionStatus.READY) {
                throw new common_1.BadRequestException('Session is already authenticated, no QR code needed');
            }
            throw new common_1.BadRequestException('QR code is not ready yet. Please wait...');
        }
        return {
            qrCode,
            status: session.status,
        };
    }
    async requestPairingCode(id, phoneNumber) {
        const session = await this.findOne(id);
        const engine = this.engines.require(id, () => new common_1.BadRequestException('Session is not started. Call POST /sessions/:sessionId/start first.'));
        if (session.status === session_entity_1.SessionStatus.READY) {
            throw new common_1.BadRequestException('Session is already authenticated, no pairing needed');
        }
        const pairingCode = await engine.requestPairingCode(phoneNumber);
        return { pairingCode, status: session.status };
    }
    getEngine(id) {
        return this.engines.get(id);
    }
    requireEngine(id) {
        return this.engines.require(id);
    }
    async getGroups(id, opts = {}) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        const groups = await engine.getGroups();
        const mapped = groups.map(g => ({
            id: g.id,
            name: g.name,
            linkedParentJID: g.linkedParentJID,
        }));
        return (0, paginate_1.paginate)(mapped, opts.limit, opts.offset);
    }
    async getChats(id, opts = {}) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        const chats = [...(await engine.getChats())].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return (0, paginate_1.paginate)(chats, opts.limit, opts.offset);
    }
    async subscribeToPresence(id, chatId) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.subscribeToPresence(chatId);
    }
    async setOnlinePresence(id, available) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.setOnlinePresence(available);
    }
    async getPresence(id, chatId) {
        await this.findOne(id);
        return this.presence.get(id, chatId);
    }
    async sendSeen(id, chatId, messageIds) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.sendSeen(chatId, messageIds);
    }
    async markUnread(id, chatId) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.markUnread(chatId);
    }
    async clearChatMessages(id, chatId) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.clearChatMessages(chatId);
    }
    async archiveChat(id, chatId, archive) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.archiveChat(chatId, archive);
    }
    async muteChat(id, chatId, muteUntil) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.muteChat(chatId, muteUntil);
    }
    async pinChat(id, chatId, pin) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.pinChat(chatId, pin);
    }
    async deleteChat(id, chatId) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.deleteChat(chatId);
    }
    async sendChatState(id, chatId, state) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        await engine.sendChatState(chatId, state);
    }
    async getStats(allowedSessions) {
        const scope = allowedSessions && allowedSessions.length > 0 ? allowedSessions : null;
        const qb = this.sessionRepository
            .createQueryBuilder('session')
            .select('session.status', 'status')
            .addSelect('COUNT(session.id)', 'count');
        if (scope) {
            qb.where('session.id IN (:...scope)', { scope });
        }
        const rows = await qb.groupBy('session.status').getRawMany();
        const byStatus = {};
        let total = 0;
        for (const row of rows) {
            const count = Number(row.count) || 0;
            byStatus[row.status] = count;
            total += count;
        }
        const memory = process.memoryUsage();
        return {
            total,
            active: scope ? [...this.engines.keys()].filter(id => scope.includes(id)).length : this.engines.size,
            ready: byStatus[session_entity_1.SessionStatus.READY] || 0,
            disconnected: byStatus[session_entity_1.SessionStatus.DISCONNECTED] || 0,
            byStatus,
            memoryUsage: {
                heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
                rss: Math.round(memory.rss / 1024 / 1024),
            },
        };
    }
    isActive(id) {
        return this.engines.has(id);
    }
    getActiveSessionIds() {
        return this.engines.activeIds();
    }
    async stopOrphanEngines(sessionIds) {
        return this.engineLifecycle.stopOrphanEngines(sessionIds);
    }
};
exports.SessionService = SessionService;
exports.SessionService = SessionService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(session_entity_1.Session, 'data')),
    __param(1, (0, typeorm_1.InjectDataSource)('data')),
    __param(9, (0, common_1.Optional)()),
    __param(10, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.DataSource,
        engine_registry_service_1.EngineRegistry,
        session_liveness_watchdog_service_1.SessionLivenessWatchdog,
        session_error_store_service_1.SessionErrorStore,
        session_restriction_store_service_1.SessionRestrictionStore,
        presence_store_service_1.PresenceStore,
        hooks_1.HookManager,
        session_engine_lifecycle_service_1.SessionEngineLifecycle,
        config_1.ConfigService,
        session_ownership_service_1.SessionOwnershipService])
], SessionService);
//# sourceMappingURL=session.service.js.map