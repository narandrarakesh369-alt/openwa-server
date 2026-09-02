import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../session/session.service';
import { LidMappingStoreService } from '../../engine/identity/lid-mapping-store.service';
import { SessionOwnershipService } from '../session/session-ownership.service';
import type { MigrationTables, TableCounts } from './migration-tables.types';
export interface SessionOwnershipRow {
    id: string;
    nodeId: string | null;
    claimedAt: unknown;
    leaseExpiresAt: unknown;
    nodeUrl: string | null;
}
export declare function restoreSessionOwnership(preserved: SessionOwnershipRow[] | null, insert: (text: string, params: unknown[]) => Promise<unknown>, readAt: Date, now?: Date): Promise<void>;
export interface InfraExportDataResult {
    exportedAt: string;
    dataDbType: string;
    tables: MigrationTables;
    counts: TableCounts;
    skippedTables: string[];
    omittedInlineMedia: {
        messages: number;
        messageBatches: number;
    };
}
export interface InfraImportDataResult {
    imported: boolean;
    counts: TableCounts;
    warnings: string[];
    notices: string[];
    restartRequired: boolean;
    orphanedEngines: string[];
    stoppedOrphanEngines: string[];
    failedOrphanEngines: string[];
}
export declare class InfraDataService {
    private readonly configService;
    private readonly dataDataSource;
    private readonly auditService?;
    private readonly sessionService?;
    private readonly lidMappingStore?;
    private readonly ownership?;
    private readonly logger;
    private importInFlight;
    constructor(configService: ConfigService, dataDataSource: DataSource, auditService?: AuditService | undefined, sessionService?: SessionService | undefined, lidMappingStore?: LidMappingStoreService | undefined, ownership?: SessionOwnershipService | undefined);
    private assertExportRegistryMatchesMetadata;
    exportData(): Promise<InfraExportDataResult>;
    importData(data: {
        tables: Partial<MigrationTables>;
        force?: boolean;
        stopOrphans?: boolean;
    }): Promise<InfraImportDataResult>;
    private runImport;
}
