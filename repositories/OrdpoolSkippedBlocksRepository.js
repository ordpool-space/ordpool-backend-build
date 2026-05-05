"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
class OrdpoolSkippedBlocksRepository {
    async upsertSkippedBlock(height, hash, lastError) {
        try {
            await database_1.default.query(`INSERT INTO ordpool_stats_skipped (height, hash, failure_count, last_error)
         VALUES (?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           hash = VALUES(hash),
           failure_count = failure_count + 1,
           last_error = VALUES(last_error)`, [height, hash, lastError]);
        }
        catch (e) {
            logger_1.default.err('Cannot upsert ordpool_stats_skipped row. Reason: ' + (e instanceof Error ? e.message : e), 'Ordpool');
            throw e;
        }
    }
    async getSkippedCount() {
        const [rows] = await database_1.default.query(`SELECT COUNT(*) AS c FROM ordpool_stats_skipped`);
        return rows[0]?.c ?? 0;
    }
}
exports.default = new OrdpoolSkippedBlocksRepository();
