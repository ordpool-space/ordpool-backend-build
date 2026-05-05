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
    /**
     * Returns up to `limit` skipped block heights, ordered by height ASC.
     * The /health/indexer-progress route ships these with the payload so the
     * block-detail page can answer "was this specific block skipped?" without
     * a per-block round-trip.
     *
     * Skipping is at BLOCK granularity: when any artifact in a block crashes
     * the parser POISON_THRESHOLD times in a row, the whole block goes into
     * `ordpool_stats_skipped` and every artifact inside it stays unindexed
     * until the parser fix lands and the row gets cleared. The list stays
     * small in practice (one entry per known-bad block); the cap is defensive
     * against a parser regression that could batch-poison many heights.
     */
    async getSkippedHeights(limit = 200) {
        const [rows] = await database_1.default.query(`SELECT height FROM ordpool_stats_skipped ORDER BY height ASC LIMIT ?`, [limit]);
        return rows.map((r) => r.height);
    }
}
exports.default = new OrdpoolSkippedBlocksRepository();
