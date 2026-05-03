"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("./api/common");
const blocks_1 = __importDefault(require("./api/blocks"));
const mempool_1 = __importDefault(require("./api/mempool"));
const mining_1 = __importDefault(require("./api/mining/mining"));
const logger_1 = __importDefault(require("./logger"));
const bitcoin_client_1 = __importDefault(require("./api/bitcoin/bitcoin-client"));
const price_updater_1 = __importDefault(require("./tasks/price-updater"));
const PricesRepository_1 = __importDefault(require("./repositories/PricesRepository"));
const config_1 = __importDefault(require("./config"));
const AuditReplication_1 = __importDefault(require("./replication/AuditReplication"));
const StatisticsReplication_1 = __importDefault(require("./replication/StatisticsReplication"));
const AccelerationRepository_1 = __importDefault(require("./repositories/AccelerationRepository"));
const BlocksAuditsRepository_1 = __importDefault(require("./repositories/BlocksAuditsRepository"));
const BlocksRepository_1 = __importDefault(require("./repositories/BlocksRepository"));
class Indexer {
    runIndexer = true;
    indexerRunning = false;
    tasksRunning = {};
    tasksScheduled = {};
    reindexTimeout;
    coreIndexes = [];
    indexerIsRunning() {
        return this.indexerRunning;
    }
    /**
     * Check which core index is available for indexing
     *
     * @asyncUnsafe
     */
    async checkAvailableCoreIndexes() {
        const updatedCoreIndexes = [];
        const indexes = await bitcoin_client_1.default.getIndexInfo();
        for (const indexName in indexes) {
            const newState = {
                name: indexName,
                synced: indexes[indexName].synced,
                best_block_height: indexes[indexName].best_block_height,
            };
            logger_1.default.info(`Core index '${indexName}' is ${indexes[indexName].synced ? 'synced' : 'not synced'}. Best block height is ${indexes[indexName].best_block_height}`);
            updatedCoreIndexes.push(newState);
            if (indexName === 'coinstatsindex' && newState.synced === true) {
                const previousState = this.isCoreIndexReady('coinstatsindex');
                // if (!previousState || previousState.synced === false) {
                void this.runSingleTask('coinStatsIndex');
                // }
            }
        }
        this.coreIndexes = updatedCoreIndexes;
    }
    /**
     * Return the best block height if a core index is available, or 0 if not
     *
     * @param name
     * @returns
     */
    isCoreIndexReady(name) {
        for (const index of this.coreIndexes) {
            if (index.name === name && index.synced === true) {
                return index;
            }
        }
        return null;
    }
    reindex() {
        if (common_1.Common.indexingEnabled()) {
            if (this.reindexTimeout) {
                clearTimeout(this.reindexTimeout);
                this.reindexTimeout = undefined;
            }
            this.runIndexer = true;
        }
    }
    scheduleNextRun(timeout) {
        if (!this.reindexTimeout) { // Only one future run should be planned, ignore if already scheduled
            this.reindexTimeout = setTimeout(() => {
                this.reindexTimeout = undefined;
                this.reindex();
            }, timeout);
        }
    }
    /**
     * schedules a single task to run in `timeout` ms
     * only one task of each type may be scheduled
     *
     * @param {TaskName} task - the type of task
     * @param {number} timeout - delay in ms
     * @param {boolean} replace - `true` replaces any already scheduled task (works like a debounce), `false` ignores subsequent requests (works like a throttle)
     */
    scheduleSingleTask(task, timeout = 10000, replace = false) {
        if (this.tasksScheduled[task]) {
            if (!replace) { //throttle
                return;
            }
            else { // debounce
                clearTimeout(this.tasksScheduled[task]);
            }
        }
        this.tasksScheduled[task] = setTimeout(async () => {
            try {
                await this.runSingleTask(task);
            }
            catch (e) {
                logger_1.default.err(`Unexpected error in scheduled task ${task}: ` + (e instanceof Error ? e.message : e));
            }
            finally {
                clearTimeout(this.tasksScheduled[task]);
            }
        }, timeout);
    }
    /**
     * Runs a single task immediately
     *
     * (use `scheduleSingleTask` instead to queue a task to run after some timeout)
     *
     * @asyncSafe
     */
    async runSingleTask(task) {
        if (!common_1.Common.indexingEnabled() || this.tasksRunning[task]) {
            return;
        }
        this.tasksRunning[task] = true;
        switch (task) {
            case 'blocksPrices':
                {
                    if (!['testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK) && config_1.default.FIAT_PRICE.ENABLED) {
                        let latestPriceId;
                        try {
                            latestPriceId = await PricesRepository_1.default.$getLatestPriceId();
                        }
                        catch (e) {
                            logger_1.default.debug('failed to fetch latest price id from db: ' + (e instanceof Error ? e.message : e));
                        }
                        if (price_updater_1.default.historyInserted === false || latestPriceId === null) {
                            logger_1.default.debug(`Blocks prices indexer is waiting for the price updater to complete`, logger_1.default.tags.mining);
                            this.scheduleSingleTask(task, 10000);
                        }
                        else {
                            logger_1.default.debug(`Blocks prices indexer will run now`, logger_1.default.tags.mining);
                            await mining_1.default.$indexBlockPrices();
                        }
                    }
                }
                break;
            case 'coinStatsIndex':
                {
                    logger_1.default.debug(`Indexing coinStatsIndex now`);
                    try {
                        await mining_1.default.$indexCoinStatsIndex();
                    }
                    catch (e) {
                        logger_1.default.debug(`failed to index coinstatsindex: ` + (e instanceof Error ? e.message : e));
                    }
                }
                break;
        }
        this.tasksRunning[task] = false;
    }
    /** @asyncSafe */
    async $run() {
        if (!common_1.Common.indexingEnabled() || this.runIndexer === false ||
            this.indexerRunning === true || mempool_1.default.hasPriority()) {
            return;
        }
        this.runIndexer = false;
        this.indexerRunning = true;
        const retryDelay = 10000;
        const runEvery = 1000 * 3600; // 1 hour
        let nextRunDelay = runEvery;
        let runSuccessful = false;
        try {
            if (config_1.default.FIAT_PRICE.ENABLED) {
                try {
                    await price_updater_1.default.$run();
                }
                catch (e) {
                    logger_1.default.err(`Running priceUpdater failed. Reason: ` + (e instanceof Error ? e.message : e));
                }
            }
            // Do not attempt to index anything unless Bitcoin Core is fully synced
            const blockchainInfo = await bitcoin_client_1.default.getBlockchainInfo();
            if (blockchainInfo.blocks !== blockchainInfo.headers) {
                logger_1.default.debug(`Bitcoin Core not fully synced, retrying index run in 10 seconds.`);
                nextRunDelay = retryDelay;
                return;
            }
            logger_1.default.debug(`Running mining indexer`);
            await this.checkAvailableCoreIndexes();
            const chainValid = await blocks_1.default.$generateBlockDatabase();
            if (chainValid === false) {
                // Chain of block hash was invalid, so we need to reindex. Stop here and continue at the next iteration
                logger_1.default.warn(`The chain of block hash is invalid, re-indexing invalid data in 10 seconds.`, logger_1.default.tags.mining);
                nextRunDelay = retryDelay;
                return;
            }
            void this.runSingleTask('blocksPrices');
            await blocks_1.default.$indexCoinbaseAddresses();
            await mining_1.default.$indexDifficultyAdjustments();
            await mining_1.default.$generateNetworkHashrateHistory();
            await mining_1.default.$generatePoolHashrateHistory();
            await blocks_1.default.$generateBlocksSummariesDatabase();
            await blocks_1.default.$generateCPFPDatabase();
            await blocks_1.default.$generateAuditStats();
            await blocks_1.default.$indexBlocksFirstSeen();
            await AuditReplication_1.default.$sync();
            await StatisticsReplication_1.default.$sync();
            await AccelerationRepository_1.default.$indexPastAccelerations();
            await BlocksAuditsRepository_1.default.$migrateAuditsV0toV1();
            await BlocksRepository_1.default.$migrateBlocks();
            // do not wait for classify blocks to finish
            void blocks_1.default.$classifyBlocks();
            runSuccessful = true;
        }
        catch (e) {
            nextRunDelay = retryDelay;
            logger_1.default.err(`Indexer failed, trying again in 10 seconds. Reason: ` + (e instanceof Error ? e.message : e));
        }
        finally {
            this.indexerRunning = false;
            const nextRunAt = new Date(Date.now() + nextRunDelay).toUTCString();
            if (runSuccessful) {
                logger_1.default.debug(`Indexing completed. Next run planned at ${nextRunAt}`);
            }
            else {
                logger_1.default.debug(`Indexing did not complete, next run planned at ${nextRunAt}`);
            }
            this.scheduleNextRun(nextRunDelay);
        }
    }
}
exports.default = new Indexer();
