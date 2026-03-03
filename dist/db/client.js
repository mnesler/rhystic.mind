import pg from "pg";
import { applySchema } from "./schema.js";
const { Pool } = pg;
let _pool = null;
let _initPromise = null;
export async function initDatabase(databaseUrl) {
    if (_pool)
        return _pool;
    if (_initPromise)
        return _initPromise;
    _initPromise = (async () => {
        _pool = new Pool({
            connectionString: databaseUrl,
            ssl: false,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        });
        try {
            await _pool.query("SELECT 1");
            console.log("Connected to PostgreSQL");
        }
        catch (err) {
            console.error("Failed to connect to PostgreSQL:", err);
            throw err;
        }
        await applySchema(_pool);
        return _pool;
    })();
    return _initPromise;
}
export function getPool() {
    if (!_pool) {
        throw new Error("Database not initialized. Call initDatabase() first.");
    }
    return _pool;
}
export function query(sql, params) {
    return getPool().query(sql, params);
}
export function getOne(sql, params) {
    return getPool().query(sql, params).then(r => r.rows[0] ?? null);
}
export function getAll(sql, params) {
    return getPool().query(sql, params).then(r => r.rows);
}
//# sourceMappingURL=client.js.map