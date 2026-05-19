"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
class AlkaneMetadataRepository {
    async $getByAlkaneId(alkaneId) {
        try {
            const [rows] = await database_1.default.query(`SELECT alkane_id, name, symbol, total_supply, fetched_at, last_error, fetch_attempts
         FROM alkane_metadata WHERE alkane_id = ?`, [alkaneId]);
            const r = rows[0];
            if (!r) {
                return null;
            }
            return {
                alkaneId: r.alkane_id,
                name: r.name ?? null,
                symbol: r.symbol ?? null,
                totalSupply: r.total_supply != null ? String(r.total_supply) : null,
                fetchedAt: r.fetched_at instanceof Date ? r.fetched_at : new Date(r.fetched_at),
                lastError: r.last_error ?? null,
                fetchAttempts: Number(r.fetch_attempts ?? 0),
            };
        }
        catch (e) {
            logger_1.default.err(`AlkaneMetadataRepository.$getByAlkaneId: ${e instanceof Error ? e.message : e}`);
            throw e;
        }
    }
    async $upsert(row) {
        try {
            await database_1.default.query(`INSERT INTO alkane_metadata
           (alkane_id, name, symbol, total_supply, fetched_at, last_error, fetch_attempts)
         VALUES (?, ?, ?, ?, NOW(), ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           symbol = VALUES(symbol),
           total_supply = VALUES(total_supply),
           fetched_at = VALUES(fetched_at),
           last_error = VALUES(last_error),
           fetch_attempts = VALUES(fetch_attempts)`, [
                row.alkaneId,
                row.name,
                row.symbol,
                row.totalSupply,
                row.lastError,
                row.fetchAttempts ?? (row.lastError ? 1 : 0),
            ]);
        }
        catch (e) {
            logger_1.default.err(`AlkaneMetadataRepository.$upsert: ${e instanceof Error ? e.message : e}`);
            throw e;
        }
    }
}
exports.default = new AlkaneMetadataRepository();
