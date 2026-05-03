"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
const config_1 = __importDefault(require("../config"));
const PoolsRepository_1 = __importDefault(require("../repositories/PoolsRepository"));
const disk_cache_1 = __importDefault(require("./disk-cache"));
const mining_1 = __importDefault(require("./mining/mining"));
const transaction_utils_1 = __importDefault(require("./transaction-utils"));
const BlocksRepository_1 = __importDefault(require("../repositories/BlocksRepository"));
const redis_cache_1 = __importDefault(require("./redis-cache"));
const blocks_1 = __importDefault(require("./blocks"));
class PoolsParser {
    miningPools = [];
    unknownPool = {
        'id': 0,
        'name': 'Unknown',
        'link': 'https://learnmeabitcoin.com/technical/coinbase-transaction',
        'regexes': '[]',
        'addresses': '[]',
        'slug': 'unknown'
    };
    setMiningPools(pools) {
        for (const pool of pools) {
            pool.regexes = pool.tags;
            pool.slug = pool.name.replace(/[^a-z0-9]/gi, '').toLowerCase();
            delete (pool.tags);
        }
        this.miningPools = pools;
    }
    /**
     * Populate our db with updated mining pool definition
     * @param pools
     * @asyncUnsafe
     */
    async migratePoolsJson() {
        // We also need to wipe the backend cache to make sure we don't serve blocks with
        // the wrong mining pool (usually happen with unknown blocks)
        disk_cache_1.default.setIgnoreBlocksCache();
        redis_cache_1.default.setIgnoreBlocksCache();
        await this.$insertUnknownPool();
        let reindexUnknown = false;
        let clearCache = false;
        for (const pool of this.miningPools) {
            if (!pool.id) {
                logger_1.default.info(`Mining pool ${pool.name} has no unique 'id' defined. Skipping.`);
                continue;
            }
            // One of the two fields 'addresses' or 'regexes' must be a non-empty array
            if (!pool.addresses && !pool.regexes) {
                logger_1.default.err(`Mining pool ${pool.name} must have at least one of the fields 'addresses' or 'regexes'. Skipping.`);
                continue;
            }
            pool.addresses = pool.addresses || [];
            pool.regexes = pool.regexes || [];
            if (pool.addresses.length === 0 && pool.regexes.length === 0) {
                logger_1.default.err(`Mining pool ${pool.name} has no 'addresses' nor 'regexes' defined. Skipping.`);
                continue;
            }
            if (pool.addresses.length === 0) {
                logger_1.default.warn(`Mining pool ${pool.name} has no 'addresses' defined.`);
            }
            if (pool.regexes.length === 0) {
                logger_1.default.warn(`Mining pool ${pool.name} has no 'regexes' defined.`);
            }
            const poolDB = await PoolsRepository_1.default.$getPoolByUniqueId(pool.id, false);
            if (!poolDB) {
                // New mining pool
                const slug = pool.name.replace(/[^a-z0-9]/gi, '').toLowerCase();
                logger_1.default.debug(`Inserting new mining pool ${pool.name}`);
                await PoolsRepository_1.default.$insertNewMiningPool(pool, slug);
                reindexUnknown = true;
                clearCache = true;
            }
            else {
                if (poolDB.name !== pool.name) {
                    // Pool has been renamed
                    const newSlug = pool.name.replace(/[^a-z0-9]/gi, '').toLowerCase();
                    logger_1.default.warn(`Renaming ${poolDB.name} mining pool to ${pool.name}. Slug has been updated. Maybe you want to make a redirection from 'https://mempool.space/mining/pool/${poolDB.slug}' to 'https://mempool.space/mining/pool/${newSlug}`);
                    await PoolsRepository_1.default.$renameMiningPool(poolDB.id, newSlug, pool.name);
                    clearCache = true;
                }
                if (poolDB.link !== pool.link) {
                    // Pool link has changed
                    logger_1.default.debug(`Updating link for ${pool.name} mining pool`);
                    await PoolsRepository_1.default.$updateMiningPoolLink(poolDB.id, pool.link);
                    clearCache = true;
                }
                if (JSON.stringify(pool.addresses) !== poolDB.addresses ||
                    JSON.stringify(pool.regexes) !== poolDB.regexes) {
                    // Pool addresses changed or coinbase tags changed
                    logger_1.default.notice(`Updating addresses and/or coinbase tags for ${pool.name} mining pool.`);
                    await PoolsRepository_1.default.$updateMiningPoolTags(poolDB.id, pool.addresses, pool.regexes);
                    reindexUnknown = true;
                    clearCache = true;
                    await this.$reindexBlocksForPool(poolDB.id);
                }
            }
        }
        if (reindexUnknown) {
            logger_1.default.notice(`Updating addresses and/or coinbase tags for unknown mining pool.`);
            let unknownPool;
            if (config_1.default.DATABASE.ENABLED === true) {
                unknownPool = await PoolsRepository_1.default.$getUnknownPool();
            }
            else {
                unknownPool = this.unknownPool;
            }
            await this.$reindexBlocksForPool(unknownPool.id);
        }
        // refresh the in-memory block cache with the reindexed data
        if (clearCache) {
            for (const block of blocks_1.default.getBlocks()) {
                const reindexedBlock = await blocks_1.default.$indexBlock(block.id);
                block.extras.pool = reindexedBlock.extras.pool;
            }
            // update persistent cache with the reindexed data
            void disk_cache_1.default.$saveCacheToDisk();
            void redis_cache_1.default.$updateBlocks(blocks_1.default.getBlocks());
        }
    }
    matchBlockMiner(scriptsig, addresses, pools) {
        const asciiScriptSig = transaction_utils_1.default.hex2ascii(scriptsig);
        for (let i = 0; i < pools.length; ++i) {
            if (addresses.length) {
                const poolAddresses = typeof pools[i].addresses === 'string' ?
                    JSON.parse(pools[i].addresses) : pools[i].addresses;
                for (let y = 0; y < poolAddresses.length; y++) {
                    if (addresses.indexOf(poolAddresses[y]) !== -1) {
                        return pools[i];
                    }
                }
            }
            const regexes = typeof pools[i].regexes === 'string' ?
                JSON.parse(pools[i].regexes) : pools[i].regexes;
            for (let y = 0; y < regexes.length; ++y) {
                const regex = new RegExp(regexes[y], 'i');
                const match = asciiScriptSig.match(regex);
                if (match !== null) {
                    return pools[i];
                }
            }
        }
    }
    /**
     * Manually add the 'unknown pool'
     * @asyncSafe
     */
    async $insertUnknownPool() {
        if (!config_1.default.DATABASE.ENABLED) {
            return;
        }
        try {
            const [rows] = await database_1.default.query({ sql: 'SELECT name from pools where name="Unknown"', timeout: 120000 });
            if (rows.length === 0) {
                await database_1.default.query({
                    sql: `INSERT INTO pools(name, link, regexes, addresses, slug, unique_id)
          VALUES("${this.unknownPool.name}", "${this.unknownPool.link}", "[]", "[]", "${this.unknownPool.slug}", 0);
        `
                });
            }
            else {
                await database_1.default.query(`UPDATE pools
          SET name='${this.unknownPool.name}', link='${this.unknownPool.link}',
          regexes='[]', addresses='[]',
          slug='${this.unknownPool.slug}',
          unique_id=0
          WHERE slug='${this.unknownPool.slug}'
        `);
            }
        }
        catch (e) {
            logger_1.default.err(`Unable to insert or update "Unknown" mining pool. Reason: ${e instanceof Error ? e.message : e}`);
        }
    }
    /**
     * re-index pool assignment for blocks previously associated with pool
     *
     * @param pool local id of existing pool to reindex
     * @asyncUnsafe
     */
    async $reindexBlocksForPool(poolId) {
        let firstKnownBlockPool = 130635; // https://mempool.space/block/0000000000000a067d94ff753eec72830f1205ad3a4c216a08a80c832e551a52
        if (config_1.default.MEMPOOL.NETWORK === 'testnet') {
            firstKnownBlockPool = 21106; // https://mempool.space/testnet/block/0000000070b701a5b6a1b965f6a38e0472e70b2bb31b973e4638dec400877581
        }
        else if (['signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
            firstKnownBlockPool = 0;
        }
        const [blocks] = await database_1.default.query(`
      SELECT height, hash, coinbase_raw, coinbase_addresses
      FROM blocks
      WHERE pool_id = ?
      AND height >= ?
      ORDER BY height DESC
    `, [poolId, firstKnownBlockPool]);
        let pools = [];
        if (config_1.default.DATABASE.ENABLED === true) {
            pools = await PoolsRepository_1.default.$getPools();
        }
        else {
            pools = this.miningPools;
        }
        let changed = 0;
        for (const block of blocks) {
            const addresses = JSON.parse(block.coinbase_addresses) || [];
            const newPool = this.matchBlockMiner(block.coinbase_raw, addresses, pools);
            if (newPool && newPool.id !== poolId) {
                changed++;
                await BlocksRepository_1.default.$savePool(block.hash, newPool.id);
            }
        }
        logger_1.default.info(`${changed} blocks assigned to a new pool`, logger_1.default.tags.mining);
        // Re-index hashrates and difficulty adjustments later
        mining_1.default.reindexHashrateRequested = true;
    }
}
exports.default = new PoolsParser();
