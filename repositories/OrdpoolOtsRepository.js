"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
function toHex(buf) {
    if (!buf)
        return null;
    return buf.toString('hex');
}
function rowToOrdpoolOts(r) {
    return {
        txid: r.txid,
        calendar: r.calendar,
        merkleRoot: toHex(r.merkle_root) ?? '',
        firstSeenAt: r.first_seen_at,
        confirmedAt: r.confirmed_at,
        blockhash: r.blockhash,
        blockheight: r.blockheight,
        blocktime: r.blocktime,
        fee: r.fee,
        feerate: r.feerate,
    };
}
class OrdpoolOtsRepository {
    /**
     * Insert a newly-observed pending OTS commit. Idempotent: re-inserting an
     * existing row is a no-op (we don't downgrade a confirmed row to pending).
     */
    async upsertPending(input) {
        try {
            await database_1.default.query(`INSERT INTO ordpool_stats_ots (txid, calendar, merkle_root)
         VALUES (?, ?, UNHEX(?))
         ON DUPLICATE KEY UPDATE txid = txid`, [input.txid, input.calendar, input.merkleRoot]);
        }
        catch (e) {
            logger_1.default.err('Cannot upsert pending ordpool_stats_ots row. Reason: ' + (e instanceof Error ? e.message : e), 'Ordpool');
            throw e;
        }
    }
    /**
     * Insert a confirmed OTS commit, or upgrade an existing pending row.
     * Idempotent: re-confirming preserves the original `first_seen_at` and
     * `confirmed_at`; only the chain-derived fields refresh.
     */
    async upsertConfirmed(input) {
        try {
            await database_1.default.query(`INSERT INTO ordpool_stats_ots
           (txid, calendar, merkle_root, confirmed_at, blockhash, blockheight, blocktime, fee, feerate)
         VALUES (?, ?, UNHEX(?), NOW(), ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           confirmed_at = COALESCE(confirmed_at, NOW()),
           blockhash = VALUES(blockhash),
           blockheight = VALUES(blockheight),
           blocktime = VALUES(blocktime),
           fee = VALUES(fee),
           feerate = VALUES(feerate)`, [
                input.txid, input.calendar, input.merkleRoot,
                input.blockhash, input.blockheight, input.blocktime, input.fee, input.feerate,
            ]);
        }
        catch (e) {
            logger_1.default.err('Cannot upsert confirmed ordpool_stats_ots row. Reason: ' + (e instanceof Error ? e.message : e), 'Ordpool');
            throw e;
        }
    }
    async getByTxid(txid) {
        const [rows] = await database_1.default.query(`SELECT txid, calendar, merkle_root, first_seen_at, confirmed_at,
              blockhash, blockheight, blocktime, fee, feerate
         FROM ordpool_stats_ots WHERE txid = ?`, [txid]);
        if (!rows || rows.length === 0)
            return null;
        return rowToOrdpoolOts(rows[0]);
    }
    /**
     * Bulk read every txid in the table. Used to populate the in-memory set on
     * backend boot; never serves user-facing requests.
     */
    async getAllTxids() {
        const [rows] = await database_1.default.query(`SELECT txid FROM ordpool_stats_ots`);
        return rows.map((r) => r.txid);
    }
    /** Per-calendar summary for the /ots/calendars dashboard. */
    async getCalendarStats() {
        const [rows] = await database_1.default.query(`SELECT
         calendar,
         COUNT(*) AS total_commits,
         MAX(blockheight) AS last_blockheight,
         MAX(blocktime)   AS last_blocktime,
         SUM(CASE WHEN confirmed_at IS NULL THEN 1 ELSE 0 END) AS pending_count
       FROM ordpool_stats_ots
       GROUP BY calendar
       ORDER BY total_commits DESC`);
        return rows.map((r) => ({
            calendar: r.calendar,
            totalCommits: Number(r.total_commits),
            lastBlockheight: r.last_blockheight === null ? null : Number(r.last_blockheight),
            lastBlocktime: r.last_blocktime === null ? null : Number(r.last_blocktime),
            pendingCount: Number(r.pending_count),
        }));
    }
    /** Most-recent confirmed commits across all calendars. */
    async getRecent(limit = 50) {
        const [rows] = await database_1.default.query(`SELECT txid, calendar, merkle_root, first_seen_at, confirmed_at,
              blockhash, blockheight, blocktime, fee, feerate
         FROM ordpool_stats_ots
         WHERE confirmed_at IS NOT NULL
         ORDER BY blockheight DESC, blocktime DESC
         LIMIT ?`, [limit]);
        return rows.map(rowToOrdpoolOts);
    }
    /** All commits in a given block. Used by block-page enrichment. */
    async getByBlockheight(blockheight) {
        const [rows] = await database_1.default.query(`SELECT txid, calendar, merkle_root, first_seen_at, confirmed_at,
              blockhash, blockheight, blocktime, fee, feerate
         FROM ordpool_stats_ots WHERE blockheight = ?`, [blockheight]);
        return rows.map(rowToOrdpoolOts);
    }
}
exports.default = new OrdpoolOtsRepository();
