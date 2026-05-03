"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const redis_1 = require("redis");
const mempool_1 = __importDefault(require("./mempool"));
const blocks_1 = __importDefault(require("./blocks"));
const logger_1 = __importDefault(require("../logger"));
const config_1 = __importDefault(require("../config"));
const rbf_cache_1 = __importDefault(require("./rbf-cache"));
const transaction_utils_1 = __importDefault(require("./transaction-utils"));
var NetworkDB;
(function (NetworkDB) {
    NetworkDB[NetworkDB["mainnet"] = 0] = "mainnet";
    NetworkDB[NetworkDB["testnet"] = 1] = "testnet";
    NetworkDB[NetworkDB["signet"] = 2] = "signet";
    NetworkDB[NetworkDB["liquid"] = 3] = "liquid";
    NetworkDB[NetworkDB["liquidtestnet"] = 4] = "liquidtestnet";
})(NetworkDB || (NetworkDB = {}));
class RedisCache {
    client;
    connected = false;
    schemaVersion = 1;
    redisConfig;
    pauseFlush = false;
    cacheQueue = [];
    removeQueue = [];
    rbfCacheQueue = [];
    rbfRemoveQueue = [];
    txFlushLimit = 10000;
    ignoreBlocksCache = false;
    constructor() {
        if (config_1.default.REDIS.ENABLED) {
            this.redisConfig = {
                socket: {
                    path: config_1.default.REDIS.UNIX_SOCKET_PATH,
                    // HACK: add redis hostname:port
                    host: config_1.default.REDIS.HOST,
                    port: config_1.default.REDIS.PORT,
                },
                database: NetworkDB[config_1.default.MEMPOOL.NETWORK],
            };
            void this.$ensureConnected();
            setInterval(() => { void this.$ensureConnected(); }, 10000);
        }
    }
    /** @asyncSafe */
    async $ensureConnected() {
        if (!this.connected && config_1.default.REDIS.ENABLED) {
            try {
                this.client = (0, redis_1.createClient)(this.redisConfig);
                this.client.on('error', async (e) => {
                    logger_1.default.err(`Error in Redis client: ${e instanceof Error ? e.message : e}`);
                    this.connected = false;
                    await this.client.disconnect();
                });
                await this.client.connect().then(async () => {
                    try {
                        const version = await this.client.get('schema_version');
                        this.connected = true;
                        if (version !== this.schemaVersion) {
                            // schema changed
                            // perform migrations or flush DB if necessary
                            logger_1.default.info(`Redis schema version changed from ${version} to ${this.schemaVersion}`);
                            await this.client.set('schema_version', this.schemaVersion);
                        }
                        logger_1.default.info(`Redis client connected`);
                        return true;
                    }
                    catch (e) {
                        this.connected = false;
                        logger_1.default.warn('Failed to connect to Redis');
                        return false;
                    }
                });
                await this.$onConnected();
                return true;
            }
            catch (e) {
                logger_1.default.warn('Error connecting to Redis: ' + (e instanceof Error ? e.message : e));
                return false;
            }
        }
        else {
            try {
                // test connection
                await this.client.get('schema_version');
                return true;
            }
            catch (e) {
                logger_1.default.warn('Lost connection to Redis: ' + (e instanceof Error ? e.message : e));
                logger_1.default.warn('Attempting to reconnect in 10 seconds');
                this.connected = false;
                return false;
            }
        }
    }
    async $onConnected() {
        await this.$flushTransactions();
        await this.$removeTransactions([]);
        await this.$flushRbfQueues();
    }
    /** @asyncSafe */
    async $updateBlocks(blocks) {
        if (!config_1.default.REDIS.ENABLED) {
            return;
        }
        if (!this.connected) {
            logger_1.default.warn(`Failed to update blocks in Redis cache: Redis is not connected`);
            return;
        }
        try {
            await this.client.set('blocks', JSON.stringify(blocks));
            logger_1.default.debug(`Saved latest blocks to Redis cache`);
        }
        catch (e) {
            logger_1.default.warn(`Failed to update blocks in Redis cache: ${e instanceof Error ? e.message : e}`);
        }
    }
    async $updateBlockSummaries(summaries) {
        if (!config_1.default.REDIS.ENABLED) {
            return;
        }
        if (!this.connected) {
            logger_1.default.warn(`Failed to update block summaries in Redis cache: Redis is not connected`);
            return;
        }
        try {
            await this.client.set('block-summaries', JSON.stringify(summaries));
            logger_1.default.debug(`Saved latest block summaries to Redis cache`);
        }
        catch (e) {
            logger_1.default.warn(`Failed to update block summaries in Redis cache: ${e instanceof Error ? e.message : e}`);
        }
    }
    /** @asyncSafe */
    async $addTransaction(tx) {
        if (!config_1.default.REDIS.ENABLED) {
            return;
        }
        this.cacheQueue.push(tx);
        if (this.cacheQueue.length >= this.txFlushLimit) {
            if (!this.pauseFlush) {
                await this.$flushTransactions();
            }
        }
    }
    /** @asyncSafe */
    async $flushTransactions() {
        if (!config_1.default.REDIS.ENABLED) {
            return;
        }
        if (!this.cacheQueue.length) {
            return;
        }
        if (!this.connected) {
            logger_1.default.warn(`Failed to add ${this.cacheQueue.length} transactions to Redis cache: Redis not connected`);
            return;
        }
        this.pauseFlush = false;
        const toAdd = this.cacheQueue.slice(0, this.txFlushLimit);
        try {
            const msetData = toAdd.map(tx => {
                const minified = structuredClone(tx);
                delete minified.hex;
                for (const vin of minified.vin) {
                    delete vin.inner_redeemscript_asm;
                    delete vin.inner_witnessscript_asm;
                    delete vin.scriptsig_asm;
                }
                for (const vout of minified.vout) {
                    delete vout.scriptpubkey_asm;
                }
                return [`mempool:tx:${tx.txid}`, JSON.stringify(minified)];
            });
            await this.client.MSET(msetData);
            // successful, remove transactions from cache queue
            this.cacheQueue = this.cacheQueue.slice(toAdd.length);
            logger_1.default.debug(`Saved ${toAdd.length} transactions to Redis cache, ${this.cacheQueue.length} left in queue`);
        }
        catch (e) {
            logger_1.default.warn(`Failed to add ${toAdd.length} transactions to Redis cache: ${e instanceof Error ? e.message : e}`);
            this.pauseFlush = true;
        }
    }
    /** @asyncSafe */
    async $removeTransactions(transactions) {
        if (!config_1.default.REDIS.ENABLED) {
            return;
        }
        const toRemove = this.removeQueue.concat(transactions);
        this.removeQueue = [];
        let failed = [];
        let numRemoved = 0;
        if (this.connected) {
            const sliceLength = config_1.default.REDIS.BATCH_QUERY_BASE_SIZE;
            for (let i = 0; i < Math.ceil(toRemove.length / sliceLength); i++) {
                const slice = toRemove.slice(i * sliceLength, (i + 1) * sliceLength);
                try {
                    await this.client.unlink(slice.map(txid => `mempool:tx:${txid}`));
                    numRemoved += sliceLength;
                    logger_1.default.debug(`Deleted ${slice.length} transactions from the Redis cache`);
                }
                catch (e) {
                    logger_1.default.warn(`Failed to remove ${slice.length} transactions from Redis cache: ${e instanceof Error ? e.message : e}`);
                    failed = failed.concat(slice);
                }
            }
            // concat instead of replace, in case more txs have been added in the meantime
            this.removeQueue = this.removeQueue.concat(failed);
        }
        else {
            this.removeQueue = this.removeQueue.concat(toRemove);
        }
    }
    /** @asyncSafe */
    async $setRbfEntry(type, txid, value) {
        if (!config_1.default.REDIS.ENABLED) {
            return;
        }
        if (!this.connected) {
            this.rbfCacheQueue.push({ type, txid, value });
            logger_1.default.warn(`Failed to set RBF ${type} in Redis cache: Redis is not connected`);
            return;
        }
        try {
            await this.client.set(`rbf:${type}:${txid}`, JSON.stringify(value));
        }
        catch (e) {
            logger_1.default.warn(`Failed to set RBF ${type} in Redis cache: ${e instanceof Error ? e.message : e}`);
        }
    }
    /** @asyncSafe */
    async $removeRbfEntry(type, txid) {
        if (!config_1.default.REDIS.ENABLED) {
            return;
        }
        if (!this.connected) {
            this.rbfRemoveQueue.push({ type, txid });
            logger_1.default.warn(`Failed to remove RBF ${type} from Redis cache: Redis is not connected`);
            return;
        }
        try {
            await this.client.unlink(`rbf:${type}:${txid}`);
        }
        catch (e) {
            logger_1.default.warn(`Failed to remove RBF ${type} from Redis cache: ${e instanceof Error ? e.message : e}`);
        }
    }
    /** @asyncSafe */
    async $flushRbfQueues() {
        if (!config_1.default.REDIS.ENABLED) {
            return;
        }
        if (!this.connected) {
            return;
        }
        try {
            const toAdd = this.rbfCacheQueue;
            this.rbfCacheQueue = [];
            for (const { type, txid, value } of toAdd) {
                await this.$setRbfEntry(type, txid, value);
            }
            logger_1.default.debug(`Saved ${toAdd.length} queued RBF entries to the Redis cache`);
            const toRemove = this.rbfRemoveQueue;
            this.rbfRemoveQueue = [];
            for (const { type, txid } of toRemove) {
                await this.$removeRbfEntry(type, txid);
            }
            logger_1.default.debug(`Removed ${toRemove.length} queued RBF entries from the Redis cache`);
        }
        catch (e) {
            logger_1.default.warn(`Failed to flush RBF cache event queues after reconnecting to Redis: ${e instanceof Error ? e.message : e}`);
        }
    }
    /** @asyncSafe */
    async $getBlocks() {
        if (!config_1.default.REDIS.ENABLED) {
            return [];
        }
        if (!this.connected) {
            logger_1.default.warn(`Failed to retrieve blocks from Redis cache: Redis is not connected`);
            return [];
        }
        try {
            const json = await this.client.get('blocks');
            return JSON.parse(json);
        }
        catch (e) {
            logger_1.default.warn(`Failed to retrieve blocks from Redis cache: ${e instanceof Error ? e.message : e}`);
            return [];
        }
    }
    /** @asyncSafe */
    async $getBlockSummaries() {
        if (!config_1.default.REDIS.ENABLED) {
            return [];
        }
        if (!this.connected) {
            logger_1.default.warn(`Failed to retrieve blocks from Redis cache: Redis is not connected`);
            return [];
        }
        try {
            const json = await this.client.get('block-summaries');
            return JSON.parse(json);
        }
        catch (e) {
            logger_1.default.warn(`Failed to retrieve blocks from Redis cache: ${e instanceof Error ? e.message : e}`);
            return [];
        }
    }
    /** @asyncSafe */
    async $getMempool() {
        if (!config_1.default.REDIS.ENABLED) {
            return {};
        }
        if (!this.connected) {
            logger_1.default.warn(`Failed to retrieve mempool from Redis cache: Redis is not connected`);
            return {};
        }
        const start = Date.now();
        const mempool = {};
        try {
            const mempoolList = await this.scanKeys('mempool:tx:*');
            for (const tx of mempoolList) {
                mempool[tx.key] = tx.value;
            }
            logger_1.default.info(`Loaded mempool from Redis cache in ${Date.now() - start} ms`);
            return mempool || {};
        }
        catch (e) {
            logger_1.default.warn(`Failed to retrieve mempool from Redis cache: ${e instanceof Error ? e.message : e}`);
        }
        return {};
    }
    /** @asyncSafe */
    async $getRbfEntries(type) {
        if (!config_1.default.REDIS.ENABLED) {
            return [];
        }
        if (!this.connected) {
            logger_1.default.warn(`Failed to retrieve Rbf ${type}s from Redis cache: Redis is not connected`);
            return [];
        }
        try {
            const rbfEntries = await this.scanKeys(`rbf:${type}:*`);
            return rbfEntries;
        }
        catch (e) {
            logger_1.default.warn(`Failed to retrieve Rbf ${type}s from Redis cache: ${e instanceof Error ? e.message : e}`);
            return [];
        }
    }
    /** @asyncUnsafe */
    async $loadCache() {
        if (!config_1.default.REDIS.ENABLED) {
            return;
        }
        logger_1.default.info('Restoring mempool and blocks data from Redis cache');
        // Load mempool
        const loadedMempool = await this.$getMempool();
        this.inflateLoadedTxs(loadedMempool);
        // Load rbf data
        const rbfTxs = await this.$getRbfEntries('tx');
        const rbfTrees = await this.$getRbfEntries('tree');
        const rbfExpirations = await this.$getRbfEntries('exp');
        // Load & set block data
        if (!this.ignoreBlocksCache) {
            const loadedBlocks = await this.$getBlocks();
            const loadedBlockSummaries = await this.$getBlockSummaries();
            blocks_1.default.setBlocks(loadedBlocks || []);
            blocks_1.default.setBlockSummaries(loadedBlockSummaries || []);
        }
        // Set other data
        await mempool_1.default.$setMempool(loadedMempool);
        await rbf_cache_1.default.load({
            txs: rbfTxs,
            trees: rbfTrees.map(loadedTree => { loadedTree.value.key = loadedTree.key; return loadedTree.value; }),
            expiring: rbfExpirations,
            mempool: mempool_1.default.getMempool(),
            spendMap: mempool_1.default.getSpendMap(),
        });
    }
    inflateLoadedTxs(mempool) {
        for (const tx of Object.values(mempool)) {
            for (const vin of tx.vin) {
                if (vin.scriptsig) {
                    vin.scriptsig_asm = transaction_utils_1.default.convertScriptSigAsm(vin.scriptsig);
                    transaction_utils_1.default.addInnerScriptsToVin(vin);
                }
            }
            for (const vout of tx.vout) {
                if (vout.scriptpubkey) {
                    vout.scriptpubkey_asm = transaction_utils_1.default.convertScriptSigAsm(vout.scriptpubkey);
                }
            }
        }
    }
    /** @asyncUnsafe */
    async scanKeys(pattern) {
        logger_1.default.info(`loading Redis entries for ${pattern}`);
        let keys = [];
        const result = [];
        const patternLength = pattern.length - 1;
        let count = 0;
        /** @asyncUnsafe */
        const processValues = async (keys) => {
            const values = await this.client.MGET(keys);
            for (let i = 0; i < values.length; i++) {
                if (values[i]) {
                    result.push({ key: keys[i].slice(patternLength), value: JSON.parse(values[i]) });
                    count++;
                }
            }
            logger_1.default.info(`loaded ${count} entries from Redis cache`);
        };
        for await (const key of this.client.scanIterator({
            MATCH: pattern,
            COUNT: 100
        })) {
            keys.push(key);
            if (keys.length >= 10000) {
                await processValues(keys);
                keys = [];
            }
        }
        if (keys.length) {
            await processValues(keys);
        }
        return result;
    }
    setIgnoreBlocksCache() {
        this.ignoreBlocksCache = true;
    }
}
exports.default = new RedisCache();
