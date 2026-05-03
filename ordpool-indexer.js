"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ordpool_missing_stats_1 = __importDefault(require("./api/ordpool-missing-stats"));
// OrdpoolMissingBlocks removed — mempool's $generateBlockDatabase() now indexes
// from firstInscriptionHeight automatically (see blocks.ts HACK -- Ordpool).
const logger_1 = __importDefault(require("./logger"));
/**
 * Class responsible for indexing missing blocks and missing Ordpool statistics.
 * Dynamically adjusts workload based on performance and handles exceptions.
 */
class OrdpoolIndexer {
    /** Minimum processing duration threshold for dynamic scaling */
    static MIN_DURATION_MS = 5 * 60 * 1000; // 5 minutes
    /** Maximum processing duration threshold for dynamic scaling */
    static MAX_DURATION_MS = 15 * 60 * 1000; // 15 minutes
    /** Cooldown time after no more work is left */
    static REST_INTERVAL_WORK_DONE_MS = 10 * 60 * 1000; // 10 minutes
    /** Cooldown time after consecutive errors */
    static REST_INTERVAL_ERROR_MS = 2 * 60 * 1000; // 2 minutes
    /** Hard timeout for an entire batch run (5 minutes). Safety net if processMissingStats hangs. */
    static BATCH_TIMEOUT_MS = 5 * 60 * 1000;
    /** Initial batch size for processing blocks / stats */
    batchSize = 10;
    /** Counter for consecutive failures */
    failureCount = 0;
    /** Maximum allowed consecutive failures before entering cooldown */
    maxFailures = 5;
    /** Timestamp indicating when processing can resume */
    sleepUntil = 0;
    /** Timeout ID for scheduling the next run */
    timeoutId = null;
    /** Indicates if a task is currently running */
    isRunning = false;
    /** Timeout handler, overrideable for testing */
    setTimeoutFn = setTimeout;
    /** Date provider, overrideable for testing */
    dateProvider = { now: () => Date.now() };
    /**
     * Runs the indexing process. Dynamically adjusts workload based on performance and handles exceptions.
     */
    async run() {
        if (this.isRunning) {
            logger_1.default.debug('Indexer is already running. Skipping new invocation.', 'Ordpool');
            return;
        }
        const now = this.dateProvider.now();
        // Check if sleepUntil is active
        if (now < this.sleepUntil) {
            // logger.debug(`Processing paused until ${new Date(this.sleepUntil).toISOString()}`, 'Ordpool');
            this.scheduleNextRun(this.sleepUntil - now);
            return;
        }
        this.isRunning = true;
        const startTime = now;
        try {
            // HACK -- Ordpool: global batch timeout as safety net.
            // If processMissingStats hangs (e.g., slow RPC response from overloaded bitcoind),
            // this ensures the indexer always recovers and retries.
            const hasMoreWork = await Promise.race([
                ordpool_missing_stats_1.default.processMissingStats(this.batchSize),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Batch timeout: processMissingStats exceeded 5 minutes')), OrdpoolIndexer.BATCH_TIMEOUT_MS)),
            ]);
            const duration = this.dateProvider.now() - startTime;
            if (!hasMoreWork) {
                logger_1.default.info('No more tasks to process. Entering rest state.', 'Ordpool');
                this.sleepUntil = this.dateProvider.now() + OrdpoolIndexer.REST_INTERVAL_WORK_DONE_MS;
                this.isRunning = false;
                return;
            }
            // Reset failure count on success
            this.failureCount = 0;
            // Adjust batch size based on processing duration
            if (duration < OrdpoolIndexer.MIN_DURATION_MS) {
                this.batchSize = Math.min(this.batchSize + Math.ceil(this.batchSize * 0.5), this.batchSize * 2);
                logger_1.default.info(`Batch size increased to ${this.batchSize}. Duration: ${duration}ms.`, 'Ordpool');
            }
            else if (duration > OrdpoolIndexer.MAX_DURATION_MS) {
                this.batchSize = Math.max(Math.ceil(this.batchSize * 0.5), 1);
                logger_1.default.info(`Batch size decreased to ${this.batchSize}. Duration: ${duration}ms.`, 'Ordpool');
            }
            else {
                logger_1.default.info(`Batch size maintained at ${this.batchSize}. Duration: ${duration}ms.`, 'Ordpool');
            }
        }
        catch (error) {
            this.failureCount++;
            logger_1.default.err(`Error during batch processing: ${error instanceof Error ? error.message : error}`, 'Ordpool');
            // Reduce batch size on failure
            this.batchSize = Math.max(Math.ceil(this.batchSize * 0.5), 1);
            logger_1.default.warn(`Batch size reduced to ${this.batchSize}. Consecutive failures: ${this.failureCount}`, 'Ordpool');
            // Enter cooldown after max failures
            if (this.failureCount >= this.maxFailures) {
                this.sleepUntil = this.dateProvider.now() + OrdpoolIndexer.REST_INTERVAL_ERROR_MS;
                logger_1.default.err(`Max failures reached. Pausing until ${new Date(this.sleepUntil).toISOString()}`, 'Ordpool');
            }
        }
        finally {
            this.isRunning = false;
            this.scheduleNextRun(10 * 1000); // Check again in 10 seconds
        }
    }
    /**
     * Schedules the next run of the indexer.
     * Ensures that only one timeout is active at any time.
     * @param interval - Time in milliseconds until the next run.
     */
    scheduleNextRun(interval) {
        if (this.timeoutId) {
            return; // do nothing
        }
        this.timeoutId = this.setTimeoutFn(() => {
            this.timeoutId = null;
            this.run();
        }, interval);
    }
}
exports.default = new OrdpoolIndexer();
