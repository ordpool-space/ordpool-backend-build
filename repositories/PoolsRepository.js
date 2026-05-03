"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("../api/common");
const pools_parser_1 = __importDefault(require("../api/pools-parser"));
const config_1 = __importDefault(require("../config"));
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
class PoolsRepository {
    /**
     * Get all pools tagging info
     * @asyncUnsafe
     */
    async $getPools() {
        const [rows] = await database_1.default.query('SELECT id, unique_id as uniqueId, name, addresses, regexes, slug FROM pools');
        return rows;
    }
    /**
     * Get unknown pool tagging info
     * @asyncUnsafe
     */
    async $getUnknownPool() {
        let [rows] = await database_1.default.query('SELECT id, unique_id as uniqueId, name, slug FROM pools where name = "Unknown"');
        if (rows && rows.length === 0 && config_1.default.DATABASE.ENABLED) {
            await pools_parser_1.default.$insertUnknownPool();
            [rows] = await database_1.default.query('SELECT id, unique_id as uniqueId, name, slug FROM pools where name = "Unknown"');
        }
        return rows[0];
    }
    /**
     * Get basic pool info and block count
     * @asyncSafe
     */
    async $getPoolsInfo(interval = null) {
        interval = common_1.Common.getSqlInterval(interval);
        let query = `
      SELECT
        COUNT(blocks.height) As blockCount,
          pool_id AS poolId,
          pools.name AS name,
          pools.link AS link,
          slug,
          AVG(blocks_audits.match_rate) AS avgMatchRate,
          AVG((CAST(blocks.fees as SIGNED) - CAST(blocks_audits.expected_fees as SIGNED)) / NULLIF(CAST(blocks_audits.expected_fees as SIGNED), 0)) AS avgFeeDelta,
          unique_id as poolUniqueId
      FROM blocks
      JOIN pools on pools.id = pool_id
      LEFT JOIN blocks_audits ON blocks_audits.height = blocks.height
      WHERE blocks.stale = 0
    `;
        if (interval) {
            query += ` AND blocks.blockTimestamp BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()`;
        }
        query += ` GROUP BY pool_id
      ORDER BY COUNT(blocks.height) DESC`;
        try {
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err(`Cannot generate pools stats. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get basic pool info and block count between two timestamp
     * @asyncSafe
     */
    async $getPoolsInfoBetween(from, to) {
        const query = `SELECT COUNT(height) as blockCount, pools.id as poolId, pools.name as poolName
      FROM pools
      LEFT JOIN blocks on pools.id = blocks.pool_id AND blocks.blockTimestamp BETWEEN FROM_UNIXTIME(?) AND FROM_UNIXTIME(?)
      WHERE blocks.stale = 0
      GROUP BY pools.id`;
        try {
            const [rows] = await database_1.default.query(query, [from, to]);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot generate pools blocks count. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get a mining pool info
     * @asyncSafe
     */
    async $getPool(slug, parse = true) {
        const query = `
      SELECT *
      FROM pools
      WHERE pools.slug = ?`;
        try {
            const [rows] = await database_1.default.query(query, [slug]);
            if (rows.length < 1) {
                return null;
            }
            if (parse) {
                rows[0].regexes = JSON.parse(rows[0].regexes);
            }
            if (['testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
                rows[0].addresses = []; // pools-v2.json only contains mainnet addresses
            }
            else if (parse) {
                rows[0].addresses = JSON.parse(rows[0].addresses);
            }
            return rows[0];
        }
        catch (e) {
            logger_1.default.err('Cannot get pool from db. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get a mining pool info by its unique id
     * @asyncSafe
     */
    async $getPoolByUniqueId(id, parse = true) {
        const query = `
      SELECT *
      FROM pools
      WHERE pools.unique_id = ?`;
        try {
            const [rows] = await database_1.default.query(query, [id]);
            if (rows.length < 1) {
                return null;
            }
            if (parse) {
                rows[0].regexes = JSON.parse(rows[0].regexes);
            }
            if (['testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
                rows[0].addresses = []; // pools.json only contains mainnet addresses
            }
            else if (parse) {
                rows[0].addresses = JSON.parse(rows[0].addresses);
            }
            return rows[0];
        }
        catch (e) {
            logger_1.default.err('Cannot get pool from db. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Insert a new mining pool in the database
     *
     * @param pool
     * @asyncSafe
     */
    async $insertNewMiningPool(pool, slug) {
        try {
            await database_1.default.query(`
        INSERT INTO pools
        SET name = ?, link = ?, addresses = ?, regexes = ?, slug = ?, unique_id = ?`, [pool.name, pool.link, JSON.stringify(pool.addresses), JSON.stringify(pool.regexes), slug, pool.id]);
        }
        catch (e) {
            logger_1.default.err(`Cannot insert new mining pool into db. Reason: ` + (e instanceof Error ? e.message : e));
        }
    }
    /**
     * Rename an existing mining pool
     *
     * @param dbId
     * @param newSlug
     * @param newName
     * @asyncSafe
     */
    async $renameMiningPool(dbId, newSlug, newName) {
        try {
            await database_1.default.query(`
        UPDATE pools
        SET slug = ?, name = ?
        WHERE id = ?`, [newSlug, newName, dbId]);
        }
        catch (e) {
            logger_1.default.err(`Cannot rename mining pool id ${dbId}. Reason: ` + (e instanceof Error ? e.message : e));
        }
    }
    /**
     * Update an exisiting mining pool link
     *
     * @param dbId
     * @param newLink
     * @asyncSafe
     */
    async $updateMiningPoolLink(dbId, newLink) {
        try {
            await database_1.default.query(`
        UPDATE pools
        SET link = ?
        WHERE id = ?`, [newLink, dbId]);
        }
        catch (e) {
            logger_1.default.err(`Cannot update link for mining pool id ${dbId}. Reason: ` + (e instanceof Error ? e.message : e));
        }
    }
    /**
     * Update an existing mining pool addresses or coinbase tags
     *
     * @param dbId
     * @param addresses
     * @param regexes
     * @asyncSafe
     */
    async $updateMiningPoolTags(dbId, addresses, regexes) {
        try {
            await database_1.default.query(`
        UPDATE pools
        SET addresses = ?, regexes = ?
        WHERE id = ?`, [JSON.stringify(addresses), JSON.stringify(regexes), dbId]);
        }
        catch (e) {
            logger_1.default.err(`Cannot update mining pool id ${dbId}. Reason: ` + (e instanceof Error ? e.message : e));
        }
    }
}
exports.default = new PoolsRepository();
