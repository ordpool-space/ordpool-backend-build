"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
const bitcoin_api_factory_1 = __importDefault(require("./bitcoin/bitcoin-api-factory"));
const logger_1 = __importDefault(require("../logger"));
const common_1 = require("./common");
const transaction_utils_1 = __importDefault(require("./transaction-utils"));
const loading_indicators_1 = __importDefault(require("./loading-indicators"));
const bitcoin_client_1 = __importDefault(require("./bitcoin/bitcoin-client"));
const bitcoin_second_client_1 = __importDefault(require("./bitcoin/bitcoin-second-client"));
const rbf_cache_1 = __importDefault(require("./rbf-cache"));
const acceleration_1 = __importDefault(require("./services/acceleration"));
const redis_cache_1 = __importDefault(require("./redis-cache"));
const blocks_1 = __importDefault(require("./blocks"));
const cluster_mempool_1 = require("../cluster-mempool/cluster-mempool");
class Mempool {
    inSync = false;
    mempoolCacheDelta = -1;
    mempoolCache = {};
    mempoolCandidates = {};
    spendMap = new Map();
    recentlyDeleted = []; // buffer of transactions deleted in recent mempool updates
    mempoolInfo;
    clusterMempool = null;
    mempoolChangedCallback;
    $asyncMempoolChangedCallback;
    accelerations = {};
    accelerationPositions = {};
    txPerSecondArray = [];
    txPerSecond = 0;
    vBytesPerSecondArray = [];
    vBytesPerSecond = 0;
    mempoolProtection = 0;
    latestTransactions = [];
    ESPLORA_MISSING_TX_WARNING_THRESHOLD = 100;
    SAMPLE_TIME = 10000; // In ms
    timer = new Date().getTime();
    missingTxCount = 0;
    mainLoopTimeout = 120000;
    txPerSecondInterval = null;
    limitGBT = config_1.default.MEMPOOL.USE_SECOND_NODE_FOR_MINFEE && config_1.default.MEMPOOL.LIMIT_GBT;
    constructor() {
        // Initialize mempoolInfo here to avoid circular dependency issues
        // Use config directly instead of Common.isLiquid() to break circular dependency
        const isLiquid = config_1.default.MEMPOOL.NETWORK === 'liquid' || config_1.default.MEMPOOL.NETWORK === 'liquidtestnet';
        this.mempoolInfo = {
            loaded: false,
            size: 0,
            bytes: 0,
            usage: 0,
            total_fee: 0,
            maxmempool: 300000000,
            mempoolminfee: isLiquid ? 0.00000100 : 0.00001000,
            minrelaytxfee: isLiquid ? 0.00000100 : 0.00001000
        };
        this.txPerSecondInterval = setInterval(this.updateTxPerSecond.bind(this), 1000);
        if (config_1.default.MEMPOOL.CLUSTER_MEMPOOL) {
            this.clusterMempool = new cluster_mempool_1.ClusterMempool(this.mempoolCache, this.accelerations);
        }
    }
    /**
     * Cleanup resources (timers, etc.)
     * This should only be called when shutting down or in test teardown
     */
    destroy() {
        if (this.txPerSecondInterval) {
            clearInterval(this.txPerSecondInterval);
            this.txPerSecondInterval = null;
        }
    }
    /**
     * Return true if we should leave resources available for mempool tx caching
     */
    hasPriority() {
        if (this.inSync) {
            return false;
        }
        else {
            return this.mempoolCacheDelta == -1 || this.mempoolCacheDelta > 25;
        }
    }
    isInSync() {
        return this.inSync;
    }
    setOutOfSync() {
        this.inSync = false;
        loading_indicators_1.default.setProgress('mempool', 99);
    }
    getLatestTransactions() {
        return this.latestTransactions;
    }
    setMempoolChangedCallback(fn) {
        this.mempoolChangedCallback = fn;
    }
    setAsyncMempoolChangedCallback(fn) {
        this.$asyncMempoolChangedCallback = fn;
    }
    getMempool() {
        return this.mempoolCache;
    }
    getSpendMap() {
        return this.spendMap;
    }
    getFromSpendMap(txid, index) {
        return this.spendMap.get(`${txid}:${index}`);
    }
    /** @asyncUnsafe */
    async $setMempool(mempoolData) {
        this.mempoolCache = mempoolData;
        let count = 0;
        const redisTimer = Date.now();
        if (config_1.default.MEMPOOL.CACHE_ENABLED && config_1.default.REDIS.ENABLED) {
            logger_1.default.debug(`Migrating ${Object.keys(this.mempoolCache).length} transactions from disk cache to Redis cache`);
        }
        for (const txid of Object.keys(this.mempoolCache)) {
            if (!this.mempoolCache[txid].adjustedVsize || this.mempoolCache[txid].sigops == null || this.mempoolCache[txid].effectiveFeePerVsize == null) {
                this.mempoolCache[txid] = transaction_utils_1.default.extendMempoolTransaction(this.mempoolCache[txid]);
            }
            if (this.mempoolCache[txid].order == null) {
                this.mempoolCache[txid].order = transaction_utils_1.default.txidToOrdering(txid);
            }
            for (const vin of this.mempoolCache[txid].vin) {
                transaction_utils_1.default.addInnerScriptsToVin(vin);
            }
            count++;
            if (config_1.default.MEMPOOL.CACHE_ENABLED && config_1.default.REDIS.ENABLED) {
                await redis_cache_1.default.$addTransaction(this.mempoolCache[txid]);
            }
            // HACK -- Ordpool: async getTransactionFlags awaits parser inline +
            // OR's in OTS flag from the indexer-side set.
            this.mempoolCache[txid].flags = await common_1.Common.getTransactionFlags(this.mempoolCache[txid]);
            this.mempoolCache[txid].cpfpChecked = false;
            this.mempoolCache[txid].cpfpDirty = true;
            this.mempoolCache[txid].cpfpUpdated = undefined;
        }
        if (config_1.default.MEMPOOL.CACHE_ENABLED && config_1.default.REDIS.ENABLED) {
            await redis_cache_1.default.$flushTransactions();
            logger_1.default.debug(`Finished migrating cache transactions in ${((Date.now() - redisTimer) / 1000).toFixed(2)} seconds`);
        }
        if (config_1.default.MEMPOOL.CLUSTER_MEMPOOL) {
            this.clusterMempool = new cluster_mempool_1.ClusterMempool(this.mempoolCache, this.accelerations);
        }
        if (this.mempoolChangedCallback) {
            this.mempoolChangedCallback(this.mempoolCache, [], [], []);
        }
        if (this.$asyncMempoolChangedCallback) {
            await this.$asyncMempoolChangedCallback(this.mempoolCache, count, [], [], [], this.limitGBT ? { txs: {}, added: [], removed: [] } : undefined);
        }
        this.addToSpendMap(Object.values(this.mempoolCache));
    }
    async $reloadMempool(expectedCount) {
        let count = 0;
        let done = false;
        let last_txid;
        const newTransactions = [];
        loading_indicators_1.default.setProgress('mempool', count / expectedCount * 100);
        while (!done) {
            try {
                const result = await bitcoin_api_factory_1.default.$getAllMempoolTransactions(last_txid, config_1.default.ESPLORA.BATCH_QUERY_BASE_SIZE);
                if (result) {
                    for (const tx of result) {
                        const extendedTransaction = transaction_utils_1.default.extendMempoolTransaction(tx);
                        if (!this.mempoolCache[extendedTransaction.txid]) {
                            // HACK -- Ordpool: async getTransactionFlags awaits parser
                            // inline + OR's in OTS flag from the indexer-side set.
                            extendedTransaction.flags = await common_1.Common.getTransactionFlags(extendedTransaction);
                            newTransactions.push(extendedTransaction);
                            this.mempoolCache[extendedTransaction.txid] = extendedTransaction;
                        }
                        count++;
                    }
                    // HACK: improved logging
                    const percentage = ((count / expectedCount) * 100).toFixed(2);
                    logger_1.default.info(`Fetched ${count} of ${expectedCount} mempool transactions from esplora (${percentage}% done)`);
                    if (result.length > 0) {
                        last_txid = result[result.length - 1].txid;
                    }
                    else {
                        done = true;
                    }
                    if (Math.floor((count / expectedCount) * 100) < 100) {
                        loading_indicators_1.default.setProgress('mempool', count / expectedCount * 100);
                    }
                }
                else {
                    done = true;
                }
            }
            catch (err) {
                logger_1.default.err('failed to fetch bulk mempool transactions from esplora');
            }
        }
        logger_1.default.info(`Done inserting loaded mempool transactions into local cache`);
        return newTransactions;
    }
    getMempoolCandidates() {
        return this.mempoolCandidates;
    }
    /** @asyncUnsafe */
    async $updateMemPoolInfo() {
        this.mempoolInfo = await this.$getMempoolInfo();
    }
    getMempoolInfo() {
        return this.mempoolInfo;
    }
    getTxPerSecond() {
        return this.txPerSecond;
    }
    getVBytesPerSecond() {
        return this.vBytesPerSecond;
    }
    getFirstSeenForTransactions(txIds) {
        const txTimes = [];
        txIds.forEach((txId) => {
            const tx = this.mempoolCache[txId];
            if (tx && tx.firstSeen) {
                txTimes.push(tx.firstSeen);
            }
            else {
                txTimes.push(0);
            }
        });
        return txTimes;
    }
    /** @asyncUnsafe */
    async $updateMempool(transactions, accelerations, minFeeMempool, minFeeTip, pollRate) {
        logger_1.default.debug(`Updating mempool...`);
        // warn if this run stalls the main loop for more than 2 minutes
        const timer = this.startTimer();
        const start = new Date().getTime();
        let hasChange = false;
        const currentMempoolSize = Object.keys(this.mempoolCache).length;
        this.updateTimerProgress(timer, 'got raw mempool');
        const diff = transactions.length - currentMempoolSize;
        let newTransactions = [];
        this.mempoolCacheDelta = Math.abs(diff);
        if (!this.inSync) {
            loading_indicators_1.default.setProgress('mempool', currentMempoolSize / transactions.length * 100);
        }
        // https://github.com/mempool/mempool/issues/3283
        const logEsplora404 = (missingTxCount, threshold, time) => {
            const log = `In the past ${time / 1000} seconds, esplora tx API replied ${missingTxCount} times with a 404 error code while updating nodejs backend mempool`;
            if (missingTxCount >= threshold) {
                logger_1.default.warn(log);
            }
            else if (missingTxCount > 0) {
                logger_1.default.debug(log);
            }
        };
        let intervalTimer = Date.now();
        let loaded = false;
        if (config_1.default.MEMPOOL.BACKEND === 'esplora' && currentMempoolSize < transactions.length * 0.5 && transactions.length > 20_000) {
            this.inSync = false;
            logger_1.default.info(`Missing ${transactions.length - currentMempoolSize} mempool transactions, attempting to reload in bulk from esplora`);
            try {
                newTransactions = await this.$reloadMempool(transactions.length);
                if (config_1.default.REDIS.ENABLED) {
                    for (const tx of newTransactions) {
                        await redis_cache_1.default.$addTransaction(tx);
                    }
                }
                loaded = true;
            }
            catch (e) {
                logger_1.default.err('failed to load mempool in bulk from esplora, falling back to fetching individual transactions');
            }
        }
        if (!loaded) {
            const remainingTxids = transactions.filter(txid => !this.mempoolCache[txid]);
            const sliceLength = config_1.default.ESPLORA.BATCH_QUERY_BASE_SIZE;
            for (let i = 0; i < Math.ceil(remainingTxids.length / sliceLength); i++) {
                const slice = remainingTxids.slice(i * sliceLength, (i + 1) * sliceLength);
                const txs = await transaction_utils_1.default.$getMempoolTransactionsExtended(slice, false, false, false);
                logger_1.default.debug(`fetched ${txs.length} transactions`);
                this.updateTimerProgress(timer, 'fetched new transactions');
                for (const transaction of txs) {
                    this.mempoolCache[transaction.txid] = transaction;
                    if (this.inSync) {
                        this.txPerSecondArray.push(new Date().getTime());
                        this.vBytesPerSecondArray.push({
                            unixTime: new Date().getTime(),
                            vSize: transaction.vsize,
                        });
                    }
                    hasChange = true;
                    newTransactions.push(transaction);
                    // HACK -- Ordpool: async getTransactionFlags awaits parser inline
                    // + OR's in OTS flag from the indexer-side set.
                    transaction.flags = await common_1.Common.getTransactionFlags(transaction);
                    if (config_1.default.REDIS.ENABLED) {
                        await redis_cache_1.default.$addTransaction(transaction);
                    }
                }
                if (txs.length < slice.length) {
                    const missing = slice.length - txs.length;
                    if (config_1.default.MEMPOOL.BACKEND === 'esplora') {
                        this.missingTxCount += missing;
                    }
                    logger_1.default.debug(`Error finding ${missing} transactions in the mempool: `);
                }
                if (Date.now() - intervalTimer > Math.max(pollRate * 2, 5_000)) {
                    if (this.inSync) {
                        // Break and restart mempool loop if we spend too much time processing
                        // new transactions that may lead to falling behind on block height
                        logger_1.default.debug('Breaking mempool loop because the 5s time limit exceeded.');
                        break;
                    }
                    else {
                        const progress = (currentMempoolSize + newTransactions.length) / transactions.length * 100;
                        logger_1.default.debug(`Mempool is synchronizing. Processed ${newTransactions.length}/${diff} txs (${Math.round(progress)}%)`);
                        if (Math.floor(progress) < 100) {
                            loading_indicators_1.default.setProgress('mempool', progress);
                        }
                        intervalTimer = Date.now();
                    }
                }
            }
        }
        // Reset esplora 404 counter and log a warning if needed
        const elapsedTime = new Date().getTime() - this.timer;
        if (elapsedTime > this.SAMPLE_TIME) {
            logEsplora404(this.missingTxCount, this.ESPLORA_MISSING_TX_WARNING_THRESHOLD, elapsedTime);
            this.timer = new Date().getTime();
            this.missingTxCount = 0;
        }
        // Prevent mempool from clear on bitcoind restart by delaying the deletion
        if (this.mempoolProtection === 0
            && currentMempoolSize > 20000
            && transactions.length / currentMempoolSize <= 0.80) {
            this.mempoolProtection = 1;
            this.inSync = false;
            logger_1.default.warn(`Mempool clear protection triggered because transactions.length: ${transactions.length} and currentMempoolSize: ${currentMempoolSize}.`);
            setTimeout(() => {
                this.mempoolProtection = 2;
                logger_1.default.warn('Mempool clear protection ended, normal operation resumed.');
            }, 1000 * 60 * config_1.default.MEMPOOL.CLEAR_PROTECTION_MINUTES);
        }
        const deletedTransactions = [];
        if (this.mempoolProtection !== 1) {
            this.mempoolProtection = 0;
            // Index object for faster search
            const transactionsObject = {};
            transactions.forEach((txId) => transactionsObject[txId] = true);
            // Delete evicted transactions from mempool
            for (const tx in this.mempoolCache) {
                if (!transactionsObject[tx]) {
                    deletedTransactions.push(this.mempoolCache[tx]);
                }
            }
            for (const tx of deletedTransactions) {
                delete this.mempoolCache[tx.txid];
            }
        }
        const candidates = await this.getNextCandidates(minFeeMempool, minFeeTip, deletedTransactions);
        const newMempoolSize = currentMempoolSize + newTransactions.length - deletedTransactions.length;
        const newTransactionsStripped = newTransactions.map((tx) => common_1.Common.stripTransaction(tx));
        this.latestTransactions = newTransactionsStripped.concat(this.latestTransactions).slice(0, 6);
        const accelerationDelta = accelerations != null ? await this.updateAccelerations(accelerations) : [];
        if (accelerationDelta.length) {
            hasChange = true;
        }
        if (config_1.default.MEMPOOL.CLUSTER_MEMPOOL && (newTransactions.length || deletedTransactions.length || accelerationDelta.length)) {
            this.clusterMempool?.applyMempoolChange({
                added: newTransactions,
                removed: deletedTransactions.map(tx => tx.txid),
                accelerations: this.getAccelerations(),
            });
        }
        this.mempoolCacheDelta = Math.abs(transactions.length - newMempoolSize);
        const candidatesChanged = candidates?.added?.length || candidates?.removed?.length;
        this.recentlyDeleted.unshift(deletedTransactions);
        this.recentlyDeleted.length = Math.min(this.recentlyDeleted.length, 10); // truncate to the last 10 mempool updates
        if (this.mempoolChangedCallback && (hasChange || newTransactions.length || deletedTransactions.length)) {
            this.mempoolChangedCallback(this.mempoolCache, newTransactions, this.recentlyDeleted, accelerationDelta);
        }
        if (this.$asyncMempoolChangedCallback && (hasChange || newTransactions.length || deletedTransactions.length || candidatesChanged)) {
            this.updateTimerProgress(timer, 'running async mempool callback');
            await this.$asyncMempoolChangedCallback(this.mempoolCache, newMempoolSize, newTransactions, this.recentlyDeleted, accelerationDelta, candidates);
            this.updateTimerProgress(timer, 'completed async mempool callback');
        }
        if (!this.inSync && transactions.length === newMempoolSize) {
            this.inSync = true;
            logger_1.default.notice('The mempool is now in sync!');
            loading_indicators_1.default.setProgress('mempool', 100);
        }
        // Update Redis cache
        if (config_1.default.REDIS.ENABLED) {
            await redis_cache_1.default.$flushTransactions();
            await redis_cache_1.default.$removeTransactions(deletedTransactions.map(tx => tx.txid));
            await rbf_cache_1.default.updateCache();
        }
        const end = new Date().getTime();
        const time = end - start;
        logger_1.default.debug(`Mempool updated in ${time / 1000} seconds. New size: ${Object.keys(this.mempoolCache).length} (${diff > 0 ? '+' + diff : diff})`);
        this.clearTimer(timer);
    }
    getAccelerations() {
        return this.accelerations;
    }
    updateAccelerations(newAccelerationMap) {
        try {
            const accelerationDelta = acceleration_1.default.getAccelerationDelta(this.accelerations, newAccelerationMap);
            this.accelerations = newAccelerationMap;
            return accelerationDelta;
        }
        catch (e) {
            logger_1.default.debug(`Failed to update accelerations: ` + (e instanceof Error ? e.message : e));
            return [];
        }
    }
    getNextCandidates(minFeeTransactions, blockHeight, deletedTransactions) {
        if (this.limitGBT) {
            const deletedTxsMap = {};
            for (const tx of deletedTransactions) {
                deletedTxsMap[tx.txid] = tx;
            }
            const newCandidateTxMap = {};
            for (const txid of minFeeTransactions) {
                if (this.mempoolCache[txid]) {
                    newCandidateTxMap[txid] = true;
                }
            }
            const accelerations = this.getAccelerations();
            for (const txid of Object.keys(accelerations)) {
                if (this.mempoolCache[txid]) {
                    newCandidateTxMap[txid] = true;
                }
            }
            const removed = [];
            const added = [];
            // don't prematurely remove txs included in a new block
            if (blockHeight > blocks_1.default.getCurrentBlockHeight()) {
                for (const txid of Object.keys(this.mempoolCandidates)) {
                    newCandidateTxMap[txid] = true;
                }
            }
            else {
                for (const txid of Object.keys(this.mempoolCandidates)) {
                    if (!newCandidateTxMap[txid]) {
                        if (this.mempoolCache[txid]) {
                            removed.push(this.mempoolCache[txid]);
                            this.mempoolCache[txid].effectiveFeePerVsize = this.mempoolCache[txid].adjustedFeePerVsize;
                            this.mempoolCache[txid].ancestors = [];
                            this.mempoolCache[txid].descendants = [];
                            this.mempoolCache[txid].bestDescendant = null;
                            this.mempoolCache[txid].cpfpChecked = false;
                            this.mempoolCache[txid].cpfpUpdated = undefined;
                        }
                        else if (deletedTxsMap[txid]) {
                            removed.push(deletedTxsMap[txid]);
                        }
                    }
                }
            }
            for (const txid of Object.keys(newCandidateTxMap)) {
                if (!this.mempoolCandidates[txid]) {
                    added.push(this.mempoolCache[txid]);
                }
            }
            this.mempoolCandidates = newCandidateTxMap;
            return {
                txs: this.mempoolCandidates,
                added,
                removed
            };
        }
    }
    setAccelerationPositions(positions) {
        this.accelerationPositions = positions;
    }
    getAccelerationPositions(txid) {
        return this.accelerationPositions[txid];
    }
    startTimer() {
        const state = {
            start: Date.now(),
            progress: 'begin $updateMempool',
            timer: null,
        };
        state.timer = setTimeout(() => {
            logger_1.default.err(`$updateMempool stalled at "${state.progress}"`);
        }, this.mainLoopTimeout);
        return state;
    }
    updateTimerProgress(state, msg) {
        state.progress = msg;
    }
    clearTimer(state) {
        if (state.timer) {
            clearTimeout(state.timer);
        }
    }
    handleRbfTransactions(rbfTransactions) {
        for (const rbfTransaction in rbfTransactions) {
            if (rbfTransactions[rbfTransaction].replacedBy && rbfTransactions[rbfTransaction]?.replaced?.length) {
                // Store replaced transactions
                rbf_cache_1.default.add(rbfTransactions[rbfTransaction].replaced, transaction_utils_1.default.extendMempoolTransaction(rbfTransactions[rbfTransaction].replacedBy));
            }
        }
    }
    addToSpendMap(transactions) {
        for (const tx of transactions) {
            for (const vin of tx.vin) {
                this.spendMap.set(`${vin.txid}:${vin.vout}`, tx);
            }
        }
    }
    removeFromSpendMap(transactions) {
        for (const tx of transactions) {
            for (const vin of tx.vin) {
                const key = `${vin.txid}:${vin.vout}`;
                if (this.spendMap.get(key)?.txid === tx.txid) {
                    this.spendMap.delete(key);
                }
            }
        }
    }
    updateTxPerSecond() {
        const nowMinusTimeSpan = new Date().getTime() - (1000 * config_1.default.STATISTICS.TX_PER_SECOND_SAMPLE_PERIOD);
        this.txPerSecondArray = this.txPerSecondArray.filter((unixTime) => unixTime > nowMinusTimeSpan);
        this.txPerSecond = this.txPerSecondArray.length / config_1.default.STATISTICS.TX_PER_SECOND_SAMPLE_PERIOD || 0;
        this.vBytesPerSecondArray = this.vBytesPerSecondArray.filter((data) => data.unixTime > nowMinusTimeSpan);
        if (this.vBytesPerSecondArray.length) {
            this.vBytesPerSecond = Math.round(this.vBytesPerSecondArray.map((data) => data.vSize).reduce((a, b) => a + b) / config_1.default.STATISTICS.TX_PER_SECOND_SAMPLE_PERIOD);
        }
    }
    $getMempoolInfo() {
        if (config_1.default.MEMPOOL.USE_SECOND_NODE_FOR_MINFEE) {
            return Promise.all([
                bitcoin_client_1.default.getMempoolInfo(),
                bitcoin_second_client_1.default.getMempoolInfo()
            ]).then(([mempoolInfo, secondMempoolInfo]) => {
                mempoolInfo.maxmempool = secondMempoolInfo.maxmempool;
                mempoolInfo.mempoolminfee = secondMempoolInfo.mempoolminfee;
                mempoolInfo.minrelaytxfee = secondMempoolInfo.minrelaytxfee;
                return mempoolInfo;
            });
        }
        return bitcoin_client_1.default.getMempoolInfo();
    }
}
exports.default = new Mempool();
