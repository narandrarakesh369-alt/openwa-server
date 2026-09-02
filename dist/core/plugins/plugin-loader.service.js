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
exports.PluginLoaderService = exports.pluginUpdateBackupDirName = exports.pluginUpdateStagingDirName = exports.resolvePluginEntryPath = exports.resolvePluginMainPath = void 0;
exports.buildSandboxWorkerEnv = buildSandboxWorkerEnv;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const lid_mapping_store_service_1 = require("../../engine/identity/lid-mapping-store.service");
const path = __importStar(require("path"));
const configuration_1 = require("../../config/configuration");
const logger_service_1 = require("../../common/services/logger.service");
const hooks_1 = require("../hooks");
const plugin_interfaces_1 = require("./plugin.interfaces");
const plugin_storage_service_1 = require("./plugin-storage.service");
const plugin_host_services_1 = require("./plugin-host-services");
const plugin_capability_context_1 = require("./plugin-capability-context");
const plugin_sandbox_bridge_1 = require("./plugin-sandbox-bridge");
const plugin_package_scanner_1 = require("./plugin-package-scanner");
const plugin_lifecycle_1 = require("./plugin-lifecycle");
const plugin_uninstaller_1 = require("./plugin-uninstaller");
const plugin_worker_host_1 = require("./sandbox/plugin-worker-host");
const worker_thread_channel_1 = require("./sandbox/worker-thread-channel");
const plugin_paths_1 = require("./plugin-paths");
var plugin_paths_2 = require("./plugin-paths");
Object.defineProperty(exports, "resolvePluginMainPath", { enumerable: true, get: function () { return plugin_paths_2.resolvePluginMainPath; } });
Object.defineProperty(exports, "resolvePluginEntryPath", { enumerable: true, get: function () { return plugin_paths_2.resolvePluginEntryPath; } });
Object.defineProperty(exports, "pluginUpdateStagingDirName", { enumerable: true, get: function () { return plugin_paths_2.pluginUpdateStagingDirName; } });
Object.defineProperty(exports, "pluginUpdateBackupDirName", { enumerable: true, get: function () { return plugin_paths_2.pluginUpdateBackupDirName; } });
const SANDBOX_MAX_OLD_GEN_MB = 256;
const SANDBOX_MAX_INFLIGHT_CAPS = 32;
const SANDBOX_CAP_TIMEOUT_MS = 30000;
const SANDBOX_ENV_ALLOWLIST = ['NODE_ENV', 'NODE_EXTRA_CA_CERTS', 'TZ'];
function buildSandboxWorkerEnv(source = process.env) {
    const env = {};
    for (const key of SANDBOX_ENV_ALLOWLIST) {
        if (source[key] !== undefined)
            env[key] = source[key];
    }
    env.NODE_ENV = source.NODE_ENV ?? 'production';
    return env;
}
let PluginLoaderService = class PluginLoaderService {
    configService;
    hookManager;
    pluginStorage;
    moduleRef;
    lidMappingStore;
    logger = (0, logger_service_1.createLogger)('PluginLoaderService');
    plugins = new Map();
    sandboxHosts = new Map();
    lastSandboxHookError = new Map();
    pluginsDir;
    legacyPluginsDir;
    hostServices;
    capabilities;
    sandboxBridge;
    scanner;
    lifecycle;
    uninstaller;
    constructor(configService, hookManager, pluginStorage, moduleRef, lidMappingStore) {
        this.configService = configService;
        this.hookManager = hookManager;
        this.pluginStorage = pluginStorage;
        this.moduleRef = moduleRef;
        this.lidMappingStore = lidMappingStore;
        this.pluginsDir = this.configService.get('plugins.dir') ?? configuration_1.DEFAULT_PLUGINS_DIR;
        this.legacyPluginsDir = this.configService.get('plugins.legacyDir') ?? null;
        this.hostServices = new plugin_host_services_1.PluginHostServices(this.moduleRef);
        this.capabilities = new plugin_capability_context_1.PluginCapabilityContext(this.logger, this.hostServices, this.hookManager, this.pluginStorage, this.lidMappingStore);
        this.sandboxBridge = new plugin_sandbox_bridge_1.PluginSandboxBridge(this.logger, this.hookManager, this.capabilities, this.hostServices, this.configService, this.pluginStorage, this.plugins, this.sandboxHosts, this.lastSandboxHookError, this.pluginsDir, (capDispatcher, onHookSubscribe, onWebhookSubscribe, onLog, runWithHookGuard, onSearchProviderRegister, onWorkerExit) => this.createSandboxHost(capDispatcher, onHookSubscribe, onWebhookSubscribe, onLog, runWithHookGuard, onSearchProviderRegister, onWorkerExit), plugin_paths_1.resolvePluginMainPath);
        this.scanner = new plugin_package_scanner_1.PluginPackageScanner(this.logger, this.configService, this.pluginStorage, this.pluginsDir, this.legacyPluginsDir, this.plugins);
        this.lifecycle = new plugin_lifecycle_1.PluginLifecycle(this.logger, this.configService, this.hookManager, this.pluginStorage, this.capabilities, this.sandboxBridge, this.hostServices, (manifest, builtIn) => this.scanner.ensureRegistryEntry(manifest, builtIn), this.plugins, this.sandboxHosts, this.lastSandboxHookError, this.pluginsDir);
        this.uninstaller = new plugin_uninstaller_1.PluginUninstaller(this.logger, this.plugins, this.pluginStorage, this.pluginsDir, pluginId => this.lifecycle.unloadPlugin(pluginId));
    }
    onModuleInit() {
        this.scanner.scanAtBoot();
    }
    async onApplicationBootstrap() {
        const restorable = this.getAllPlugins().filter(p => !p.builtIn && this.pluginStorage.getPluginEntry(p.manifest.id)?.enabledByOperator === true);
        for (const plugin of restorable) {
            const pluginId = plugin.manifest.id;
            try {
                await this.enablePlugin(pluginId);
            }
            catch (error) {
                this.logger.error(`Failed to restore plugin ${pluginId} on startup; it stays disabled until re-enabled`, error instanceof Error ? error.message : String(error), { pluginId, action: 'plugin_restore_failed' });
            }
        }
    }
    async onModuleDestroy() {
        const enabled = this.getAllPlugins().filter(p => p.status === plugin_interfaces_1.PluginStatus.ENABLED);
        for (const plugin of enabled) {
            try {
                await this.disablePlugin(plugin.manifest.id);
            }
            catch (error) {
                this.logger.error(`Failed to disable plugin ${plugin.manifest.id} during shutdown`, error instanceof Error ? error.message : String(error), { pluginId: plugin.manifest.id, action: 'plugin_shutdown_disable_failed' });
            }
        }
    }
    setOperatorEnabled(pluginId, enabled) {
        this.pluginStorage.setPluginEnabledByOperator(pluginId, enabled);
    }
    getRegistryEntry(pluginId) {
        return this.pluginStorage.getPluginEntry(pluginId);
    }
    loadPlugin(pluginPath) {
        return this.scanner.loadPlugin(pluginPath);
    }
    enablePlugin(pluginId) {
        return this.lifecycle.enablePlugin(pluginId);
    }
    disablePlugin(pluginId, opts) {
        return this.lifecycle.disablePlugin(pluginId, opts);
    }
    unloadPlugin(pluginId) {
        return this.lifecycle.unloadPlugin(pluginId);
    }
    getPluginsDir() {
        return this.pluginsDir;
    }
    getPluginPackageDir(pluginId) {
        return this.plugins.get(pluginId)?.packageDir ?? path.join(this.pluginsDir, pluginId);
    }
    isBuiltIn(pluginId) {
        return this.pluginStorage.getPluginEntry(pluginId)?.builtIn ?? false;
    }
    uninstallPlugin(pluginId) {
        return this.uninstaller.uninstallPlugin(pluginId);
    }
    updatePluginConfig(pluginId, config) {
        this.lifecycle.updatePluginConfig(pluginId, config);
    }
    setPluginSessions(pluginId, sessions) {
        return this.lifecycle.setPluginSessions(pluginId, sessions);
    }
    setPluginSessionConfig(pluginId, sessionId, config) {
        return this.lifecycle.setPluginSessionConfig(pluginId, sessionId, config);
    }
    checkPluginHealth(pluginId) {
        return this.sandboxBridge.checkPluginHealth(pluginId);
    }
    dispatchWebhookForInstance(d) {
        return this.sandboxBridge.dispatchWebhookForInstance(d);
    }
    createSandboxHost(capDispatcher, onHookSubscribe, onWebhookSubscribe, onLog, runWithHookGuard, onSearchProviderRegister, onWorkerExit) {
        const workerEntry = path.join(__dirname, 'sandbox', 'worker-bootstrap.js');
        return new plugin_worker_host_1.PluginWorkerHost(new worker_thread_channel_1.WorkerThreadChannel({
            workerEntry,
            maxOldGenerationSizeMb: SANDBOX_MAX_OLD_GEN_MB,
            env: buildSandboxWorkerEnv(),
        }), capDispatcher, onHookSubscribe, onWebhookSubscribe, onLog, runWithHookGuard, SANDBOX_MAX_INFLIGHT_CAPS, onSearchProviderRegister, onWorkerExit, this.configService.get('plugins.capTimeoutMs') ?? SANDBOX_CAP_TIMEOUT_MS);
    }
    getPlugin(pluginId) {
        return this.plugins.get(pluginId);
    }
    getAllPlugins() {
        return Array.from(this.plugins.values());
    }
    getPluginsByType(type) {
        return this.getAllPlugins().filter(p => p.manifest.type === type);
    }
    getEnabledPlugins() {
        return this.getAllPlugins().filter(p => p.status === plugin_interfaces_1.PluginStatus.ENABLED);
    }
    isPluginEnabled(pluginId) {
        const plugin = this.plugins.get(pluginId);
        return plugin?.status === plugin_interfaces_1.PluginStatus.ENABLED;
    }
    registerBuiltInPlugin(manifest, instance, config = {}) {
        this.lifecycle.registerBuiltInPlugin(manifest, instance, config);
    }
};
exports.PluginLoaderService = PluginLoaderService;
exports.PluginLoaderService = PluginLoaderService = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [config_1.ConfigService,
        hooks_1.HookManager,
        plugin_storage_service_1.PluginStorageService,
        core_1.ModuleRef,
        lid_mapping_store_service_1.LidMappingStoreService])
], PluginLoaderService);
//# sourceMappingURL=plugin-loader.service.js.map