import type { MigrationTables } from './migration-tables.types';
export interface ExportTable<K extends keyof MigrationTables = keyof MigrationTables> {
    key: K;
    table: string;
    optional?: boolean;
    afterRead?: (rows: MigrationTables[K]) => void;
    inlineMedia?: {
        bucket: 'messages' | 'messageBatches';
        newestFirst: (row: MigrationTables[K][number]) => number;
        strip: (row: MigrationTables[K][number], exceedsBudget: (encodedBytes: number) => boolean) => void;
    };
}
export type AnyExportTable = Omit<ExportTable, 'afterRead' | 'inlineMedia'> & {
    afterRead?: (rows: never[]) => void;
    inlineMedia?: {
        bucket: 'messages' | 'messageBatches';
        newestFirst: (row: never) => number;
        strip: (row: never, exceedsBudget: (encodedBytes: number) => boolean) => void;
    };
};
export declare const EXPORT_TABLES: AnyExportTable[];
export declare const EXPORT_TABLE_EXCLUSIONS: Readonly<Record<string, string>>;
