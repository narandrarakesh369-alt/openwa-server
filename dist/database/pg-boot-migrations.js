"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POSTGRES_BOOT_MIGRATION_LOCK_KEYS = void 0;
exports.createBootDataSource = createBootDataSource;
const pg_1 = require("pg");
const typeorm_1 = require("typeorm");
exports.POSTGRES_BOOT_MIGRATION_LOCK_KEYS = [0x4f5741, 0x626f6f74];
async function createBootDataSource(options, deps = {}) {
    const createDataSource = deps.createDataSource ?? (opts => new typeorm_1.DataSource(opts));
    const createLockClient = deps.createLockClient ?? (config => new pg_1.Client(config));
    if (options?.type !== 'postgres') {
        return createDataSource(options);
    }
    const dataSource = createDataSource({ ...options, migrationsRun: false });
    try {
        await dataSource.initialize();
        const lockClient = createLockClient(lockClientConfig(options));
        try {
            await lockClient.connect();
            await lockClient.query('SELECT pg_advisory_lock($1, $2)', [...exports.POSTGRES_BOOT_MIGRATION_LOCK_KEYS]);
            try {
                await dataSource.runMigrations({ transaction: options.migrationsTransactionMode });
            }
            finally {
                await lockClient
                    .query('SELECT pg_advisory_unlock($1, $2)', [...exports.POSTGRES_BOOT_MIGRATION_LOCK_KEYS])
                    .catch(() => undefined);
            }
        }
        finally {
            await lockClient.end().catch(() => undefined);
        }
    }
    catch (error) {
        await dataSource.destroy().catch(() => undefined);
        throw error;
    }
    return dataSource;
}
function lockClientConfig(options) {
    const extra = (options.extra ?? {});
    return {
        host: options.host,
        port: options.port,
        user: options.username,
        password: options.password,
        database: options.database,
        ssl: options.ssl,
        connectionTimeoutMillis: extra.connectionTimeoutMillis ?? 10000,
        options: '-c statement_timeout=0',
    };
}
//# sourceMappingURL=pg-boot-migrations.js.map