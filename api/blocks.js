"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
const bitcoin_api_factory_1 = __importStar(require("./bitcoin/bitcoin-api-factory"));
const logger_1 = __importDefault(require("../logger"));
const mempool_1 = __importDefault(require("./mempool"));
const common_1 = require("./common");
const disk_cache_1 = __importDefault(require("./disk-cache"));
const transaction_utils_1 = __importDefault(require("./transaction-utils"));
const bitcoin_client_1 = __importDefault(require("./bitcoin/bitcoin-client"));
const PoolsRepository_1 = __importDefault(require("../repositories/PoolsRepository"));
const BlocksRepository_1 = __importDefault(require("../repositories/BlocksRepository"));
const loading_indicators_1 = __importDefault(require("./loading-indicators"));
const bitcoin_api_1 = __importDefault(require("./bitcoin/bitcoin-api"));
const BlocksRepository_2 = __importDefault(require("../repositories/BlocksRepository"));
const HashratesRepository_1 = __importDefault(require("../repositories/HashratesRepository"));
const indexer_1 = __importDefault(require("../indexer"));
const pools_parser_1 = __importDefault(require("./pools-parser"));
const ordpool_parser_1 = require("ordpool-parser");
// HACK: force a given block for debugging reasons
// const debugBlock = 839999;
const debugBlock = null;
// HACK -- Ordpool: genesis hashes for the supported Bitcoin networks. Used
// to short-circuit $getBlock for genesis (Core can't getrawtransaction the
// genesis coinbase, so the standard index path 404s).
const BLOCK_GENESIS_HASHES = [
    '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
    '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
    '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
    '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
    '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206', // regtest
];
const BlocksSummariesRepository_1 = __importDefault(require("../repositories/BlocksSummariesRepository"));
const BlocksAuditsRepository_1 = __importDefault(require("../repositories/BlocksAuditsRepository"));
const CpfpRepository_1 = __importDefault(require("../repositories/CpfpRepository"));
const mining_1 = __importDefault(require("./mining/mining"));
const DifficultyAdjustmentsRepository_1 = __importDefault(require("../repositories/DifficultyAdjustmentsRepository"));
const PricesRepository_1 = __importDefault(require("../repositories/PricesRepository"));
const price_updater_1 = __importDefault(require("../tasks/price-updater"));
const chain_tips_1 = __importDefault(require("./chain-tips"));
const websocket_handler_1 = __importDefault(require("./websocket-handler"));
const redis_cache_1 = __importDefault(require("./redis-cache"));
const rbf_cache_1 = __importDefault(require("./rbf-cache"));
const bitcoin_second_client_1 = __importDefault(require("./bitcoin/bitcoin-second-client"));
const mempool_blocks_1 = __importDefault(require("./mempool-blocks"));
const statistics_1 = __importDefault(require("./statistics/statistics"));
const difficulty_adjustment_1 = require("./difficulty-adjustment");
const AccelerationRepository_1 = __importDefault(require("../repositories/AccelerationRepository"));
const cpfp_1 = require("./cpfp");
const block_processor_1 = __importStar(require("./block-processor"));
const mempool_2 = __importDefault(require("./mempool"));
const CpfpRepository_2 = __importDefault(require("../repositories/CpfpRepository"));
const bitcoin_script_1 = require("../utils/bitcoin-script");
const database_1 = __importDefault(require("../database"));
const file_read_1 = require("../utils/file-read");
// HACK -- Ordpool: min summary version that carries ordpool flags. Older rows fall through to a fresh classify.
const ORDPOOL_BLOCK_SUMMARY_VERSION = 3;
class Blocks {
    blocks = [];
    blockSummaries = [];
    currentBlockHeight = 0;
    currentBits = 0;
    lastDifficultyAdjustmentTime = 0;
    previousDifficultyRetarget = 0;
    quarterEpochBlockTime = null;
    newBlockCallbacks = [];
    classifyingBlocks = false;
    oldestCoreLogTimestamp = undefined;
    mainLoopTimeout = 120000;
    constructor() { }
    getBlocks() {
        return this.blocks;
    }
    setBlocks(blocks) {
        this.blocks = blocks;
    }
    getBlockSummaries() {
        return this.blockSummaries;
    }
    setBlockSummaries(blockSummaries) {
        this.blockSummaries = blockSummaries;
    }
    setNewBlockCallback(fn) {
        this.newBlockCallbacks.push(fn);
    }
    /**
     * Return the list of transaction for a block
     * @param blockHash
     * @param blockHeight
     * @param onlyCoinbase - Set to true if you only need the coinbase transaction
     * @param txIds - optional ordered list of transaction ids if already known
     * @param quiet - don't print non-essential logs
     * @param addMempoolData - calculate sigops etc
     * @returns Promise<TransactionExtended[]>
     *
     * @asyncUnsafe
     */
    async $getTransactionsExtended(blockHash, blockHeight, blockTime, onlyCoinbase, txIds = null, quiet = false, addMempoolData = false, stale = false) {
        const isEsplora = config_1.default.MEMPOOL.BACKEND === 'esplora';
        const transactionMap = {};
        if (!txIds) {
            txIds = await bitcoin_api_factory_1.default.$getTxIdsForBlock(blockHash, stale);
        }
        const mempool = mempool_1.default.getMempool();
        let foundInMempool = 0;
        let totalFound = 0;
        const missing = 0;
        // Copy existing transactions from the mempool
        if (!onlyCoinbase) {
            for (const txid of txIds) {
                if (mempool[txid]) {
                    mempool[txid].status = {
                        confirmed: true,
                        block_height: blockHeight,
                        block_hash: blockHash,
                        block_time: blockTime,
                    };
                    transactionMap[txid] = mempool[txid];
                    foundInMempool++;
                    totalFound++;
                }
            }
        }
        if (onlyCoinbase) {
            try {
                const coinbase = await transaction_utils_1.default.$getTransactionExtendedRetry(txIds[0], false, false, false, addMempoolData);
                if (coinbase && coinbase.vin[0].is_coinbase) {
                    return [coinbase];
                }
                else {
                    const msg = `Expected a coinbase tx, but the backend API returned something else`;
                    logger_1.default.err(msg);
                    throw new Error(msg);
                }
            }
            catch (e) {
                const msg = `Cannot fetch coinbase tx ${txIds[0]}. Reason: ` + (e instanceof Error ? e.message : e);
                logger_1.default.err(msg);
                // tolerate this error for stale blocks (the cb transaction won't be accessible via normal RPCs)
                if (!stale) {
                    throw new Error(msg);
                }
            }
        }
        // Fetch remaining txs in bulk
        if ((isEsplora && (txIds.length - totalFound > 500)) || stale) {
            try {
                const rawTransactions = await bitcoin_api_factory_1.default.$getTxsForBlock(blockHash, stale);
                for (const tx of rawTransactions) {
                    if (!transactionMap[tx.txid]) {
                        transactionMap[tx.txid] = addMempoolData ? transaction_utils_1.default.extendMempoolTransaction(tx) : transaction_utils_1.default.extendTransaction(tx);
                        totalFound++;
                    }
                }
            }
            catch (e) {
                logger_1.default.err(`Cannot fetch bulk txs for block ${blockHash}. Reason: ` + (e instanceof Error ? e.message : e));
            }
        }
        // Fetch remaining txs individually
        for (const txid of txIds.filter(txid => !transactionMap[txid])) {
            if (!quiet && (totalFound % (Math.round((txIds.length) / 10)) === 0 || totalFound + 1 === txIds.length)) { // Avoid log spam
                logger_1.default.debug(`Indexing tx ${totalFound + 1} of ${txIds.length} in block #${blockHeight}`);
            }
            try {
                const tx = await transaction_utils_1.default.$getTransactionExtendedRetry(txid, false, false, false, addMempoolData);
                transactionMap[txid] = tx;
                totalFound++;
            }
            catch (e) {
                const msg = `Cannot fetch tx ${txid}. Reason: ` + (e instanceof Error ? e.message : e);
                logger_1.default.err(msg);
                throw new Error(msg);
            }
        }
        if (!quiet) {
            logger_1.default.debug(`${foundInMempool} of ${txIds.length} found in mempool. ${totalFound - foundInMempool} fetched through backend service.`);
        }
        // Require the first transaction to be a coinbase
        const coinbase = transactionMap[txIds[0]];
        if (!coinbase || !coinbase.vin[0].is_coinbase) {
            const msg = `Expected first tx in a block to be a coinbase, but found something else`;
            logger_1.default.err(msg);
            throw new Error(msg);
        }
        // Require all transactions to be present
        if (txIds.some(txid => !transactionMap[txid])) {
            const msg = `Failed to fetch ${txIds.length - totalFound} transactions from block`;
            logger_1.default.err(msg);
            throw new Error(msg);
        }
        // Return list of transactions, preserving block order
        return txIds.map(txid => transactionMap[txid]);
    }
    /**
     * Return a block summary (list of stripped transactions)
     * @param block
     * @returns BlockSummary
     */
    summarizeBlock(block) {
        if (common_1.Common.isLiquid()) {
            block = this.convertLiquidFees(block);
        }
        const stripped = block.tx.map((tx) => {
            return {
                txid: tx.txid,
                vsize: tx.weight / 4,
                fee: tx.fee ? Math.round(tx.fee * 100000000) : 0,
                value: Math.round(tx.vout.reduce((acc, vout) => acc + (vout.value ? vout.value : 0), 0) * 100000000),
                flags: 0,
            };
        });
        return {
            id: block.hash,
            transactions: stripped
        };
    }
    // HACK -- Ordpool: async
    async summarizeBlockTransactions(hash, height, transactions) {
        return {
            id: hash,
            transactions: await common_1.Common.classifyTransactions(transactions, height),
        };
    }
    convertLiquidFees(block) {
        block.tx.forEach(tx => {
            if (!isFinite(Number(tx.fee))) {
                tx.fee = Object.values(tx.fee || {}).reduce((total, output) => total + output, 0);
            }
        });
        return block;
    }
    /**
     * Return a block with additional data (reward, coinbase, fees...)
     * @param block
     * @param transactions
     * @returns BlockExtended
     *
     * @asyncUnsafe
     */
    async $getBlockExtended(block, transactions, providedPool) {
        const coinbaseTx = transaction_utils_1.default.stripCoinbaseTransaction(transactions[0]);
        const blk = Object.assign({}, block);
        const extras = {};
        extras.reward = transactions[0].vout.reduce((acc, curr) => acc + curr.value, 0);
        extras.coinbaseRaw = coinbaseTx.vin[0].scriptsig;
        extras.orphans = chain_tips_1.default.getOrphanedBlocksAtHeight(blk.height);
        if (block.height === 0) {
            extras.medianFee = 0; // 50th percentiles
            extras.feeRange = [0, 0, 0, 0, 0, 0, 0];
            extras.totalFees = 0;
            extras.avgFee = 0;
            extras.avgFeeRate = 0;
            extras.utxoSetChange = 0;
            extras.avgTxSize = 0;
            extras.totalInputs = 0;
            extras.totalOutputs = 1;
            extras.totalOutputAmt = 0;
            extras.segwitTotalTxs = 0;
            extras.segwitTotalSize = 0;
            extras.segwitTotalWeight = 0;
        }
        else {
            const stats = await this.$getBlockStats(block, transactions);
            let feeStats = {
                medianFee: stats.feerate_percentiles[2],
                feeRange: [stats.minfeerate, stats.feerate_percentiles, stats.maxfeerate].flat(),
            };
            if (transactions?.length > 1) {
                feeStats = common_1.Common.calcEffectiveFeeStatistics(transactions);
            }
            extras.medianFee = feeStats.medianFee;
            extras.feeRange = feeStats.feeRange;
            extras.totalFees = stats.totalfee;
            extras.avgFee = stats.avgfee;
            extras.avgFeeRate = stats.avgfeerate;
            extras.utxoSetChange = stats.utxo_increase;
            extras.avgTxSize = Math.round(stats.total_size / stats.txs * 100) * 0.01;
            extras.totalInputs = stats.ins;
            extras.totalOutputs = stats.outs;
            extras.totalOutputAmt = stats.total_out;
            extras.segwitTotalTxs = stats.swtxs;
            extras.segwitTotalSize = stats.swtotal_size;
            extras.segwitTotalWeight = stats.swtotal_weight;
        }
        if (common_1.Common.blocksSummariesIndexingEnabled()) {
            extras.feePercentiles = await BlocksSummariesRepository_1.default.$getFeePercentilesByBlockId(block.id);
            if (extras.feePercentiles !== null) {
                extras.medianFeeAmt = extras.feePercentiles[3];
            }
        }
        extras.virtualSize = block.weight / 4.0;
        if (coinbaseTx?.vout.length > 0) {
            extras.coinbaseAddress = coinbaseTx.vout[0].scriptpubkey_address ?? null;
            extras.coinbaseAddresses = [...new Set(coinbaseTx.vout.map(v => v.scriptpubkey_address).filter(a => a))];
            extras.coinbaseSignature = coinbaseTx.vout[0].scriptpubkey_asm ?? null;
            extras.coinbaseSignatureAscii = transaction_utils_1.default.hex2ascii(coinbaseTx.vin[0].scriptsig) ?? null;
        }
        else {
            extras.coinbaseAddress = null;
            extras.coinbaseAddresses = null;
            extras.coinbaseSignature = null;
            extras.coinbaseSignatureAscii = null;
        }
        const header = await bitcoin_client_1.default.getBlockHeader(block.id, false);
        extras.header = header;
        const coinStatsIndex = indexer_1.default.isCoreIndexReady('coinstatsindex');
        if (coinStatsIndex !== null && coinStatsIndex.best_block_height >= block.height) {
            const txoutset = await bitcoin_client_1.default.getTxoutSetinfo('none', block.height);
            extras.utxoSetSize = txoutset.txouts,
                extras.totalInputAmt = Math.round(txoutset.block_info.prevout_spent * 100000000);
        }
        else {
            extras.utxoSetSize = null;
            extras.totalInputAmt = null;
        }
        if (['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
            let pool;
            if (providedPool) {
                pool = providedPool;
            }
            else if (coinbaseTx !== undefined) {
                pool = await this.$findBlockMiner(coinbaseTx);
            }
            else {
                if (config_1.default.DATABASE.ENABLED === true) {
                    pool = await PoolsRepository_1.default.$getUnknownPool();
                }
                else {
                    pool = pools_parser_1.default.unknownPool;
                }
            }
            if (!pool) { // We should never have this situation in practise
                logger_1.default.warn(`Cannot assign pool to block ${blk.height} and 'unknown' pool does not exist. ` +
                    `Check your "pools" table entries`);
            }
            else {
                extras.pool = {
                    id: pool.uniqueId,
                    name: pool.name,
                    slug: pool.slug,
                    minerNames: null,
                };
                if (extras.pool.name === 'OCEAN') {
                    extras.pool.minerNames = (0, bitcoin_script_1.parseDATUMTemplateCreator)(extras.coinbaseRaw);
                }
            }
            extras.matchRate = null;
            extras.expectedFees = null;
            extras.expectedWeight = null;
            if (config_1.default.MEMPOOL.AUDIT) {
                const auditScore = await BlocksAuditsRepository_1.default.$getBlockAuditScore(block.id);
                if (auditScore != null) {
                    extras.matchRate = auditScore.matchRate;
                    extras.expectedFees = auditScore.expectedFees;
                    extras.expectedWeight = auditScore.expectedWeight;
                }
            }
            extras.firstSeen = null;
            if (config_1.default.CORE_RPC.DEBUG_LOG_PATH) {
                const oldestLog = this.getOldestCoreLogTimestamp();
                if (oldestLog) {
                    extras.firstSeen = (0, file_read_1.getBlockFirstSeenFromLogs)(block.id, block.timestamp, oldestLog);
                }
            }
            // HACK -- Ordpool stats
            if (block.height >= (0, ordpool_parser_1.getFirstInscriptionHeight)(config_1.default.MEMPOOL.NETWORK) && transactions?.length > 1) {
                // This is the most important part of the Ordpool statistics,
                // we will do a deep analysis against all supported protocols.
                if (debugBlock) {
                    // save to file
                    const formattedJson = JSON.stringify(transactions, null, 2);
                    const filePath = `${__dirname}/../../../../ordpool-parser/testdata/block_${block.height}_txns.json`;
                    require('fs').writeFile(filePath, formattedJson, (err) => {
                        if (err) {
                            throw err;
                        }
                        logger_1.default.warn(`block_${block.height}_txns.json written. exiting`);
                        process.exit(1);
                    });
                }
                extras.ordpoolStats = await ordpool_parser_1.DigitalArtifactAnalyserService.analyseTransactions(transactions);
            }
        }
        blk.extras = extras;
        return blk;
    }
    async $getBlockStats(block, transactions) {
        if (!block.stale) {
            return bitcoin_client_1.default.getBlockStats(block.id);
        }
        // TODO: make these match the definitions used by the RPC response
        const totalFee = transactions.reduce((acc, tx) => acc + tx.fee, 0);
        const totalVsize = transactions.reduce((acc, tx) => acc + tx.vsize, 0);
        const totalReward = transactions[0].vout.reduce((acc, vout) => acc + vout.value, 0);
        const sortedByFee = transactions.sort((a, b) => a.fee - b.fee);
        const sortedByVsize = transactions.sort((a, b) => a.vsize - b.vsize);
        const sortedByFeerate = transactions.sort((a, b) => (a.fee / a.weight) - (b.fee / b.weight));
        const sortedFeerates = sortedByFeerate.map(tx => (tx.fee / (tx.weight / 4)));
        const avgfee = totalFee / transactions.length;
        const avgfeerate = totalFee / (block.weight / 4);
        const avgtxsize = totalVsize / transactions.length;
        const medianfee = sortedByFee[Math.floor(transactions.length / 2)].fee;
        const mediantime = block.timestamp;
        const mediantxsize = sortedByVsize[Math.floor(transactions.length / 2)].vsize;
        const minfee = sortedByFee[0].fee;
        const maxfee = sortedByFee[sortedByFee.length - 1].fee;
        const minfeerate = sortedFeerates[0];
        const maxfeerate = sortedFeerates[sortedFeerates.length - 1];
        const mintxsize = sortedByVsize[0].vsize;
        const maxtxsize = sortedByVsize[sortedByVsize.length - 1].vsize;
        const ins = transactions.reduce((acc, tx) => acc + tx.vin.length, 0);
        const outs = transactions.reduce((acc, tx) => acc + tx.vout.length, 0);
        const subsidy = totalReward - totalFee;
        const swtotal_size = 0;
        const swtotal_weight = 0;
        const swtxs = 0;
        const time = block.timestamp;
        const total_out = transactions.reduce((acc, tx) => acc + tx.vout.reduce((acc, vout) => acc + vout.value, 0), 0);
        const total_size = block.size;
        const total_weight = block.weight;
        const totalfee = totalFee;
        const txs = transactions.length;
        const utxo_increase = 0;
        const utxo_size_inc = 0;
        return {
            avgfee,
            avgfeerate,
            avgtxsize,
            blockhash: block.id,
            feerate_percentiles: [minfeerate, sortedFeerates[Math.floor(transactions.length / 4)], medianfee, sortedFeerates[Math.floor(transactions.length * 3 / 4)], maxfeerate],
            height: block.height,
            ins,
            maxfee,
            maxfeerate,
            maxtxsize,
            medianfee,
            mediantime,
            mediantxsize,
            minfee,
            minfeerate,
            mintxsize,
            outs,
            subsidy,
            swtotal_size,
            swtotal_weight,
            swtxs,
            time,
            total_out,
            total_size,
            total_weight,
            totalfee,
            txs,
            utxo_increase,
            utxo_size_inc,
        };
    }
    /**
     * Try to find which miner found the block
     * @param txMinerInfo
     * @returns
     *
     * @asyncUnsafe
     */
    async $findBlockMiner(txMinerInfo) {
        if (txMinerInfo === undefined || txMinerInfo.vout.length < 1) {
            if (config_1.default.DATABASE.ENABLED === true) {
                return await PoolsRepository_1.default.$getUnknownPool();
            }
            else {
                return pools_parser_1.default.unknownPool;
            }
        }
        const addresses = txMinerInfo.vout.map((vout) => vout.scriptpubkey_address).filter(address => address);
        let pools = [];
        if (config_1.default.DATABASE.ENABLED === true) {
            pools = await PoolsRepository_1.default.$getPools();
        }
        else {
            pools = pools_parser_1.default.miningPools;
        }
        const pool = pools_parser_1.default.matchBlockMiner(txMinerInfo.vin[0].scriptsig, addresses || [], pools);
        if (pool) {
            return pool;
        }
        if (config_1.default.DATABASE.ENABLED === true) {
            return await PoolsRepository_1.default.$getUnknownPool();
        }
        else {
            return pools_parser_1.default.unknownPool;
        }
    }
    /** @asyncUnsafe */
    async $applyBlockTransactionsToMempool(txIds, transactions) {
        const _memPool = mempool_1.default.getMempool();
        const rbfTransactions = common_1.Common.findMinedRbfTransactions(transactions, mempool_1.default.getSpendMap());
        mempool_1.default.handleRbfTransactions(rbfTransactions);
        mempool_1.default.removeFromSpendMap(transactions);
        if (config_1.default.MEMPOOL.CLUSTER_MEMPOOL) {
            mempool_1.default.clusterMempool?.applyMempoolChange({
                added: [],
                removed: txIds,
                accelerations: mempool_2.default.getAccelerations(),
            });
        }
        for (const txId of txIds) {
            delete _memPool[txId];
            rbf_cache_1.default.mined(txId);
        }
        let candidates;
        let transactionIds;
        if (mempool_1.default.limitGBT) {
            const minFeeMempool = await bitcoin_second_client_1.default.getRawMemPool();
            const minFeeTip = await bitcoin_second_client_1.default.getBlockCount();
            candidates = mempool_1.default.getNextCandidates(minFeeMempool, minFeeTip, transactions);
            transactionIds = Object.keys(candidates?.txs || {});
        }
        else {
            candidates = undefined;
            transactionIds = Object.keys(mempool_1.default.getMempool());
        }
        if (config_1.default.MEMPOOL.CLUSTER_MEMPOOL) {
            const cmBlocks = mempool_2.default.clusterMempool?.getBlocks(config_1.default.MEMPOOL.MEMPOOL_BLOCKS_AMOUNT) ?? [];
            await mempool_blocks_1.default.processClusterMempoolBlocks(cmBlocks, _memPool, mempool_2.default.getAccelerations());
        }
        else if (config_1.default.MEMPOOL.RUST_GBT) {
            const added = mempool_1.default.limitGBT ? (candidates?.added || []) : [];
            const removed = mempool_1.default.limitGBT ? (candidates?.removed || []) : transactions;
            await mempool_blocks_1.default.$rustUpdateBlockTemplates(transactionIds, _memPool, added, removed, candidates, true);
        }
        else {
            await mempool_blocks_1.default.$makeBlockTemplates(transactionIds, _memPool, candidates, true, true);
        }
        return { rbfTransactions };
    }
    /** @asyncUnsafe */
    async $saveBlockData(processingResult, timer) {
        const blockExtended = processingResult.blockExtended;
        const cpfpSummary = processingResult.cpfpSummary;
        let latestPriceId;
        try {
            latestPriceId = await PricesRepository_1.default.$getLatestPriceId();
            this.updateTimerProgress(timer, `got latest price id ${this.currentBlockHeight}`);
        }
        catch (e) {
            logger_1.default.debug('failed to fetch latest price id from db: ' + (e instanceof Error ? e.message : e));
        }
        if (price_updater_1.default.historyInserted === true && latestPriceId !== null) {
            await BlocksRepository_1.default.$saveBlockPrices([{
                    height: blockExtended.height,
                    priceId: latestPriceId,
                }]);
            this.updateTimerProgress(timer, `saved prices for ${this.currentBlockHeight}`);
        }
        else {
            logger_1.default.debug(`Cannot save block price for ${blockExtended.height} because the price updater hasnt completed yet. Trying again in 10 seconds.`, logger_1.default.tags.mining);
            indexer_1.default.scheduleSingleTask('blocksPrices', 10000);
        }
        if (common_1.Common.blocksSummariesIndexingEnabled() === true) {
            // indexes the summary as a side effect
            await this.$getStrippedBlockTransactions(blockExtended.id, true, false, cpfpSummary, blockExtended.height);
            this.updateTimerProgress(timer, `saved block summary for ${this.currentBlockHeight}`);
        }
        if (config_1.default.MEMPOOL.CPFP_INDEXING) {
            // can be slow, and isn't critical, so don't await
            void this.$saveCpfp(blockExtended.id, this.currentBlockHeight, cpfpSummary);
            this.updateTimerProgress(timer, `saved cpfp for ${this.currentBlockHeight}`);
        }
        if (processingResult.auditResult) {
            void BlocksSummariesRepository_1.default.$saveTemplate({
                height: blockExtended.height,
                template: {
                    id: blockExtended.id,
                    transactions: processingResult.auditResult.projectedBlocks[0].transactions,
                },
                version: 1,
            });
            this.updateTimerProgress(timer, `saved audit template for ${this.currentBlockHeight}`);
            void BlocksAuditsRepository_1.default.$saveAudit({
                version: 1,
                templateAlgorithm: processingResult.templateAlgorithm,
                time: blockExtended.timestamp,
                height: blockExtended.height,
                hash: blockExtended.id,
                unseenTxs: processingResult.auditResult.unseen,
                addedTxs: processingResult.auditResult.added,
                prioritizedTxs: processingResult.auditResult.prioritized,
                missingTxs: processingResult.auditResult.censored,
                freshTxs: processingResult.auditResult.fresh,
                sigopTxs: processingResult.auditResult.sigop,
                fullrbfTxs: processingResult.auditResult.fullrbf,
                acceleratedTxs: processingResult.auditResult.accelerated,
                matchRate: processingResult.auditResult.matchRate,
                expectedFees: processingResult.auditResult.expectedFees,
                expectedWeight: processingResult.auditResult.expectedWeight,
            });
            this.updateTimerProgress(timer, `saved audit results for ${this.currentBlockHeight}`);
        }
    }
    /**
     * [INDEXING] Index all blocks summaries for the block txs visualization
     */
    async $generateBlocksSummariesDatabase() {
        if (common_1.Common.blocksSummariesIndexingEnabled() === false) {
            return;
        }
        try {
            const blockchainInfo = await bitcoin_client_1.default.getBlockchainInfo();
            const currentBlockHeight = blockchainInfo.blocks;
            let indexingBlockAmount = Math.min(config_1.default.MEMPOOL.INDEXING_BLOCKS_AMOUNT, currentBlockHeight);
            if (indexingBlockAmount <= -1) {
                indexingBlockAmount = currentBlockHeight + 1;
            }
            const lastBlockToIndex = Math.max(0, currentBlockHeight - indexingBlockAmount + 1);
            // Get all indexed block hash
            const indexedBlocks = (await BlocksRepository_1.default.$getIndexedBlocks()).filter(block => block.height >= lastBlockToIndex);
            const indexedBlockSummariesHashesArray = await BlocksSummariesRepository_1.default.$getIndexedSummariesId();
            const indexedBlockSummariesHashes = {}; // Use a map for faster seek during the indexing loop
            for (const hash of indexedBlockSummariesHashesArray) {
                indexedBlockSummariesHashes[hash] = true;
            }
            // Logging
            let newlyIndexed = 0;
            let totalIndexed = indexedBlockSummariesHashesArray.length;
            let indexedThisRun = 0;
            let timer = Date.now() / 1000;
            const startedAt = Date.now() / 1000;
            for (const block of indexedBlocks) {
                if (indexedBlockSummariesHashes[block.hash] === true) {
                    continue;
                }
                // Logging
                const elapsedSeconds = (Date.now() / 1000) - timer;
                if (elapsedSeconds > 5) {
                    const runningFor = (Date.now() / 1000) - startedAt;
                    const blockPerSeconds = indexedThisRun / elapsedSeconds;
                    const progress = Math.round(totalIndexed / indexedBlocks.length * 10000) / 100;
                    logger_1.default.debug(`Indexing block summary for #${block.height} | ~${blockPerSeconds.toFixed(2)} blocks/sec | total: ${totalIndexed}/${indexedBlocks.length} (${progress}%) | elapsed: ${runningFor.toFixed(2)} seconds`, logger_1.default.tags.mining);
                    timer = Date.now() / 1000;
                    indexedThisRun = 0;
                }
                await this.$indexBlockSummary(block.hash, block.height, block.stale);
                // Logging
                indexedThisRun++;
                totalIndexed++;
                newlyIndexed++;
            }
            if (newlyIndexed > 0) {
                logger_1.default.notice(`Blocks summaries indexing completed: indexed ${newlyIndexed} blocks`, logger_1.default.tags.mining);
            }
            else {
                logger_1.default.debug(`Blocks summaries indexing completed: indexed ${newlyIndexed} blocks`, logger_1.default.tags.mining);
            }
        }
        catch (e) {
            logger_1.default.err(`Blocks summaries indexing failed. Trying again in 10 seconds. Reason: ${(e instanceof Error ? e.message : e)}`, logger_1.default.tags.mining);
            throw e;
        }
    }
    /** @asyncUnsafe */
    async $indexBlockSummary(hash, height, stale) {
        if (config_1.default.MEMPOOL.BACKEND === 'esplora') {
            const txs = (await bitcoin_api_factory_1.default.$getTxsForBlock(hash, stale)).map(tx => transaction_utils_1.default.extendMempoolTransaction(tx));
            const cpfpSummary = await this.$indexCPFP(hash, height, txs, stale);
            if (cpfpSummary) {
                await this.$getStrippedBlockTransactions(hash, true, true, cpfpSummary, height); // This will index the block summary
            }
        }
        else {
            await this.$getStrippedBlockTransactions(hash, true, true); // This will index the block summary
        }
    }
    /**
     * [INDEXING] Index transaction CPFP data for all blocks
     */
    async $generateCPFPDatabase() {
        if (common_1.Common.cpfpIndexingEnabled() === false) {
            return;
        }
        try {
            // Get all indexed block hash
            const unindexedBlockHeights = await BlocksRepository_1.default.$getCPFPUnindexedBlocks();
            if (!unindexedBlockHeights?.length) {
                return;
            }
            logger_1.default.info(`Indexing cpfp data for ${unindexedBlockHeights.length} blocks`);
            // Logging
            let count = 0;
            let countThisRun = 0;
            let timer = Date.now() / 1000;
            const startedAt = Date.now() / 1000;
            for (const height of unindexedBlockHeights) {
                // Logging
                const hash = await bitcoin_api_factory_1.default.$getBlockHash(height);
                const elapsedSeconds = (Date.now() / 1000) - timer;
                if (elapsedSeconds > 5) {
                    const runningFor = (Date.now() / 1000) - startedAt;
                    const blockPerSeconds = countThisRun / elapsedSeconds;
                    const progress = Math.round(count / unindexedBlockHeights.length * 10000) / 100;
                    logger_1.default.debug(`Indexing cpfp clusters for #${height} | ~${blockPerSeconds.toFixed(2)} blocks/sec | total: ${count}/${unindexedBlockHeights.length} (${progress}%) | elapsed: ${runningFor.toFixed(2)} seconds`);
                    timer = Date.now() / 1000;
                    countThisRun = 0;
                }
                await this.$indexCPFP(hash, height); // Calculate and save CPFP data for transactions in this block
                // Logging
                count++;
                countThisRun++;
            }
            logger_1.default.notice(`CPFP indexing completed: indexed ${count} blocks`);
        }
        catch (e) {
            logger_1.default.err(`CPFP indexing failed. Trying again in 10 seconds. Reason: ${(e instanceof Error ? e.message : e)}`);
            throw e;
        }
    }
    /**
     * [INDEXING] Index expected fees & weight for all audited blocks
     *
     * @asyncUnsafe
     */
    async $generateAuditStats() {
        const blockIds = await BlocksAuditsRepository_1.default.$getBlocksWithoutSummaries();
        if (!blockIds?.length) {
            return;
        }
        let timer = Date.now();
        let indexedThisRun = 0;
        let indexedTotal = 0;
        logger_1.default.debug(`Indexing ${blockIds.length} block audit details`);
        for (const hash of blockIds) {
            const summary = await BlocksSummariesRepository_1.default.$getTemplate(hash);
            let totalFees = 0;
            let totalWeight = 0;
            for (const tx of summary?.transactions || []) {
                totalFees += tx.fee;
                totalWeight += (tx.vsize * 4);
            }
            await BlocksAuditsRepository_1.default.$setSummary(hash, totalFees, totalWeight);
            const cachedBlock = this.blocks.find(block => block.id === hash);
            if (cachedBlock) {
                cachedBlock.extras.expectedFees = totalFees;
                cachedBlock.extras.expectedWeight = totalWeight;
            }
            indexedThisRun++;
            indexedTotal++;
            const elapsedSeconds = (Date.now() - timer) / 1000;
            if (elapsedSeconds > 5) {
                const blockPerSeconds = indexedThisRun / elapsedSeconds;
                logger_1.default.debug(`Indexed ${indexedTotal} / ${blockIds.length} block audit details (${blockPerSeconds.toFixed(1)}/s)`);
                timer = Date.now();
                indexedThisRun = 0;
            }
        }
        logger_1.default.debug(`Indexing block audit details completed`);
    }
    /**
     * [INDEXING] Index transaction classification flags for Goggles
     *
     * @asyncSafe
     */
    async $classifyBlocks() {
        if (this.classifyingBlocks) {
            return;
        }
        this.classifyingBlocks = true;
        // classification requires an esplora backend
        if (!common_1.Common.gogglesIndexingEnabled() || config_1.default.MEMPOOL.BACKEND !== 'esplora') {
            return;
        }
        const currentBlockHeight = this.getCurrentBlockHeight();
        // HACK -- Ordpool
        const targetSummaryVersion = ORDPOOL_BLOCK_SUMMARY_VERSION;
        const targetTemplateVersion = 1;
        const unclassifiedBlocksList = await BlocksSummariesRepository_1.default.$getSummariesBelowVersion(targetSummaryVersion);
        const unclassifiedTemplatesList = await BlocksSummariesRepository_1.default.$getTemplatesBelowVersion(targetTemplateVersion);
        // nothing to do
        if (!unclassifiedBlocksList?.length && !unclassifiedTemplatesList?.length) {
            return;
        }
        let timer = Date.now();
        let indexedThisRun = 0;
        let indexedTotal = 0;
        const minHeight = Math.min(unclassifiedBlocksList[unclassifiedBlocksList.length - 1]?.height ?? Infinity, unclassifiedTemplatesList[unclassifiedTemplatesList.length - 1]?.height ?? Infinity);
        const numToIndex = Math.max(unclassifiedBlocksList.length, unclassifiedTemplatesList.length);
        const unclassifiedBlocks = {};
        const unclassifiedTemplates = {};
        for (const block of unclassifiedBlocksList) {
            unclassifiedBlocks[block.height] = block.id;
        }
        for (const template of unclassifiedTemplatesList) {
            unclassifiedTemplates[template.height] = template.id;
        }
        logger_1.default.debug(`Classifying blocks and templates from #${currentBlockHeight} to #${minHeight}`, logger_1.default.tags.goggles);
        for (let height = currentBlockHeight; height >= 0; height--) {
            try {
                let txs = null;
                if (unclassifiedBlocks[height]) {
                    const blockHash = unclassifiedBlocks[height];
                    // fetch transactions
                    txs = (await bitcoin_api_factory_1.default.$getTxsForBlock(blockHash, true)).map(tx => transaction_utils_1.default.extendMempoolTransaction(tx)) || [];
                    // add CPFP
                    const blockCpfpData = (0, cpfp_1.calculateGoodBlockCpfp)(height, txs, []);
                    const cpfpSummary = (0, block_processor_1.saveCpfpDataToCpfpSummary)(txs, blockCpfpData);
                    // HACK -- Ordpool: async
                    const { transactions: classifiedTxs } = await this.summarizeBlockTransactions(blockHash, height, cpfpSummary.transactions);
                    await BlocksSummariesRepository_1.default.$saveTransactions(height, blockHash, classifiedTxs, ORDPOOL_BLOCK_SUMMARY_VERSION);
                    if (unclassifiedBlocks[height].version < 2 && targetSummaryVersion === 2) {
                        const cpfpClusters = await CpfpRepository_2.default.$getClustersAt(height);
                        if (!CpfpRepository_1.default.compareClusters(cpfpClusters, cpfpSummary.clusters)) {
                            // CPFP clusters changed - update the compact_cpfp tables
                            await CpfpRepository_2.default.$deleteClustersAt(height);
                            await this.$saveCpfp(blockHash, height, cpfpSummary);
                        }
                    }
                    await common_1.Common.sleep$(250);
                }
                if (unclassifiedTemplates[height]) {
                    // classify template
                    const blockHash = unclassifiedTemplates[height];
                    const template = await BlocksSummariesRepository_1.default.$getTemplate(blockHash);
                    const alreadyClassified = template?.transactions?.reduce((classified, tx) => (classified || tx.flags > 0), false);
                    let classifiedTemplate = template?.transactions || [];
                    if (!alreadyClassified) {
                        const templateTxs = [];
                        const blockTxMap = {};
                        for (const tx of (txs || [])) {
                            blockTxMap[tx.txid] = tx;
                        }
                        for (const templateTx of (template?.transactions || [])) {
                            let tx = blockTxMap[templateTx.txid];
                            if (!tx) {
                                try {
                                    tx = await transaction_utils_1.default.$getTransactionExtended(templateTx.txid, false, true, false);
                                }
                                catch (e) {
                                    // transaction probably not found
                                }
                            }
                            templateTxs.push(tx || templateTx);
                        }
                        const blockCpfpData = (0, cpfp_1.calculateGoodBlockCpfp)(height, templateTxs?.filter(tx => tx['effectiveFeePerVsize'] != null), []);
                        const cpfpSummary = (0, block_processor_1.saveCpfpDataToCpfpSummary)(templateTxs, blockCpfpData);
                        // HACK -- Ordpool: async
                        const { transactions: classifiedTxs } = await this.summarizeBlockTransactions(blockHash, height, cpfpSummary.transactions);
                        const classifiedTxMap = {};
                        for (const tx of classifiedTxs) {
                            classifiedTxMap[tx.txid] = tx;
                        }
                        classifiedTemplate = classifiedTemplate.map(tx => {
                            if (classifiedTxMap[tx.txid]) {
                                tx.flags = classifiedTxMap[tx.txid].flags || 0;
                            }
                            return tx;
                        });
                    }
                    await BlocksSummariesRepository_1.default.$saveTemplate({ height, template: { id: blockHash, transactions: classifiedTemplate }, version: 1 });
                    await common_1.Common.sleep$(250);
                }
            }
            catch (e) {
                logger_1.default.warn(`Failed to classify template or block summary at ${height}`, logger_1.default.tags.goggles);
            }
            // timing & logging
            if (unclassifiedBlocks[height] || unclassifiedTemplates[height]) {
                indexedThisRun++;
                indexedTotal++;
            }
            const elapsedSeconds = (Date.now() - timer) / 1000;
            if (elapsedSeconds > 5) {
                const perSecond = indexedThisRun / elapsedSeconds;
                logger_1.default.debug(`Classified #${height}: ${indexedTotal} / ${numToIndex} blocks (${perSecond.toFixed(1)}/s)`);
                timer = Date.now();
                indexedThisRun = 0;
            }
        }
        this.classifyingBlocks = false;
    }
    /**
     * [INDEXING] Index missing coinbase addresses for all blocks
     */
    async $indexCoinbaseAddresses() {
        try {
            // Get all indexed block hash
            const unindexedBlocks = await BlocksRepository_1.default.$getBlocksWithoutCoinbaseAddresses();
            if (!unindexedBlocks?.length) {
                return;
            }
            logger_1.default.info(`Indexing missing coinbase addresses for ${unindexedBlocks.length} blocks`);
            // Logging
            let count = 0;
            let countThisRun = 0;
            let timer = Date.now() / 1000;
            const startedAt = Date.now() / 1000;
            for (const { height, hash } of unindexedBlocks) {
                // Logging
                const elapsedSeconds = (Date.now() / 1000) - timer;
                if (elapsedSeconds > 5) {
                    const runningFor = (Date.now() / 1000) - startedAt;
                    const blockPerSeconds = countThisRun / elapsedSeconds;
                    const progress = Math.round(count / unindexedBlocks.length * 10000) / 100;
                    logger_1.default.debug(`Indexing coinbase addresses for #${height} | ~${blockPerSeconds.toFixed(2)} blocks/sec | total: ${count}/${unindexedBlocks.length} (${progress}%) | elapsed: ${runningFor.toFixed(2)} seconds`);
                    timer = Date.now() / 1000;
                    countThisRun = 0;
                }
                const coinbaseTx = await bitcoin_api_factory_1.default.$getCoinbaseTx(hash);
                const addresses = new Set(coinbaseTx.vout.map(v => v.scriptpubkey_address).filter(a => a));
                await BlocksRepository_1.default.$saveCoinbaseAddresses(hash, [...addresses]);
                // Logging
                count++;
                countThisRun++;
            }
            logger_1.default.notice(`coinbase addresses indexing completed: indexed ${count} blocks`);
        }
        catch (e) {
            logger_1.default.err(`coinbase addresses indexing failed. Trying again in 10 seconds. Reason: ${(e instanceof Error ? e.message : e)}`);
            throw e;
        }
    }
    /**
     * [INDEXING] Index all blocks metadata for the mining dashboard
     * @asyncSafe
     */
    async $generateBlockDatabase() {
        try {
            const blockchainInfo = await bitcoin_client_1.default.getBlockchainInfo();
            let currentBlockHeight = blockchainInfo.blocks;
            // HACK: force a given block for debugging reasons
            if (debugBlock) {
                currentBlockHeight = debugBlock;
            }
            let indexingBlockAmount = Math.min(config_1.default.MEMPOOL.INDEXING_BLOCKS_AMOUNT, blockchainInfo.blocks);
            if (indexingBlockAmount <= -1) {
                indexingBlockAmount = currentBlockHeight + 1;
            }
            // HACK -- Ordpool: ensure we index at least from firstInscriptionHeight
            // This replaces the old OrdpoolMissingBlocks brute-force backfiller
            const firstInscriptionHeight = (0, ordpool_parser_1.getFirstInscriptionHeight)(config_1.default.MEMPOOL.NETWORK);
            indexingBlockAmount = Math.max(indexingBlockAmount, currentBlockHeight - firstInscriptionHeight + 1);
            const lastBlockToIndex = Math.max(0, currentBlockHeight - indexingBlockAmount + 1);
            logger_1.default.debug(`Indexing blocks from #${currentBlockHeight} to #${lastBlockToIndex}`, logger_1.default.tags.mining);
            loading_indicators_1.default.setProgress('block-indexing', 0);
            const chunkSize = 10000;
            let totalIndexed = await BlocksRepository_1.default.$blockCountBetweenHeight(currentBlockHeight, lastBlockToIndex);
            let indexedThisRun = 0;
            let newlyIndexed = 0;
            const startedAt = Date.now() / 1000;
            let timer = Date.now() / 1000;
            while (currentBlockHeight >= lastBlockToIndex) {
                const endBlock = Math.max(0, lastBlockToIndex, currentBlockHeight - chunkSize + 1);
                const missingBlockHeights = await BlocksRepository_1.default.$getMissingBlocksBetweenHeights(currentBlockHeight, endBlock);
                if (missingBlockHeights.length <= 0) {
                    currentBlockHeight -= chunkSize;
                    continue;
                }
                logger_1.default.info(`Indexing ${missingBlockHeights.length} blocks from #${currentBlockHeight} to #${endBlock}`, logger_1.default.tags.mining);
                for (const blockHeight of missingBlockHeights) {
                    if (blockHeight < lastBlockToIndex) {
                        break;
                    }
                    ++indexedThisRun;
                    ++totalIndexed;
                    const elapsedSeconds = (Date.now() / 1000) - timer;
                    if (elapsedSeconds > 5 || blockHeight === lastBlockToIndex) {
                        const runningFor = (Date.now() / 1000) - startedAt;
                        const blockPerSeconds = indexedThisRun / elapsedSeconds;
                        const progress = Math.round(totalIndexed / indexingBlockAmount * 10000) / 100;
                        logger_1.default.debug(`Indexing block #${blockHeight} | ~${blockPerSeconds.toFixed(2)} blocks/sec | total: ${totalIndexed}/${indexingBlockAmount} (${progress.toFixed(2)}%) | elapsed: ${runningFor.toFixed(2)} seconds`, logger_1.default.tags.mining);
                        timer = Date.now() / 1000;
                        indexedThisRun = 0;
                        loading_indicators_1.default.setProgress('block-indexing', progress, false);
                    }
                    const blockHash = await bitcoin_api_factory_1.default.$getBlockHash(blockHeight);
                    const block = await bitcoin_api_factory_1.default.$getBlock(blockHash);
                    const transactions = await this.$getTransactionsExtended(blockHash, block.height, block.timestamp, !block.stale, null, true, block.stale);
                    const blockExtended = await this.$getBlockExtended(block, transactions);
                    newlyIndexed++;
                    await BlocksRepository_1.default.$saveBlockInDatabase(blockExtended);
                }
                currentBlockHeight -= chunkSize;
            }
            if (newlyIndexed > 0) {
                logger_1.default.notice(`Block indexing completed: indexed ${newlyIndexed} blocks`, logger_1.default.tags.mining);
            }
            else {
                logger_1.default.debug(`Block indexing completed: indexed ${newlyIndexed} blocks`, logger_1.default.tags.mining);
            }
            loading_indicators_1.default.setProgress('block-indexing', 100);
        }
        catch (e) {
            logger_1.default.err('Block indexing failed. Trying again in 10 seconds. Reason: ' + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
            loading_indicators_1.default.setProgress('block-indexing', 100);
            throw e;
        }
        return await BlocksRepository_2.default.$validateChain();
    }
    /**
     * [INDEXING] Index all blocks first seen time from Bitcoin Core debug logs
     *
     * @asyncUnsafe
     */
    async $indexBlocksFirstSeen() {
        const previous = this.oldestCoreLogTimestamp;
        const oldestLogTimestamp = this.getOldestCoreLogTimestamp(true);
        const hasLogFileChanged = previous !== undefined && oldestLogTimestamp !== previous;
        if (!oldestLogTimestamp) {
            return;
        }
        // If the log file changed since last run, re-try to index blocks marked with sentinel value
        const blocks = await BlocksRepository_2.default.$getBlocksWithoutFirstSeen(hasLogFileChanged);
        if (!blocks?.length) {
            return;
        }
        logger_1.default.debug(`Indexing ${blocks.length} block first seen times${hasLogFileChanged ? ' (log file changed since last run)' : ''}`);
        const startedAt = Date.now();
        const results = (0, file_read_1.scanLogsForBlocksFirstSeen)(blocks, oldestLogTimestamp);
        const foundCount = results.filter(result => result.firstSeen !== null).length;
        logger_1.default.debug(`Found first seen times of ${foundCount} / ${results.length} blocks in Core logs, saving to database...`);
        await BlocksRepository_2.default.$saveFirstSeenTimes(results);
        const blocksByHash = new Map(this.blocks.map(block => [block.id, block]));
        for (const { hash, firstSeen } of results) {
            const cachedBlock = blocksByHash.get(hash);
            if (cachedBlock?.extras) {
                cachedBlock.extras.firstSeen = firstSeen;
            }
        }
        logger_1.default.debug(`Indexed ${foundCount} / ${blocks.length} block first seen times in ${((Date.now() - startedAt) / 1000).toFixed(2)} seconds`);
    }
    /** @asyncUnsafe */
    async $updateBlocks() {
        // warn if this run stalls the main loop for more than 2 minutes
        const timer = this.startTimer();
        disk_cache_1.default.lock();
        let fastForwarded = false;
        let handledBlocks = 0;
        const lastBlockHeight = this.currentBlockHeight;
        const blockHeightTip = await bitcoin_api_factory_1.bitcoinCoreApi.$getBlockHeightTip();
        this.updateTimerProgress(timer, 'got block height tip');
        if (this.blocks.length === 0) {
            this.currentBlockHeight = Math.max(blockHeightTip - config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT, -1);
        }
        else {
            this.currentBlockHeight = this.blocks[this.blocks.length - 1].height;
        }
        if (blockHeightTip - this.currentBlockHeight > config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT * 2) {
            logger_1.default.info(`${blockHeightTip - this.currentBlockHeight} blocks since tip. Fast forwarding to the ${config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT} recent blocks`);
            this.currentBlockHeight = blockHeightTip - config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT;
            fastForwarded = true;
            logger_1.default.info(`Re-indexing skipped blocks and corresponding hashrates data`);
            indexer_1.default.reindex(); // Make sure to index the skipped blocks #1619
        }
        if (!this.lastDifficultyAdjustmentTime) {
            const blockchainInfo = await bitcoin_client_1.default.getBlockchainInfo();
            this.updateTimerProgress(timer, 'got blockchain info for initial difficulty adjustment');
            if (blockchainInfo.blocks === blockchainInfo.headers) {
                const heightDiff = blockHeightTip % 2016;
                const blockHash = await bitcoin_api_factory_1.default.$getBlockHash(blockHeightTip - heightDiff);
                this.updateTimerProgress(timer, 'got block hash for initial difficulty adjustment');
                const block = await bitcoin_api_factory_1.default.$getBlock(blockHash);
                this.updateTimerProgress(timer, 'got block for initial difficulty adjustment');
                this.lastDifficultyAdjustmentTime = block.timestamp;
                this.currentBits = block.bits;
                if (blockHeightTip >= 2016) {
                    const previousPeriodBlockHash = await bitcoin_api_factory_1.default.$getBlockHash(blockHeightTip - heightDiff - 2016);
                    this.updateTimerProgress(timer, 'got previous block hash for initial difficulty adjustment');
                    const previousPeriodBlock = await bitcoin_api_factory_1.default.$getBlock(previousPeriodBlockHash);
                    this.updateTimerProgress(timer, 'got previous block for initial difficulty adjustment');
                    if (['liquid', 'liquidtestnet'].includes(config_1.default.MEMPOOL.NETWORK)) {
                        this.previousDifficultyRetarget = NaN;
                    }
                    else {
                        this.previousDifficultyRetarget = (0, difficulty_adjustment_1.calcBitsDifference)(previousPeriodBlock.bits, block.bits);
                    }
                    logger_1.default.debug(`Initial difficulty adjustment data set.`);
                }
            }
            else {
                logger_1.default.debug(`Blockchain headers (${blockchainInfo.headers}) and blocks (${blockchainInfo.blocks}) not in sync. Waiting...`);
            }
        }
        const heightChanged = lastBlockHeight !== this.currentBlockHeight;
        // make sure to update the quarter epoch block time now if we won't do it inside the loop
        if (this.currentBlockHeight >= blockHeightTip && (heightChanged || this.quarterEpochBlockTime == null)) {
            await this.updateQuarterEpochBlockTime();
        }
        while (this.currentBlockHeight < blockHeightTip) {
            if (this.currentBlockHeight === 0) {
                this.currentBlockHeight = blockHeightTip;
                await this.updateQuarterEpochBlockTime();
            }
            else {
                this.currentBlockHeight++;
                await this.updateQuarterEpochBlockTime();
                logger_1.default.debug(`New block found (#${this.currentBlockHeight})!`);
            }
            if (debugBlock) {
                // HACK: force a given block for debugging reasons
                this.currentBlockHeight = debugBlock;
            }
            this.updateTimerProgress(timer, `getting block data for ${this.currentBlockHeight}`);
            const blockHash = await bitcoin_api_factory_1.bitcoinCoreApi.$getBlockHash(this.currentBlockHeight);
            const verboseBlock = await bitcoin_client_1.default.getBlock(blockHash, 2);
            const block = bitcoin_api_1.default.convertBlock(verboseBlock);
            const txIds = verboseBlock.tx.map(tx => tx.txid);
            const transactions = await this.$getTransactionsExtended(blockHash, block.height, block.timestamp, false, txIds, false, true);
            // fill in missing transaction fee data from verboseBlock
            for (let i = 0; i < transactions.length; i++) {
                if (!transactions[i].fee && transactions[i].txid === verboseBlock.tx[i].txid) {
                    transactions[i].fee = (verboseBlock.tx[i].fee * 100_000_000) || 0;
                }
            }
            const pool = await this.$findBlockMiner(transaction_utils_1.default.stripCoinbaseTransaction(transactions[0]));
            const accelerations = mempool_2.default.getAccelerations();
            const processingResult = await block_processor_1.default.$processNewBlock(block, transactions, pool, accelerations);
            const blockExtended = processingResult.blockExtended;
            const blockSummary = processingResult.blockSummary;
            const cpfpSummary = processingResult.cpfpSummary;
            this.updateTimerProgress(timer, `got block data for ${this.currentBlockHeight}`);
            if (config_1.default.STATISTICS.ENABLED && config_1.default.DATABASE.ENABLED) {
                await statistics_1.default.runStatistics();
            }
            const { rbfTransactions } = await this.$applyBlockTransactionsToMempool(txIds, cpfpSummary.transactions);
            this.updateTimerProgress(timer, `applied mempool changes for ${this.currentBlockHeight}`);
            if (config_1.default.STATISTICS.ENABLED && config_1.default.DATABASE.ENABLED) {
                await statistics_1.default.runStatistics();
            }
            if (common_1.Common.indexingEnabled() && !fastForwarded) {
                await this.$handleReorgs(blockExtended, timer);
            }
            await websocket_handler_1.default.handleNewBlock(blockExtended, txIds, cpfpSummary.transactions, rbfTransactions);
            this.updateTimerProgress(timer, `sent websocket updates for ${this.currentBlockHeight}`);
            if (common_1.Common.indexingEnabled()) {
                await BlocksRepository_1.default.$saveBlockInDatabase(blockExtended);
                this.updateTimerProgress(timer, `saved ${this.currentBlockHeight} to database`);
                await AccelerationRepository_1.default.$indexAccelerationsForBlock(blockExtended, Object.values(accelerations), cpfpSummary.transactions);
                this.updateTimerProgress(timer, `indexed accelerations for ${this.currentBlockHeight}`);
                if (!fastForwarded) {
                    await this.$saveBlockData(processingResult, timer);
                }
            }
            if (block.height % 2016 === 0) {
                if (common_1.Common.indexingEnabled()) {
                    let adjustment;
                    if (['liquid', 'liquidtestnet'].includes(config_1.default.MEMPOOL.NETWORK)) {
                        adjustment = NaN;
                    }
                    else {
                        adjustment = Math.round(
                        // calcBitsDifference returns +- percentage, +100 returns to positive, /100 returns to ratio.
                        // Instead of actually doing /100, just reduce the multiplier.
                        ((0, difficulty_adjustment_1.calcBitsDifference)(this.currentBits, block.bits) + 100) * 10000) / 1000000; // Remove float point noise
                    }
                    await DifficultyAdjustmentsRepository_1.default.$saveAdjustments({
                        time: block.timestamp,
                        height: block.height,
                        difficulty: block.difficulty,
                        adjustment,
                    });
                    this.updateTimerProgress(timer, `saved difficulty adjustment for ${this.currentBlockHeight}`);
                }
                if (['liquid', 'liquidtestnet'].includes(config_1.default.MEMPOOL.NETWORK)) {
                    this.previousDifficultyRetarget = NaN;
                }
                else {
                    this.previousDifficultyRetarget = (0, difficulty_adjustment_1.calcBitsDifference)(this.currentBits, block.bits);
                }
                this.lastDifficultyAdjustmentTime = block.timestamp;
                this.currentBits = block.bits;
            }
            // skip updating the orphan block cache if we've fallen behind the chain tip
            if (this.currentBlockHeight >= blockHeightTip - 2) {
                this.updateTimerProgress(timer, `getting orphaned blocks for ${this.currentBlockHeight}`);
                await chain_tips_1.default.updateOrphanedBlocks();
            }
            this.blocks.push(blockExtended);
            if (this.blocks.length > config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT * 4) {
                this.blocks = this.blocks.slice(-config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT * 4);
            }
            blockSummary.transactions.forEach(tx => {
                delete tx.acc;
            });
            this.blockSummaries.push(blockSummary);
            if (this.blockSummaries.length > config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT * 4) {
                this.blockSummaries = this.blockSummaries.slice(-config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT * 4);
            }
            if (this.newBlockCallbacks.length) {
                this.newBlockCallbacks.forEach((cb) => cb(blockExtended, txIds, transactions));
            }
            if (config_1.default.MEMPOOL.CACHE_ENABLED && !mempool_1.default.hasPriority() && (block.height % config_1.default.MEMPOOL.DISK_CACHE_BLOCK_INTERVAL === 0)) {
                void disk_cache_1.default.$saveCacheToDisk();
            }
            // Update Redis cache
            if (config_1.default.REDIS.ENABLED) {
                await redis_cache_1.default.$updateBlocks(this.blocks);
                await redis_cache_1.default.$updateBlockSummaries(this.blockSummaries);
                await redis_cache_1.default.$removeTransactions(txIds);
                await rbf_cache_1.default.updateCache();
            }
            handledBlocks++;
        }
        disk_cache_1.default.unlock();
        this.clearTimer(timer);
        return handledBlocks;
    }
    startTimer() {
        const state = {
            start: Date.now(),
            progress: 'begin $updateBlocks',
            timer: null,
        };
        state.timer = setTimeout(() => {
            logger_1.default.err(`$updateBlocks stalled at "${state.progress}"`);
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
    /** @asyncUnsafe */
    async updateQuarterEpochBlockTime() {
        if (this.currentBlockHeight >= 503) {
            try {
                const quarterEpochBlockHash = await bitcoin_api_factory_1.default.$getBlockHash(this.currentBlockHeight - 503);
                const quarterEpochBlock = await bitcoin_api_factory_1.default.$getBlock(quarterEpochBlockHash);
                this.quarterEpochBlockTime = quarterEpochBlock?.timestamp;
            }
            catch (e) {
                this.quarterEpochBlockTime = null;
                logger_1.default.warn('failed to update last epoch block time: ' + (e instanceof Error ? e.message : e));
            }
        }
    }
    /**
     * Index a block if it's missing from the database. Returns the block after indexing
     * @asyncUnsafe
     */
    async $indexBlockByHeight(height, skipDb = false) {
        if (common_1.Common.indexingEnabled() && !skipDb) {
            const dbBlock = await BlocksRepository_1.default.$getBlockByHeight(height);
            if (dbBlock !== null) {
                return dbBlock;
            }
        }
        // not already indexed
        const hash = await bitcoin_api_factory_1.default.$getBlockHash(height);
        return this.$indexBlock(hash);
    }
    /** @asyncUnsafe */
    async $handleReorgs(blockExtended, timer) {
        let forkTail = blockExtended;
        let currentlyIndexed = await BlocksRepository_1.default.$getBlockByHeight(forkTail.height - 1);
        this.updateTimerProgress(timer, `got block by height at previous tip ${forkTail.height - 1}`);
        // previous blockhash is not what we expected: there has been a reorg
        if (currentlyIndexed !== null && forkTail.previousblockhash !== currentlyIndexed.id) {
            logger_1.default.warn(`Chain divergence detected at block ${blockExtended.height}, re-indexing most recent data`, logger_1.default.tags.mining);
            this.updateTimerProgress(timer, `reconnecting diverged chain from ${this.currentBlockHeight}`);
            const newBlocks = [];
            // walk back along the chain until we reach the fork point
            while (currentlyIndexed !== null && forkTail.previousblockhash !== currentlyIndexed.id) {
                const newBlock = await this.$indexBlock(forkTail.previousblockhash);
                await BlocksRepository_1.default.$setCanonicalBlockAtHeight(newBlock.id, newBlock.height);
                newBlocks.push(newBlock);
                this.updateTimerProgress(timer, `reindexed block at ${newBlock.height} (${newBlock.id})`);
                let newCpfpSummary;
                if (config_1.default.MEMPOOL.CPFP_INDEXING) {
                    newCpfpSummary = await this.$indexCPFP(newBlock.id, newBlock.height);
                    this.updateTimerProgress(timer, `reindexed block cpfp`);
                }
                await this.$getStrippedBlockTransactions(newBlock.id, true, true, newCpfpSummary, newBlock.height);
                this.updateTimerProgress(timer, `reindexed block summary`);
                forkTail = newBlock;
                currentlyIndexed = await BlocksRepository_1.default.$getBlockByHeight(forkTail.height - 1);
                this.updateTimerProgress(timer, `got block by height for ${forkTail.height - 1}`);
            }
            // rebuild the block cache
            let currentBlock = forkTail;
            const cachedBlocksByHash = {};
            for (const cached of this.blocks) {
                cachedBlocksByHash[cached.id] = cached;
            }
            while (currentBlock.height > 0 && newBlocks.length < (config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT * 4)) {
                const newBlock = cachedBlocksByHash[currentBlock.previousblockhash] || await BlocksRepository_1.default.$getBlockByHash(currentBlock.previousblockhash);
                if (newBlock) {
                    newBlocks.push(newBlock);
                    currentBlock = newBlock;
                }
                else {
                    break;
                }
            }
            this.updateTimerProgress(timer, `rebuilt block cache`);
            // force re-indexing of block-related data
            await HashratesRepository_1.default.$deleteHashratesFromTimestamp(forkTail.timestamp - 604800);
            await DifficultyAdjustmentsRepository_1.default.$deleteAdjustementsFromHeight(forkTail.height);
            await CpfpRepository_1.default.$deleteClustersFrom(forkTail.height);
            await AccelerationRepository_1.default.$deleteAccelerationsFrom(forkTail.height);
            chain_tips_1.default.clearOrphanCacheAboveHeight(forkTail.height);
            this.updateTimerProgress(timer, `deleted stale block data`);
            this.blocks = newBlocks.reverse();
            if (this.blocks.length > config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT * 4) {
                this.blocks = this.blocks.slice(-config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT * 4);
            }
            this.updateTimerProgress(timer, `connected new best chain from ${forkTail.height} to ${this.currentBlockHeight}`);
            await mining_1.default.$indexDifficultyAdjustments();
            this.updateTimerProgress(timer, `reindexed difficulty adjustments`);
            logger_1.default.info(`Re-indexed ${this.currentBlockHeight - forkTail.height} blocks and summaries. Also re-indexed the last difficulty adjustments. Will re-index latest hashrates in a few seconds.`, logger_1.default.tags.mining);
            indexer_1.default.reindex();
            websocket_handler_1.default.handleReorg();
        }
    }
    /**
     * Index a block if it's missing from the database. Returns the block after indexing
     *
     * @asyncUnsafe
     */
    async $indexBlock(hash, block, skipDb = false) {
        if (common_1.Common.indexingEnabled() && !skipDb) {
            const dbBlock = await BlocksRepository_1.default.$getBlockByHash(hash);
            if (dbBlock !== null) {
                return dbBlock;
            }
        }
        if (!block) {
            // dont' bother trying to fetch orphan blocks from esplora
            block = await (chain_tips_1.default.isOrphaned(hash) ? bitcoin_api_factory_1.bitcoinCoreApi.$getBlock(hash) : bitcoin_api_factory_1.default.$getBlock(hash));
        }
        const transactions = await this.$getTransactionsExtended(hash, block.height, block.timestamp, !block.stale, null, false, false, block.stale);
        const blockExtended = await this.$getBlockExtended(block, transactions);
        if (block.stale) {
            blockExtended.canonical = await bitcoin_api_factory_1.default.$getBlockHash(block.height);
        }
        if (common_1.Common.indexingEnabled()) {
            await BlocksRepository_1.default.$saveBlockInDatabase(blockExtended);
        }
        return blockExtended;
    }
    /**
     * Get one block by its hash
     * @asyncUnsafe
     */
    async $getBlock(hash, skipMemoryCache = false) {
        // Check the memory cache
        if (!skipMemoryCache) {
            const blockByHash = this.getBlocks().find((b) => b.id === hash);
            if (blockByHash) {
                return blockByHash;
            }
        }
        // Not Bitcoin network, return the block as it from the bitcoin backend
        if (['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK) === false) {
            return await bitcoin_api_factory_1.bitcoinCoreApi.$getBlock(hash);
        }
        // HACK -- Ordpool: short-circuit genesis. Bitcoin Core treats the genesis
        // coinbase tx as non-standard (getrawtransaction fails), so $indexBlock's
        // call to $getTransactionsExtended throws and the route ends up as 404.
        // Return the bare block from bitcoinCoreApi without trying to extend txs.
        if (BLOCK_GENESIS_HASHES.includes(hash)) {
            return await bitcoin_api_factory_1.bitcoinCoreApi.$getBlock(hash);
        }
        // Bitcoin network, add our custom data on top
        return await this.$indexBlock(hash);
    }
    /** @asyncUnsafe */
    async $getStrippedBlockTransactions(hash, skipMemoryCache = false, skipDBLookup = false, cpfpSummary, blockHeight) {
        if (skipMemoryCache === false) {
            // Check the memory cache
            const cachedSummary = this.getBlockSummaries().find((b) => b.id === hash);
            if (cachedSummary?.transactions?.length) {
                return cachedSummary.transactions;
            }
        }
        // Check if it's indexed in db
        if (skipDBLookup === false && common_1.Common.blocksSummariesIndexingEnabled() === true) {
            const indexedSummary = await BlocksSummariesRepository_1.default.$getByBlockId(hash);
            // HACK -- Ordpool: require >= ORDPOOL_BLOCK_SUMMARY_VERSION; older rows fall through.
            if (indexedSummary !== undefined &&
                indexedSummary?.transactions?.length &&
                (indexedSummary.version || 0) >= ORDPOOL_BLOCK_SUMMARY_VERSION) {
                return indexedSummary.transactions;
            }
        }
        let height = blockHeight;
        let summary;
        let summaryVersion = 0;
        if (cpfpSummary && !common_1.Common.isLiquid()) {
            // HACK -- Ordpool: async + Promise.all (getTransactionFlags now awaits parser)
            const classifiedTxs = await Promise.all(cpfpSummary.transactions.map(async (tx) => {
                let flags = 0;
                try {
                    flags = await common_1.Common.getTransactionFlags(tx, height);
                }
                catch (e) {
                    logger_1.default.warn('Failed to classify transaction: ' + (e instanceof Error ? e.message : e));
                }
                return {
                    txid: tx.txid,
                    time: tx.firstSeen,
                    fee: tx.fee || 0,
                    vsize: tx.vsize,
                    value: Math.round(tx.vout.reduce((acc, vout) => acc + (vout.value ? vout.value : 0), 0)),
                    rate: tx.effectiveFeePerVsize,
                    flags: flags,
                };
            }));
            summary = {
                id: hash,
                transactions: classifiedTxs,
            };
            summaryVersion = cpfpSummary.version;
        }
        else {
            const txs = (await bitcoin_api_factory_1.default.$getTxsForBlock(hash, true)).map(tx => transaction_utils_1.default.extendTransaction(tx));
            // HACK -- Ordpool: async + v3
            summary = await this.summarizeBlockTransactions(hash, height || 0, txs);
            summaryVersion = ORDPOOL_BLOCK_SUMMARY_VERSION;
        }
        if (height == null) {
            // If the block is orphaned, use the height from the chaintips cache
            const orphanedBlock = chain_tips_1.default.getOrphanedBlock(hash);
            if (orphanedBlock) {
                height = orphanedBlock.height;
            }
            else {
                const block = await bitcoin_api_factory_1.default.$getBlock(hash);
                height = block.height;
            }
        }
        // Index the response if needed
        if (common_1.Common.blocksSummariesIndexingEnabled() === true) {
            await BlocksSummariesRepository_1.default.$saveTransactions(height, hash, summary.transactions, summaryVersion);
        }
        return summary.transactions;
    }
    /** @asyncUnsafe */
    async $getSingleTxFromSummary(hash, txid) {
        const txs = await this.$getStrippedBlockTransactions(hash);
        return txs.find(tx => tx.txid === txid) || null;
    }
    /**
     * Get 15 blocks
     *
     * Internally this function uses two methods to get the blocks, and
     * the method is automatically selected:
     *  - Using previous block hash links
     *  - Using block height
     *
     * @param fromHeight
     * @param limit
     * @returns
     * @asyncUnsafe
     */
    async $getBlocks(fromHeight, limit = 15) {
        let currentHeight = fromHeight !== undefined ? fromHeight : this.currentBlockHeight;
        if (currentHeight > this.currentBlockHeight) {
            limit -= currentHeight - this.currentBlockHeight;
            currentHeight = this.currentBlockHeight;
        }
        const returnBlocks = [];
        if (currentHeight < 0) {
            return returnBlocks;
        }
        for (let i = 0; i < limit && currentHeight >= 0; i++) {
            let block = this.getBlocks().find((b) => b.height === currentHeight);
            if (block) {
                // Using the memory cache (find by height)
                returnBlocks.push(block);
            }
            else {
                // Using indexing (find by height, index on the fly, save in database)
                block = await this.$indexBlockByHeight(currentHeight);
                returnBlocks.push(block);
            }
            currentHeight--;
        }
        return returnBlocks;
    }
    /**
     * Used for bulk block data query
     *
     * @param fromHeight
     * @param toHeight
     * @asyncUnsafe
     */
    async $getBlocksBetweenHeight(fromHeight, toHeight) {
        if (!common_1.Common.indexingEnabled()) {
            return [];
        }
        const blocks = [];
        while (fromHeight <= toHeight) {
            let block = await BlocksRepository_1.default.$getBlockByHeight(fromHeight);
            if (!block) {
                await this.$indexBlockByHeight(fromHeight);
                block = await BlocksRepository_1.default.$getBlockByHeight(fromHeight);
                if (!block) {
                    continue;
                }
            }
            // Cleanup fields before sending the response
            const cleanBlock = {
                height: block.height ?? null,
                hash: block.id ?? null,
                timestamp: block.timestamp ?? null,
                median_timestamp: block.mediantime ?? null,
                previous_block_hash: block.previousblockhash ?? null,
                difficulty: block.difficulty ?? null,
                header: block.extras.header ?? null,
                version: block.version ?? null,
                bits: block.bits ?? null,
                nonce: block.nonce ?? null,
                size: block.size ?? null,
                weight: block.weight ?? null,
                tx_count: block.tx_count ?? null,
                merkle_root: block.merkle_root ?? null,
                reward: block.extras.reward ?? null,
                total_fee_amt: block.extras.totalFees ?? null,
                avg_fee_amt: block.extras.avgFee ?? null,
                median_fee_amt: block.extras.medianFeeAmt ?? null,
                fee_amt_percentiles: block.extras.feePercentiles ?? null,
                avg_fee_rate: block.extras.avgFeeRate ?? null,
                median_fee_rate: block.extras.medianFee ?? null,
                fee_rate_percentiles: block.extras.feeRange ?? null,
                total_inputs: block.extras.totalInputs ?? null,
                total_input_amt: block.extras.totalInputAmt ?? null,
                total_outputs: block.extras.totalOutputs ?? null,
                total_output_amt: block.extras.totalOutputAmt ?? null,
                segwit_total_txs: block.extras.segwitTotalTxs ?? null,
                segwit_total_size: block.extras.segwitTotalSize ?? null,
                segwit_total_weight: block.extras.segwitTotalWeight ?? null,
                avg_tx_size: block.extras.avgTxSize ?? null,
                utxoset_change: block.extras.utxoSetChange ?? null,
                utxoset_size: block.extras.utxoSetSize ?? null,
                coinbase_raw: block.extras.coinbaseRaw ?? null,
                coinbase_address: block.extras.coinbaseAddress ?? null,
                coinbase_addresses: block.extras.coinbaseAddresses ?? null,
                coinbase_signature: block.extras.coinbaseSignature ?? null,
                coinbase_signature_ascii: block.extras.coinbaseSignatureAscii ?? null,
                pool_slug: block.extras.pool.slug ?? null,
                pool_id: block.extras.pool.id ?? null,
            };
            if (common_1.Common.blocksSummariesIndexingEnabled() && cleanBlock.fee_amt_percentiles === null) {
                cleanBlock.fee_amt_percentiles = await BlocksSummariesRepository_1.default.$getFeePercentilesByBlockId(cleanBlock.hash);
                if (cleanBlock.fee_amt_percentiles === null) {
                    let summary;
                    let summaryVersion = 0;
                    if (config_1.default.MEMPOOL.BACKEND === 'esplora') {
                        const txs = (await bitcoin_api_factory_1.default.$getTxsForBlock(cleanBlock.hash, cleanBlock.stale)).map(tx => transaction_utils_1.default.extendTransaction(tx));
                        // HACK -- Ordpool: async + v3
                        summary = await this.summarizeBlockTransactions(cleanBlock.hash, cleanBlock.height, txs);
                        summaryVersion = ORDPOOL_BLOCK_SUMMARY_VERSION;
                    }
                    else {
                        // Call Core RPC
                        const block = await bitcoin_client_1.default.getBlock(cleanBlock.hash, 2);
                        summary = this.summarizeBlock(block);
                    }
                    await BlocksSummariesRepository_1.default.$saveTransactions(cleanBlock.height, cleanBlock.hash, summary.transactions, summaryVersion);
                    cleanBlock.fee_amt_percentiles = await BlocksSummariesRepository_1.default.$getFeePercentilesByBlockId(cleanBlock.hash);
                }
                if (cleanBlock.fee_amt_percentiles !== null) {
                    cleanBlock.median_fee_amt = cleanBlock.fee_amt_percentiles[3];
                    await BlocksRepository_1.default.$updateFeeAmounts(cleanBlock.hash, cleanBlock.fee_amt_percentiles, cleanBlock.median_fee_amt);
                }
            }
            cleanBlock.fee_amt_percentiles = {
                'min': cleanBlock.fee_amt_percentiles[0],
                'perc_10': cleanBlock.fee_amt_percentiles[1],
                'perc_25': cleanBlock.fee_amt_percentiles[2],
                'perc_50': cleanBlock.fee_amt_percentiles[3],
                'perc_75': cleanBlock.fee_amt_percentiles[4],
                'perc_90': cleanBlock.fee_amt_percentiles[5],
                'max': cleanBlock.fee_amt_percentiles[6],
            };
            cleanBlock.fee_rate_percentiles = {
                'min': cleanBlock.fee_rate_percentiles[0],
                'perc_10': cleanBlock.fee_rate_percentiles[1],
                'perc_25': cleanBlock.fee_rate_percentiles[2],
                'perc_50': cleanBlock.fee_rate_percentiles[3],
                'perc_75': cleanBlock.fee_rate_percentiles[4],
                'perc_90': cleanBlock.fee_rate_percentiles[5],
                'max': cleanBlock.fee_rate_percentiles[6],
            };
            // Re-org can happen after indexing so we need to always get the
            // latest state from core
            cleanBlock.orphans = chain_tips_1.default.getOrphanedBlocksAtHeight(cleanBlock.height);
            blocks.push(cleanBlock);
            fromHeight++;
        }
        return blocks;
    }
    async $getBlockAuditSummary(hash) {
        if (['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK) && common_1.Common.auditIndexingEnabled()) {
            return BlocksAuditsRepository_1.default.$getBlockAudit(hash);
        }
        else {
            return null;
        }
    }
    async $getBlockTxAuditSummary(hash, txid) {
        if (['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK) && common_1.Common.auditIndexingEnabled()) {
            return BlocksAuditsRepository_1.default.$getBlockTxAudit(hash, txid);
        }
        else {
            return null;
        }
    }
    getLastDifficultyAdjustmentTime() {
        return this.lastDifficultyAdjustmentTime;
    }
    getPreviousDifficultyRetarget() {
        return this.previousDifficultyRetarget;
    }
    getQuarterEpochBlockTime() {
        return this.quarterEpochBlockTime;
    }
    getCurrentBlockHeight() {
        return this.currentBlockHeight;
    }
    /** @asyncUnsafe */
    async $indexCPFP(hash, height, txs, stale) {
        let transactions = txs;
        if (!transactions) {
            if (config_1.default.MEMPOOL.BACKEND === 'esplora') {
                transactions = (await bitcoin_api_factory_1.default.$getTxsForBlock(hash, true)).map(tx => transaction_utils_1.default.extendMempoolTransaction(tx));
            }
            if (!transactions) {
                const block = await bitcoin_client_1.default.getBlock(hash, 2);
                transactions = block.tx.map(tx => {
                    tx.fee *= 100_000_000;
                    return tx;
                });
            }
        }
        if (transactions?.length != null) {
            const { cpfpSummary } = await (0, block_processor_1.detectTemplateAlgorithm)(height, transactions, [], true);
            if (!stale) {
                await this.$saveCpfp(hash, height, cpfpSummary);
            }
            const effectiveFeeStats = common_1.Common.calcEffectiveFeeStatistics(cpfpSummary.transactions);
            await BlocksRepository_1.default.$saveEffectiveFeeStats(hash, effectiveFeeStats);
            return cpfpSummary;
        }
        else {
            logger_1.default.err(`Cannot index CPFP for block ${height} - missing transaction data`);
            return null;
        }
    }
    /** @asyncSafe */
    async $saveCpfp(hash, height, cpfpSummary) {
        try {
            const result = await CpfpRepository_1.default.$batchSaveClusters(cpfpSummary.clusters);
            if (!result) {
                await CpfpRepository_1.default.$insertProgressMarker(height);
            }
        }
        catch (e) {
            // not a fatal error, we'll try again next time the indexer runs
        }
    }
    async $getBlockDefinitionHashes() {
        try {
            const [rows] = await database_1.default.query(`SELECT DISTINCT(definition_hash) FROM blocks WHERE stale = 0`);
            if (rows && Array.isArray(rows)) {
                return rows.map(r => r.definition_hash);
            }
            else {
                logger_1.default.debug(`Unable to retrieve list of blocks.definition_hash from db (no result)`);
                return null;
            }
        }
        catch (e) {
            logger_1.default.debug(`Unable to retrieve list of blocks.definition_hash from db (exception: ${e})`);
            return null;
        }
    }
    async $getBlocksByDefinitionHash(definitionHash) {
        try {
            const [rows] = await database_1.default.query(`SELECT hash FROM blocks WHERE definition_hash = ? AND stale = 0`, [definitionHash]);
            if (rows && Array.isArray(rows)) {
                return rows.map(r => r.hash);
            }
            else {
                logger_1.default.debug(`Unable to retrieve list of blocks for definition hash ${definitionHash} from db (no result)`);
                return null;
            }
        }
        catch (e) {
            logger_1.default.debug(`Unable to retrieve list of blocks for definition hash ${definitionHash} from db (exception: ${e})`);
            return null;
        }
    }
    getOldestCoreLogTimestamp(forceRefresh = false) {
        if (!forceRefresh && this.oldestCoreLogTimestamp !== undefined) {
            return this.oldestCoreLogTimestamp;
        }
        const debugLogPath = config_1.default.CORE_RPC.DEBUG_LOG_PATH;
        if (!debugLogPath) {
            this.oldestCoreLogTimestamp = null;
            return null;
        }
        try {
            this.oldestCoreLogTimestamp = (0, file_read_1.getOldestLogTimestampFromLogs)(debugLogPath);
            if (this.oldestCoreLogTimestamp !== null) {
                logger_1.default.info(`Core debug log entries date back to ${new Date(this.oldestCoreLogTimestamp * 1000).toISOString()}`);
            }
            else {
                logger_1.default.err(`Could not find oldest timestamp in Core debug log file at ${debugLogPath}`);
            }
            return this.oldestCoreLogTimestamp;
        }
        catch (e) {
            this.oldestCoreLogTimestamp = null;
            logger_1.default.err(`Could not read Core debug log file at ${debugLogPath}. Reason: ${e instanceof Error ? e.message : e}`);
            return null;
        }
    }
}
exports.default = new Blocks();
