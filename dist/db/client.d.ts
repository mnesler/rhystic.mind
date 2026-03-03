import pg from "pg";
export declare function initDatabase(databaseUrl: string): Promise<pg.Pool>;
export declare function getPool(): pg.Pool;
export declare function query<T = any>(sql: string, params?: any[]): Promise<pg.QueryResult<T>>;
export declare function getOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
export declare function getAll<T = any>(sql: string, params?: any[]): Promise<T[]>;
export type { Pool, QueryResult, QueryResultRow } from "pg";
//# sourceMappingURL=client.d.ts.map