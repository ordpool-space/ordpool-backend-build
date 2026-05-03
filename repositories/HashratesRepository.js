"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("../api/common");
const mining_1 = __importDefault(require("../api/mining/mining"));
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
const PoolsRepository_1 = __importDefault(require("./PoolsRepository"));
class HashratesRepository {
    /**
     * Save indexed block data in the database
     */
    async $saveHashrates(hashrates) {
        if (hashrates.length === 0) {
            return;
        }
        let query = `INSERT INTO
      hashrates(hashrate_timestamp, avg_hashrate, pool_id, share, type) VALUES`;
        for (const hashrate of hashrates) {
            query += ` (FROM_UNIXTIME(${hashrate.hashrateTimestamp}), ${hashrate.avgHashrate}, ${hashrate.poolId}, ${hashrate.share}, "${hashrate.type}"),`;
        }
        query = query.slice(0, -1);
        try {
            await database_1.default.query(query);
        }
        catch (e) {
            logger_1.default.err('Cannot save indexed hashrate into db. Reason: ' + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
            throw e;
        }
    }
    async $getRawNetworkDailyHashrate(interval) {
        interval = common_1.Common.getSqlInterval(interval);
        let query = `SELECT
      UNIX_TIMESTAMP(hashrate_timestamp) as timestamp,
      avg_hashrate as avgHashrate
      FROM hashrates`;
        if (interval) {
            query += ` WHERE hashrate_timestamp BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()
        AND hashrates.type = 'daily'`;
        }
        else {
            query += ` WHERE hashrates.type = 'daily'`;
        }
        query += ` ORDER by hashrate_timestamp`;
        try {
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot fetch network hashrate history. Reason: ' + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
            throw e;
        }
    }
    async $getNetworkDailyHashrate(interval) {
        interval = common_1.Common.getSqlInterval(interval);
        let query = `SELECT
      CAST(AVG(UNIX_TIMESTAMP(hashrate_timestamp)) as INT) as timestamp,
      CAST(AVG(avg_hashrate) as DOUBLE) as avgHashrate
      FROM hashrates`;
        if (interval) {
            query += ` WHERE hashrate_timestamp BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()
        AND hashrates.type = 'daily'`;
        }
        else {
            query += ` WHERE hashrates.type = 'daily'`;
        }
        query += ` GROUP BY UNIX_TIMESTAMP(hashrate_timestamp) DIV ${86400}`;
        query += ` ORDER by hashrate_timestamp`;
        try {
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot fetch network hashrate history. Reason: ' + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
            throw e;
        }
    }
    async $getWeeklyHashrateTimestamps() {
        const query = `SELECT UNIX_TIMESTAMP(hashrate_timestamp) as timestamp
      FROM hashrates
      WHERE type = 'weekly'
      GROUP BY hashrate_timestamp`;
        try {
            const [rows] = await database_1.default.query(query);
            return rows.map(row => row.timestamp);
        }
        catch (e) {
            logger_1.default.err('Cannot retrieve indexed weekly hashrate timestamps. Reason: ' + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
            throw e;
        }
    }
    /**
     * Returns the current biggest pool hashrate history
     */
    async $getPoolsWeeklyHashrate(interval) {
        interval = common_1.Common.getSqlInterval(interval);
        const topPoolsId = (await PoolsRepository_1.default.$getPoolsInfo('1w')).map((pool) => pool.poolId);
        if (topPoolsId.length === 0) {
            return [];
        }
        let query = `SELECT UNIX_TIMESTAMP(hashrate_timestamp) as timestamp, avg_hashrate as avgHashrate, share, pools.name as poolName
      FROM hashrates
      JOIN pools on pools.id = pool_id`;
        if (interval) {
            query += ` WHERE hashrate_timestamp BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()
        AND hashrates.type = 'weekly'
        AND pool_id IN (${topPoolsId})`;
        }
        else {
            query += ` WHERE hashrates.type = 'weekly'
        AND pool_id IN (${topPoolsId})`;
        }
        query += ` ORDER by hashrate_timestamp, FIELD(pool_id, ${topPoolsId})`;
        try {
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot fetch weekly pools hashrate history. Reason: ' + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
            throw e;
        }
    }
    /**
     * Returns a pool hashrate history
     */
    async $getPoolWeeklyHashrate(slug) {
        const pool = await PoolsRepository_1.default.$getPool(slug);
        if (!pool) {
            throw new Error('This mining pool does not exist');
        }
        // Find hashrate boundaries
        let query = `SELECT MIN(hashrate_timestamp) as firstTimestamp, MAX(hashrate_timestamp) as lastTimestamp
      FROM hashrates
      JOIN pools on pools.id = pool_id
      WHERE hashrates.type = 'weekly' AND pool_id = ? AND avg_hashrate != 0
      ORDER by hashrate_timestamp LIMIT 1`;
        let boundaries = {
            firstTimestamp: '1970-01-01',
            lastTimestamp: '9999-01-01'
        };
        try {
            const [rows] = await database_1.default.query(query, [pool.id]);
            boundaries = rows[0];
        }
        catch (e) {
            logger_1.default.err('Cannot fetch hashrate start/end timestamps for this pool. Reason: ' + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
        }
        // Get hashrates entries between boundaries
        query = `SELECT UNIX_TIMESTAMP(hashrate_timestamp) as timestamp, avg_hashrate as avgHashrate, share, pools.name as poolName
      FROM hashrates
      JOIN pools on pools.id = pool_id
      WHERE hashrates.type = 'weekly' AND hashrate_timestamp BETWEEN ? AND ?
      AND pool_id = ?
      ORDER by hashrate_timestamp`;
        try {
            const [rows] = await database_1.default.query(query, [boundaries.firstTimestamp, boundaries.lastTimestamp, pool.id]);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot fetch pool hashrate history for this pool. Reason: ' + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
            throw e;
        }
    }
    /**
     * Get latest run timestamp
     */
    async $getLatestRun(key) {
        const query = `SELECT number FROM state WHERE name = ?`;
        try {
            const [rows] = await database_1.default.query(query, [key]);
            if (rows.length === 0) {
                return 0;
            }
            return rows[0]['number'];
        }
        catch (e) {
            logger_1.default.err(`Cannot retrieve last indexing run for ${key}. Reason: ` + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
            throw e;
        }
    }
    /**
     * Delete most recent data points for re-indexing
     */
    async $deleteLastEntries() {
        logger_1.default.info(`Delete latest hashrates data points from the database`, logger_1.default.tags.mining);
        try {
            const [rows] = await database_1.default.query(`SELECT MAX(hashrate_timestamp) as timestamp FROM hashrates GROUP BY type`);
            for (const row of rows) {
                await database_1.default.query(`DELETE FROM hashrates WHERE hashrate_timestamp = ?`, [row.timestamp]);
            }
            // Re-run the hashrate indexing to fill up missing data
            mining_1.default.lastHashrateIndexingDate = null;
            mining_1.default.lastWeeklyHashrateIndexingDate = null;
        }
        catch (e) {
            logger_1.default.err('Cannot delete latest hashrates data points. Reason: ' + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
        }
    }
    /**
     * Delete hashrates from the database from timestamp
     */
    async $deleteHashratesFromTimestamp(timestamp) {
        logger_1.default.info(`Delete newer hashrates from timestamp ${new Date(timestamp * 1000).toUTCString()} from the database`, logger_1.default.tags.mining);
        try {
            await database_1.default.query(`DELETE FROM hashrates WHERE hashrate_timestamp >= FROM_UNIXTIME(?)`, [timestamp]);
            // Re-run the hashrate indexing to fill up missing data
            mining_1.default.lastHashrateIndexingDate = null;
            mining_1.default.lastWeeklyHashrateIndexingDate = null;
        }
        catch (e) {
            logger_1.default.err('Cannot delete latest hashrates data points. Reason: ' + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
        }
    }
}
exports.default = new HashratesRepository();
