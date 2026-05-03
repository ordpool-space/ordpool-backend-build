"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ordpool_parser_1 = require("ordpool-parser");
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../logger"));
const OrdpoolBlocksRepository_1 = __importDefault(require("../repositories/OrdpoolBlocksRepository"));
const bitcoin_client_1 = __importDefault(require("./bitcoin/bitcoin-client"));
const blocks_1 = __importDefault(require("./blocks"));
// HACK -- Ordpool: Hard timeout for RPC calls.
// The built-in RPC timeout (60s) only covers "no response at all."
// It does NOT cover slow responses where bitcoind starts sending data
// but trickles it in slowly (e.g., when ord is hammering it).
// This wraps any promise with a hard deadline.
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
        promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
}
/**
 * Processes ordpool stats for entries in the `blocks` table
 * that do not have corresponding data in the `ordpool_stats` table.
 *
 * Prefers the bitcoin RPC API over the esplora API
 * This code assumes that MEMPOOL.BACKEND === 'esplora' is set,
 * otherwise the fallback has no effect because the RPC is always used
 */
class OrdpoolMissingStats {
    /**
     * The timestamp until which the Esplora fallback is active.
     * If null, Bitcoin RPC is used as the default data source.
     */
    fallbackUntil = null;
    /**
     * The cooldown period (in milliseconds) before switching back to Bitcoin RPC.
     */
    static fallbackCooldownMs = 5 * 60 * 1000; // 5 minutes
    /**
     * Hard timeout for a single block's RPC call (2 minutes).
     * Covers slow responses that the built-in 60s connection timeout misses.
     */
    static rpcHardTimeoutMs = 2 * 60 * 1000;
    /**
     * Indicates whether a task is currently running.
     * Prevents overlapping task executions.
     */
    isTaskRunning = false;
    /**
     * Processes ordpool statistics for blocks without ordpool stats.
     * Respects batch size and switches between Bitcoin RPC and Esplora fallback as needed.
     *
     * @param batchSize - Number of blocks to process in a single run.
     * @returns {Promise<boolean>} - True if at least one block was processed successfully, false otherwise.
     */
    async processMissingStats(batchSize) {
        if (this.isTaskRunning) {
            logger_1.default.info('Missing Stats task is still running. Skipping new instance.', 'Ordpool');
            return false;
        }
        this.isTaskRunning = true;
        let processedAtLeastOneBlock = false;
        const firstInscriptionHeight = (0, ordpool_parser_1.getFirstInscriptionHeight)(config_1.default.MEMPOOL.NETWORK);
        try {
            const blocksToProcess = await OrdpoolBlocksRepository_1.default.getBlocksWithoutOrdpoolStatsInRange(firstInscriptionHeight, batchSize);
            if (!blocksToProcess.length) {
                logger_1.default.debug('Missing Stats: No more blocks to process.', 'Ordpool');
                return false;
            }
            for (const block of blocksToProcess) {
                const now = Date.now();
                // Check if fallback period has expired
                if (this.fallbackUntil !== null && now > this.fallbackUntil) {
                    logger_1.default.info('Missing Stats: Fallback period expired. Switching back to Bitcoin RPC.', 'Ordpool');
                    this.fallbackUntil = null;
                }
                try {
                    let transactions;
                    const t0 = Date.now();
                    if (this.fallbackUntil !== null) {
                        logger_1.default.debug(`Missing Stats: Using Esplora API for block #${block.height}.`, 'Ordpool');
                        // this will use esplora, if MEMPOOL.BACKEND === 'esplora'
                        // onlyCoinbase is set to false here, so it will load ALL transactions of the block
                        transactions = await blocks_1.default['$getTransactionsExtended'](block.id, block.height, block.timestamp, false);
                    }
                    else {
                        // uses the Bitcoin Core RPC's getblock method with verbosity level 2.
                        // this will give us the block's raw data, including all transactions.
                        // HACK -- Ordpool: wrapped with hard timeout to prevent hanging on slow responses.
                        // bitcoinCore is untyped JS (require'd) so getBlock() returns any.
                        // Assign to typed variable first so withTimeout<T> infers the correct T.
                        const rpcCall = bitcoin_client_1.default.getBlock(block.id, 2);
                        const verboseBlock = await withTimeout(rpcCall, OrdpoolMissingStats.rpcHardTimeoutMs, `RPC getblock #${block.height}`);
                        const t1 = Date.now();
                        transactions = (0, ordpool_parser_1.convertVerboseBlockToSimplePlus)(verboseBlock);
                        const t2 = Date.now();
                        const ordpoolStats = await ordpool_parser_1.DigitalArtifactAnalyserService.analyseTransactions(transactions);
                        const t3 = Date.now();
                        await OrdpoolBlocksRepository_1.default.saveBlockOrdpoolStatsInDatabase({
                            id: block.id,
                            height: block.height,
                            extras: { ordpoolStats },
                        });
                        const t4 = Date.now();
                        logger_1.default.info(`Missing Stats: Block #${block.height} | ${transactions.length} txs | RPC: ${t1 - t0}ms | convert: ${t2 - t1}ms | analyse: ${t3 - t2}ms | save: ${t4 - t3}ms | total: ${t4 - t0}ms`, 'Ordpool');
                        processedAtLeastOneBlock = true;
                        continue;
                    }
                    const ordpoolStats = await ordpool_parser_1.DigitalArtifactAnalyserService.analyseTransactions(transactions);
                    await OrdpoolBlocksRepository_1.default.saveBlockOrdpoolStatsInDatabase({
                        id: block.id,
                        height: block.height,
                        extras: { ordpoolStats },
                    });
                    processedAtLeastOneBlock = true;
                }
                catch (error) {
                    logger_1.default.debug('Missing Stats: Switching to Esplora fallback due to RPC failure.', 'Ordpool');
                    this.fallbackUntil = Date.now() + OrdpoolMissingStats.fallbackCooldownMs;
                    throw error;
                }
            }
        }
        finally {
            this.isTaskRunning = false;
        }
        return processedAtLeastOneBlock;
    }
}
exports.default = new OrdpoolMissingStats();
